/**
 * FlightGear AI / multiplayer traffic for the FLARM features (EXPERIMENTAL).
 *
 * Polls  GET /json/ai/models?d=3  every 2 s and extracts every `aircraft` and
 * `multiplayer` node that has a position. The exact JSON layout of FlightGear's
 * httpd differs a little between versions, so the parser is tolerant: it
 * looks for the leaf properties by name anywhere below each model node.
 * Verified against the mock server in tools/ only.
 *
 * Collision alarms (manual 7.1.10.3): the time to the closest point of approach
 * is computed from the relative position and velocity; alarm level 1 (low,
 * 13-18 s), 2 (medium, 9-12 s) and 3 (high, 0-8 s) when that point is closer
 * than `MISS` metres.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const MISS = 500;

  /** Find the first descendant of `node` called `name` that carries a value. */
  function find(node, name) {
    if (!node) return undefined;
    if (node.name === name && node.value !== undefined) return node.value;
    for (const c of node.children || []) { const v = find(c, name); if (v !== undefined) return v; }
    return undefined;
  }

  /** Extract models from the /ai/models tree. */
  function parseModels(tree) {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (/^(aircraft|multiplayer)$/.test(n.name || '') && (n.children || []).length) {
        const lat = find(n, 'latitude-deg'), lon = find(n, 'longitude-deg');
        if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && (find(n, 'valid') !== false)) {
          out.push({
            id: String(find(n, 'callsign') || find(n, 'model-short') || find(n, 'sim/model/path') || `${n.name}${n.index || ''}`).replace(/^.*\//, '').replace(/\.xml$/i, '').slice(0, 10),
            path: String(find(n, 'sim/model/path') || find(n, 'path') || find(n, 'model-short') || find(n, 'model') || ''),
            model: String(find(n, 'model-short') || find(n, 'type') || '').slice(0, 14),
            lat: Number(lat), lon: Number(lon),
            alt: Number(find(n, 'altitude-ft')) * 0.3048,
            hdg: Number(find(n, 'true-heading-deg') !== undefined ? find(n, 'true-heading-deg') : find(n, 'heading-deg')) || 0,
            spd: Number(find(n, 'true-airspeed-kt')) * 0.514444 || 0,
          });
        }
        return;
      }
      (n.children || []).forEach(walk);
    };
    walk(tree);
    return out;
  }

  /** Only gliders carry FLARM here. Recognised from the model name/path (AI models and multiplayer). */
  const GLIDER_WORDS = ['glider', 'sailplane', 'ask21', 'ask-21', 'ask13', 'ask-13', 'ask23', 'asw', 'asw28', 'discus', 'ventus', 'nimbus', 'janus', 'ls1','duo-discus','duodiscus','club-astir','std-cirrus', 'ls3', 'ls4', 'ls6', 'ls8', 'ls10', 'lak', 'libelle', 'cirrus', 'mdm', 'pik', 'dg-', 'dg1', 'dg2', 'dg5', 'dg8', 'dg3', 'grob', 'g102', 'g103', 'astir', 'jantar', 'zuni', 'ka6', 'ka7', 'ka8', 'ka13', 'schleicher', 'schempp', 'rolladen', 'blanik', 'l-13', 'l13', 'slingsby', 'kestrel', 'skylark', 'olympia', 'k-21', 'k21', 'arcus', 'quintus', 'antares', 'stemme', 'diana', 'jonker', 'jsm', 'sparrowhawk', 'puchacz', 'bocian', 'zefir', 'sb1', 'sb10', 'schweizer', '2-33', '1-26', '1-34', '1-35'];
  function isGlider(m, extra) {
    const hay = ((m.path || '') + ' ' + (m.model || '') + ' ' + (m.id || '')).toLowerCase().replace(/^.*aircraft\//, '');
    const words = GLIDER_WORDS.concat(String(extra || '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
    return words.some((w) => hay.indexOf(w) >= 0);
  }

  /** Alarm level from the time to the closest point of approach. */
  function alarmFor(rel, ownV, tgtV) {
    const rx = rel.e, ry = rel.n;
    const vx = tgtV.e - ownV.e, vy = tgtV.n - ownV.n;
    const v2 = vx * vx + vy * vy;
    if (v2 < 1) return 0;
    const t = -(rx * vx + ry * vy) / v2;
    if (t <= 0 || t > 18) return 0;
    const mx = rx + vx * t, my = ry + vy * t;
    if (Math.hypot(mx, my) > MISS) return 0;
    return t <= 8 ? 3 : t <= 12 ? 2 : 1;
  }

  class AiTraffic {
    constructor(o) { this.o = o; this.timer = null; this.list = []; this.err = null; this.paths = {}; }
    start() { this.poll(); this.timer = setInterval(() => this.poll(), 2000); }
    stop() { clearInterval(this.timer); }
    async poll() {
      try {
        const r = await fetch(`http://${this.o.host}:${this.o.port}/json/ai/models?d=3`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const list = parseModels(await r.json());
        const now = performance.now() / 1000;
        list.forEach((m) => { // vertical speed from successive polls
          const p = this.prev && this.prev[m.id];
          m.vs = p && now - p.t > 0.5 ? (m.alt - p.alt) / (now - p.t) : (p ? p.vs : 0);
        });
        this.prev = {}; list.forEach((m) => { this.prev[m.id] = { alt: m.alt, t: now, vs: m.vs }; });
        // a target that disappears stays (blinking) for the "lost device" time, default 120 s
        const seen = new Set(list.map((m) => m.id));
        (this.list || []).forEach((m) => {
          if (seen.has(m.id)) return;
          const since = m.lostAt || now;
          if (now - since < 120) list.push(Object.assign({}, m, { lostAt: since, lostFor: now - since + 0.001 }));
        });
        this.list = list;
        list.forEach((m) => { // flown paths (one point per poll, about the last 3 minutes)
          if (m.lostFor) return;
          const a = (this.paths[m.id] = this.paths[m.id] || []); a.push([m.lat, m.lon]); if (a.length > 90) a.shift();
        });
        Object.keys(this.paths).forEach((k) => { if (!seen.has(k) && !list.some((m) => m.id === k)) delete this.paths[k]; });
        this.err = null;
      } catch (e) { this.err = e.message; this.list = []; }
    }
  }

  /** Relative targets (track-up frame, metres) with alarm levels, from AI models. */
  function relativeFromModels(models, f, opt) {
    if (opt && opt.glidersOnly) {
      const gl = [], other = [];
      models.forEach((m) => (isGlider(m, opt.keywords) ? gl : other).push(m));
      // powered traffic is not seen by FLARM but by PCAS (transponder): distance and height only, no direction
      if (opt.pcas) other.forEach((m) => { const o = geo.enu(f.lat, f.lon, m.lat, m.lon); const d = Math.hypot(o.e, o.n); if (d < 20000) opt.pcas.push({ id: m.id, dist: d, dh: m.alt - f.alt }); });
      models = gl;
    }
    const A = f.track * Math.PI / 180;
    const own = { e: Math.sin(A) * f.gs, n: Math.cos(A) * f.gs };
    return models.map((m) => {
      const o = geo.enu(f.lat, f.lon, m.lat, m.lon);
      const H = m.hdg * Math.PI / 180;
      const tv = { e: Math.sin(H) * m.spd, n: Math.cos(H) * m.spd };
      const dist = Math.hypot(o.e, o.n);
      return {
        id: m.id, model: m.model, lostFor: m.lostFor, lat: m.lat, lon: m.lon, vs: m.vs || 0, e: o.e * Math.cos(A) - o.n * Math.sin(A), n: o.e * Math.sin(A) + o.n * Math.cos(A),
        track: m.hdg, dh: m.alt - f.alt, dist, alarm: m.lostFor ? 0 : alarmFor(o, own, tv),
      };
    }).filter((t) => t.dist < 20000);
  }

  LX.AiTraffic = AiTraffic;
  LX.aiTools = { isGlider, parseModels, alarmFor, relativeFromModels };
})(window);
