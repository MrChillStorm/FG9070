/**
 * Navigation pages for Airport / Waypoint / Task modes (manual ch. 7.5-7.8, 8).
 *
 *   page 1  map + final glide + wind/thermal assistant + navbox row
 *   page 2  like page 1 with a second data row
 *   page 3  map + side view
 *   page 4  FLARM radar + altitude / temperature data
 *   page 5  target airport information
 *   page 6  vario page (indicator + tape + speed-to-fly) – the Vario/Info page
 *
 * Soft-key sets (dynamic buttons, manual 8.2): MORE>> cycles through three sets.
 * Thermal mode (7.8): when circling is detected the map zooms to the thermal
 * zoom and returns to the previous scale when circling stops; rotating PAGE or
 * ZOOM leaves thermal mode manually.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const sym = LX.symbols;
  const { ZOOMS } = LX.Map;
  const clamp = LX.util.clamp;

  /* --------------------------------------------------------------- traffic */
  /** FLARM traffic: simulated, or FlightGear AI/multiplayer models (see ai-traffic.js). */
  class Traffic {
    constructor() {
      this.list = [
        { id: 'D-1234', th: 40, d: 2600, w: 0.004, dh: 80, track: 120 },
        { id: 'OE-5678', th: 200, d: 4200, w: -0.003, dh: -150, track: 300 },
        { id: 'HB-9999', th: 310, d: 1500, w: 0.006, dh: 20, track: 45 },
      ];
      this.t = 0;
    }
    /** Non-directional (PCAS) contacts found by the last relative() call: [{ id, dist, dh }]. */
    pcas() { return LX.settings.get().showPcas ? (this._pcas || []) : []; }
    /** Flown paths of other aircraft: { id: [[lat, lon], ...] } (FlightGear AI only). */
    paths() { return LX.settings.get().trafficPaths === 'all' ? (this.pathsSrc || {}) : {}; }
    /** Targets in the ownship track-up frame (metres). */
    relative(f, dt) {
      const mode = this.mode ? this.mode() : 'demo';
      if (mode === 'off') return [];
      this._pcas = [];
      if (mode === 'fg') return LX.aiTools ? LX.aiTools.relativeFromModels(this.models || [], f, { glidersOnly: this.filter && this.filter().glidersOnly, keywords: this.filter && this.filter().keywords, pcas: this._pcas }) : [];
      this.t += dt;
      return this.list.map((o) => {
        const th = (o.th + this.t * o.w * 180 / Math.PI * 4) % 360;
        const d = o.d + 800 * Math.sin(this.t / 20 + o.th);
        const e = Math.sin(th * Math.PI / 180) * d, n = Math.cos(th * Math.PI / 180) * d;
        const A = f.track * Math.PI / 180;
        const dist = Math.hypot(e, n);
        return {
          lat: f.lat + n / 111320, lon: f.lon + e / (111320 * Math.cos(f.lat * Math.PI / 180)), vs: 0,
          id: o.id, e: e * Math.cos(A) - n * Math.sin(A), n: e * Math.sin(A) + n * Math.cos(A),
          track: (th + 90) % 360, dh: o.dh, dist, alarm: dist < 900 ? 3 : dist < 1400 ? 2 : dist < 2000 ? 1 : 0,
        };
      });
    }
  }

  /* ------------------------------------------------------------ formatters */
  const fm = {
    vario: (v) => LX.fmt.signed(LX.units.vario(v), LX.fmt.varioDigits()),
    dist: (m) => LX.fmt.num(LX.units.dist(m), LX.units.dist(m) < 100 ? 1 : 0),
    alt: (m) => LX.fmt.num(LX.units.alt(m), 0),
    spd: (ms) => LX.fmt.num(LX.units.speed(ms), 0),
    ratio: (r) => (!isFinite(r) || r > 99 || r <= 0 ? '∞' : LX.fmt.num(r, 0)),
    hdg: (d) => LX.fmt.num(Math.round(geo.wrap360(d)) % 360, 0) + '°',
    hms: (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; },
    time: (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; },
  };
  LX.fm = fm;

  const elev = (E, N) => 150 + 1700 * LX.Map.terrain(E, N); // procedural terrain height, m

  /* -------------------------------------------------------------- the view */
  class NavView extends LX.View {
    constructor(scr, ctx, modeId, kind, cid) {
      super(scr);
      this.ctx = ctx;
      this.modeId = modeId;
      this.kind = kind;
      this.cid = cid; // custom layout page id
      if (kind === 'custom') {
        const cp = (ctx.settings.get().customPages || {})[cid] || {};
        this.els = JSON.parse(JSON.stringify(cp.els || [])); this.fontScale = cp.fontScale || 100;
      }
      this.skSet = 0;
      this.thermalOverride = false;
      this.lastDraw = 0;
      this.lastShown = {};
      this.mapR = new LX.Map.Renderer();

      this.cv = document.createElement('canvas');
      this.cv.className = 'layer';
      this.el.appendChild(this.cv);
      this.c = this.cv.getContext('2d');

      this.status = document.createElement('div');
      this.status.className = 'statusbar';
      this.status.innerHTML = '<canvas class="gps" width="34" height="16"></canvas><span class="target"></span><span class="relbrg"></span><span class="clock"></span><span class="batt"><b></b></span>';
      this.el.appendChild(this.status);
      this.gpsC = this.status.querySelector('canvas').getContext('2d');

      this.row = document.createElement('div');
      this.row.className = 'navrow';
      this.el.appendChild(this.row);
      this.boxes = [];
      if (kind === 'apt') this.row.style.display = 'none';

      if (kind === 'apt' || kind === 'ttimes') {
        this.info = document.createElement('div');
        this.info.className = 'pre';
        this.info.style.cssText = 'position:absolute;left:0;right:0;top:30px;bottom:0;';
        this.el.appendChild(this.info);
      }
      this.buildRow();
    }

    /* ---------------------------------------------------------- navbox rows */
    /** The page's navboxes: the user's layout (LAYOUT button) or the manual's default. */
    helper() {
      const ctx = this.ctx;
      return { f: ctx.flight.f, ctx, modeId: this.modeId, nav: ctx.navFor(this.modeId, ctx.flight.f) };
    }
    layoutKey() { return this.modeId + '.' + this.kind; }
    spec() {
      return LX.navboxes.layoutFor(this.modeId, this.kind).map((id) => [LX.navboxes.title(id), () => LX.navboxes.get(id, this.helper())]);
    }

    buildRow() {
      if (this.kind === 'custom') { LX.layout.buildBoxes(this); return; }
      this.row.innerHTML = '';
      this.boxes = [];
      this.spec().forEach((b) => {
        const d = document.createElement('div');
        d.className = 'navbox';
        d.innerHTML = '<div class="t"></div><div class="v"></div>';
        d.firstChild.textContent = b[0];
        this.row.appendChild(d);
        this.boxes.push({ el: d, v: d.lastChild, fn: b[1], last: '' });
      });
      // page 2 shows an additional row on top of the first (manual 7.5.2): keep it simple – 5 boxes
    }

    refreshRow() {
      this.boxes.forEach((b) => {
        const [v, u] = b.fn();
        const key = v + '|' + u;
        if (key !== b.last) { b.v.innerHTML = ''; b.v.append(v); if (u) { const s = document.createElement('small'); s.textContent = u; b.v.append(s); } b.last = key; }
      });
    }

    /* ----------------------------------------------------------- lifecycle */
    show() { this.resize(); }

    resize() {
      const d = LX.device;
      const r = Math.max(1, Math.ceil((d.scale || 1) * (window.devicePixelRatio || 1)));
      this.cv.width = d.w * r; this.cv.height = d.h * r;
      this.cv.style.width = d.w + 'px'; this.cv.style.height = d.h + 'px';
      this.c.setTransform(r, 0, 0, r, 0, 0);
      this.W = d.w; this.H = d.h;
      this.buildRow();
      this.lastDraw = 0;
    }

    update(dt, now) {
      const nowMs = now || performance.now();
      if (nowMs - this.lastDraw < 70) return; // ~14 fps is plenty for a map page
      this.lastDraw = nowMs;
      const f = this.ctx.flight.f;
      if (!f || !this.ctx.flight.have) { this.drawNoFix(); return; }
      const c0 = this.c;
      this.refreshRow();
      this.drawStatus(f);
      switch (this.kind) {
        case 'map': case 'map2': case 'tmap2': case 'ttime': this.drawMapPage(f, false); break;
        case 'ttimes': this.drawTaskTimes(f); break;
        case 'side': this.drawMapPage(f, true); break;
        case 'flarm': this.drawFlarmPage(f, dt); break;
        case 'vario': this.drawVarioPage(f); break;
        case 'pfd': this.drawPfd(f); break;
        case '3d': this.draw3D(f); break;
        case 'meteo': { const tg = this.ctx.nav.target(this.modeId === 'tsk' ? 'apt' : this.modeId) || this.ctx.nav.target('apt'); c0.fillStyle = '#000'; c0.fillRect(0, 0, this.W, this.H); if (tg) LX.meteogram.draw(c0, { x: 0, y: 30, w: this.W, h: this.H - 30 }, tg, `${tg.name}${tg.code ? ' ' + tg.code : ''}  forecast`); break; }
        case 'apt': this.drawAptPage(f); break;
        case 'custom': LX.layout.draw(this, f); break;
      }
    }

    drawNoFix() {
      const c = this.c;
      c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H);
      sym.otext(c, 'Waiting for data…', this.W / 2, this.H / 2, 22, { align: 'center' });
      sym.otext(c, this.ctx.statusText(), this.W / 2, this.H / 2 + 28, 14, { align: 'center', weight: 'normal' });
    }

    /* ------------------------------------------------------------ status bar */
    drawStatus(f) {
      const prefix = { apt: 'Apt', wpt: 'Wpt', tsk: 'Tsk' }[this.modeId];
      const tg = this.ctx.nav.target(this.modeId);
      const sd = this.status.children;
      const name = `${prefix}:${tg ? tg.name : '---'}`;
      if (this.lastShown.n !== name) { sd[1].textContent = name; this.lastShown.n = name; }
      const nav = this.ctx.navFor(this.modeId, f);
      const rb = nav ? Math.round(nav.relBearing) : null;
      const rbs = rb === null ? '' : `${Math.abs(rb)}°${rb < 0 ? '«' : '»'}`;
      if (this.lastShown.r !== rbs) { sd[2].textContent = rbs; this.lastShown.r = rbs; }
      const t = new Date();
      const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      if (this.lastShown.t !== ts) { sd[3].textContent = ts; this.lastShown.t = ts; }
      this.gpsC.clearRect(0, 0, 34, 16);
      sym.gpsBars(this.gpsC, 2, 0, 10);
    }

    /* -------------------------------------------------------------- map page */
    /** Optimised flown path (OLC/FAI free distance of the recorded track), recomputed every 10 s. */
    optPath() {
      const h = this.ctx.history, now = performance.now();
      if (h.length < 30) return null;
      if (!this._opt || now - this._opt.t > 10000) {
        const fixes = h.map((p, i) => [i * 2, p[0], p[1], 0]);
        const r = LX.Optimizer.free(fixes, this.ctx.settings.get().optPoints === 3 ? 1 : 3, 120);
        this._opt = { t: now, pts: r.pts.map((p) => [p.lat, p.lon]) };
      }
      return this._opt.pts;
    }

    /** Largest triangle of the recorded track (not necessarily FAI), recomputed every 10 s (manual 7.1.7.7: show optimized triangle). */
    optTriangle() {
      const h = this.ctx.history, now = performance.now();
      if (h.length < 30) return null;
      if (!this._tri || now - this._tri.t > 10000) {
        const fixes = h.map((p, i) => [i * 2, p[0], p[1], 0]);
        const r = LX.Optimizer.triangle(fixes, 70);
        this._tri = { t: now, pts: r ? r.pts.map((p) => [p.lat, p.lon]) : null };
      }
      return this._tri.pts;
    }

    /** Glider range area (manual 7.1.7.5): outline of where final glide at the safety Mc reaches the safety altitude, once a second. */
    glideRange(f, s) {
      const now = performance.now();
      if (this._ra && now - this._ra.t < 1000) return this._ra.ring;
      const flight = this.ctx.flight, pol = flight.getPolar();
      const usable = Math.max(0, f.alt - this.ctx.groundElev(f) - s.safetyAlt);
      const mcSafe = Math.max(0, s.mc + s.mcOffset);
      const ring = [];
      for (let b = 0; b < 360; b += 10) {
        const r = LX.polar.finalGlide(pol, { mc: mcSafe, dist: 1000, alt: f.alt, targetElev: 0, safety: 0, headwind: flight._headwindAlong(b) }).ratio * usable;
        const p = geo.dest(f.lat, f.lon, b, r);
        ring.push([p.lat, p.lon]);
      }
      this._ra = { t: now, ring };
      return ring;
    }

    /** The map in `rect` with all its overlays on the map itself; returns what the symbols around it need. */
    mapCore(f, rect) {
      const c = this.c, W = this.W;
      const s = this.ctx.settings.get();
      // thermal mode (manual 7.1.7.6 / 7.8): switch by circling (after the switch angle) or by SC -> Vario
      let thermal = false;
      if (s.thermalMode !== false) {
        if (s.thermalSwitch === 'scvar') thermal = f.mode === 'vario';
        else {
          if (!f.circling) this._thermalLatch = false;
          else if ((f.turnAngle || 0) >= (s.thermalAngle || 270)) this._thermalLatch = true;
          thermal = !!this._thermalLatch;
        }
      }
      if (!thermal) this.thermalOverride = false;
      const circling = thermal && !this.thermalOverride;
      let zi = clamp(s.mapZoom, 0, ZOOMS.length - 1);
      if (circling) zi = clamp(s.thermalZoom === undefined ? 1 : s.thermalZoom, 0, ZOOMS.length - 1);
      const scaleKm = ZOOMS[zi];
      const mpp = (scaleKm * 1000) / 100;
      const nav = this.ctx.navFor(this.modeId, f);
      const up = circling ? 'north' : (s.mapUp || 'track');
      // PAN: the view centre moves away from the glider (which stays drawn at its true position)
      let cLat = f.lat, cLon = f.lon, own = null;
      if (this.panMode && this.pan) {
        const d = Math.hypot(this.pan.e, this.pan.n);
        if (d > 0) { const c2 = geo.dest(f.lat, f.lon, (Math.atan2(this.pan.e, this.pan.n) * 180 / Math.PI + 360) % 360, d); cLat = c2.lat; cLon = c2.lon; own = { lat: f.lat, lon: f.lon }; }
      }
      const org = geo.enu(this.ctx.ref.lat, this.ctx.ref.lon, cLat, cLon);
      const vp = {
        lat: cLat, lon: cLon, own, track: f.track, mpp, scaleKm, rect, tiles: s.tiles, dem: this.ctx.dem,
        cx: rect.x + rect.w / 2, cy: rect.y + rect.h * (up === 'track' ? 0.62 : 0.52), up, night: s.night,
        originE: org.e, originN: org.n,
      };
      // terrain check on the glide to the target, refreshed about once a second
      const nowT = performance.now();
      if (!this._tc || nowT - this._tc.t > 1000) this._tc = { t: nowT, v: nav ? this.ctx.dem.clearance(f, nav, s.safetyAlt, geo) : null };
      const tclear = this._tc.v;
      sym.setFlarmColors({ above: s.flarmAbove, near: s.flarmNear, below: s.flarmBelow });
      const fWith = Object.assign({}, f, { nav });
      const fai = s.showFai && this.ctx.flight.have && this.ctx.history.length > 20
        ? { S: this.ctx.flightStart || { lat: this.ctx.history[0][0], lon: this.ctx.history[0][1] }, P: { lat: f.lat, lon: f.lon }, side: this.ctx.faiSide === undefined ? 1 : this.ctx.faiSide, min: s.optFaiMin || 0.28, alpha: s.faiAlpha / 100, color: s.faiColor || '#ffd400', km: s.faiKmLines } : null;
      this.mapR.draw(c, vp, {
        opt: s.showOpt ? this.optPath() : null,
        fai, nav: this.ctx.nav, f: fWith, history: this.ctx.history,
        thermals: s.showThermals !== false ? this.ctx.flight.thermals : null,
        airspaces: s.showAirspace !== false ? this.ctx.nav.airspaces : null,
        mc: s.mc, safety: s.safetyAlt, collision: tclear, range: s.showGlideArea ? this.glideRange(f, s) : null,
        style: circling ? Object.assign({}, s, { pathLength: s.thermalPathLength, pathStyle: s.thermalPathStyle, pathWidth: s.thermalPathWidth }) : s,
        optTri: s.showOpt && s.showOptTriangle ? this.optTriangle() : null,
        traffic: this.ctx.traffic.relative(f, 0), pcas: this.ctx.traffic.pcas(), paths: this.ctx.traffic.paths(),
      });
      return { nav, up, tclear, scaleKm, mpp };
    }

    drawMapPage(f, withSide) {
      const c = this.c, W = this.W, H = this.H;
      const s = this.ctx.settings.get();
      const navH = this.row.offsetHeight || 52;
      const sideH = withSide ? Math.round(H * 0.34) : 0;
      const rect = { x: 0, y: 0, w: W, h: H - navH - sideH };
      const { nav, up, tclear, scaleKm, mpp } = this.mapCore(f, rect);
      // overlays
      sym.northArrow(c, 26, 52, up === 'track' ? f.track : 0);
      sym.finalGlide(c, W - 64, rect.y + rect.h / 2 - 65, nav, s.mc, this.modeId === 'tsk' ? this.ctx.runner.prefix() : '', tclear ? tclear.climb : 0);
      const r = 46;
      sym.windThermal(c, 56, rect.y + rect.h - r - 22, r, f, this.ctx.flight.bins, s.mc, up === 'track' ? f.track : 0);
      sym.zoomScale(c, W - 14, rect.y + rect.h - 12, scaleKm, mpp);

      if (withSide) {
        const brg = nav ? nav.bearing : f.track;
        const tf = (d) => { const p = geo.dest(f.lat, f.lon, brg, d); const h = this.ctx.dem.elevation(p.lat, p.lon, 300); if (h !== undefined) return h; const o = geo.enu(this.ctx.ref.lat, this.ctx.ref.lon, p.lat, p.lon); return elev(o.e, o.n); };
        sym.sideView(c, 0, rect.h, W, sideH, f, nav, tf, s.safetyAlt);
      }
    }

    /* ----------------------------------------------------------- flarm page */
    drawFlarmPage(f, dt) {
      const c = this.c, W = this.W, H = this.H;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      const navH = this.row.offsetHeight || 52;
      const r = Math.min(W, H - navH - 40) * (LX.device.portrait ? 0.42 : 0.44);
      const cx = LX.device.portrait ? W / 2 : W * 0.36;
      const cy = 36 + (H - navH - 36) / 2 - (LX.device.portrait ? 60 : 0);
      const targets = this.ctx.traffic.relative(f, 0.07);
      const near = targets.reduce((m, t) => Math.min(m, t.dist), Infinity);
      const RR = [1000, 2500, 5000, 10000, 20000];
      const range = this.radarRange !== undefined ? RR[this.radarRange] : near < 1800 ? 2500 : near < 3800 ? 5000 : near < 8000 ? 10000 : 20000; // ZOOM knob sets it, else automatic
      const nv = this.ctx.navFor(this.modeId, f);
      const pol = this.ctx.flight.getPolar();
      const ldMc = pol ? LX.polar.finalGlide(pol, { mc: this.ctx.settings.get().mc, dist: 1000, alt: 0, targetElev: 0 }).ratio : 0;
      sym.flarmRadar(c, cx, cy, r, f, targets, 'track', range, { pcas: this.ctx.traffic.pcas(), ld: ldMc });
      // traffic list
      c.textAlign = 'left';
      let x = LX.device.portrait ? 16 : W * 0.68, y = LX.device.portrait ? cy + r + 28 : 70;
      sym.otext(c, { demo: 'FLARM traffic (simulated)', fg: 'FLARM traffic (FlightGear)', off: 'FLARM traffic (off)' }[this.ctx.traffic.mode()] || 'FLARM traffic', x, y - 24, 13, { weight: 'normal', color: '#8fb6ff' });
      targets.sort((a, b) => a.dist - b.dist).forEach((t, i) => {
        const col = t.alarm >= 3 ? '#ff3b30' : t.alarm >= 1 ? '#ffd400' : sym.flarmColor(t);
        sym.otext(c, `${t.id}${t.model ? ' · ' + t.model : ''}`, x, y + i * 40, 15, { color: col });
        sym.otext(c, `${fm.dist(t.dist)}${LX.units.label('dist')}  ${(t.dh >= 0 ? '+' : '−')}${Math.abs(Math.round(LX.units.alt(t.dh)))}${LX.units.label('alt')}${Math.abs(t.vs) > 0.3 ? (t.vs > 0 ? '  ▲' : '  ▼') + fm.vario(t.vs) : ''}`, x, y + i * 40 + 17, 13, { weight: 'normal' });
      });
    }

    /* ------------------------------------------------------------ vario page */
    drawVarioPage(f) {
      const c = this.c, W = this.W, H = this.H, s = this.ctx.settings.get();
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      const navH = this.row.offsetHeight || 52;
      const area = { y: 30, h: H - navH - 30 };
      const portrait = LX.device.portrait;
      const r = portrait ? Math.min(W / 2 - 50, 190) : Math.min(area.h / 2 - 6, 200);
      const cx = portrait ? W / 2 - 30 : r + 20;
      const cy = area.y + (portrait ? r + 10 : area.h / 2);
      // needle shows TE in climb mode, speed-to-fly relative in cruise (simplified: netto)
      const value = f.mode === 'vario' ? f.te : f.te;
      sym.varioIndicator(c, cx, cy, r, f, {
        range: s.varioRange, value, mc: s.mc, avg: f.avgV, thermalAvg: this.ctx.flight.lastThermalAvg(),
      });
      sym.varioTape(c, cx + r + 14, cy - r, 46, r * 2, value, s.varioRange);
      // speed-to-fly block
      const bx = portrait ? 16 : cx + r + 80, by = portrait ? cy + r + 24 : area.y + 6;
      const rows = [
        ['TE vario', fm.vario(f.te) + ' ' + LX.units.label('vario')],
        ['Netto', fm.vario(f.netto) + ' ' + LX.units.label('vario')],
        ['Average', fm.vario(f.avgV) + ' ' + LX.units.label('vario')],
        ['Speed to fly', fm.spd(f.stf) + ' ' + LX.units.label('speed')],
        ['Δ to STF', LX.fmt.signed(LX.units.speed(f.stfDelta), 0) + ' ' + LX.units.label('speed')],
        ['Mode', f.mode === 'vario' ? 'CLIMB (vario)' : 'CRUISE (SC)'],
      ];
      rows.forEach((rw, i) => {
        const col = portrait ? i % 2 : 0, row = portrait ? Math.floor(i / 2) : i;
        const x = bx + col * (W / 2 - 10), y = by + row * (portrait ? 44 : 56);
        sym.otext(c, rw[0], x, y + 14, 12, { weight: 'normal', color: '#8fb6ff' });
        sym.otext(c, rw[1], x, y + 40, portrait ? 22 : 28, {});
      });
    }

    /* ------------------------------------------------------ instrument page */
    /** Artificial horizon + airspeed / altitude / vario tapes + compass tape (manual 8.3.13-8.3.19). */
    /** Synthetic vision (manual 8.3.21): heightfield ray-march of the terrain ahead (DEM where loaded,
        procedural elsewhere) with the active target and task points as markers. Not for navigation. */
    draw3D(f) {
      const c = this.c, W = this.W, H = this.H, s = this.ctx.settings.get(), geo = LX.geo, ctx = this.ctx;
      const navH = this.row.offsetHeight || 52;
      const top = 30, bot = H - navH, vh = bot - top, cx = W / 2;
      const night = s.night ? 0.7 : 1;
      const hdg = f.track && f.gs > 3 ? f.track : f.hdg;
      const fov = 70 * Math.PI / 180, focal = (W / 2) / Math.tan(fov / 2);
      const horizon = top + vh * 0.5 + f.pitch * 3 * 0 ;
      const dem = ctx.dem && ctx.dem.enabled() ? ctx.dem : null;
      const org = geo.enu(ctx.ref.lat, ctx.ref.lon, f.lat, f.lon);
      const cosLat = Math.cos(f.lat * Math.PI / 180);
      const maxD = 30000, cols = Math.ceil(W / 3);
      // sky
      const sky = c.createLinearGradient(0, top, 0, horizon);
      sky.addColorStop(0, `rgb(${40 * night | 0},${100 * night | 0},${190 * night | 0})`); sky.addColorStop(1, `rgb(${150 * night | 0},${190 * night | 0},${230 * night | 0})`);
      c.fillStyle = sky; c.fillRect(0, top, W, horizon - top);
      c.fillStyle = `rgb(${120 * night | 0},${150 * night | 0},${130 * night | 0})`; c.fillRect(0, horizon, W, bot - horizon);
      c.save(); c.beginPath(); c.rect(0, top, W, vh); c.clip();
      const hAt = (e, n) => {
        let h;
        if (dem) h = dem.elevation(f.lat + n / 111320, f.lon + e / (111320 * cosLat), 250 + Math.hypot(e, n) / 60);
        return h === undefined || h === null ? 150 + 1700 * LX.Map.terrain(e + org.e, n + org.n) : h;
      };
      const colW = Math.ceil(W / cols);
      let worst = Infinity;
      for (let k = 0; k < cols; k++) {
        const px = k * colW + colW / 2;
        const ang = (hdg + Math.atan((px - cx) / focal) * 180 / Math.PI) * Math.PI / 180;
        const de = Math.sin(ang), dn = Math.cos(ang);
        let ymin = bot; // lowest unoccluded screen row so far (draw far -> near is wasteful; go near -> far)
        let step = 60, hPrev = null;
        for (let d = 120; d < maxD; d += step, step *= 1.035) {
          const h = hAt(de * d, dn * d);
          const dz = Math.cos(Math.atan((px - cx) / focal)) * d; // depth along the view axis
          const y = horizon + ((f.alt - h) / dz) * focal - 0; // screen y of the terrain point
          const hp = hPrev; hPrev = h;
          if (y < ymin) {
            const hPrev = hp;
            const t = Math.min(1, Math.max(0, h / 3200));
            const col = LX.Map.ramp(t);
            const fog = Math.min(0.85, d / maxD), sh = 1 - fog;
            const lit = hPrev === null ? 0 : Math.max(-0.5, Math.min(0.5, ((hPrev - h) / step) * 3.2)); // slopes facing us are lit
            const sc = (v, add) => Math.max(0, Math.min(255, ((v + lit * add) * sh + (add ? 0 : 0))));
            c.fillStyle = `rgb(${((sc(col[0], 110) + 160 * fog) * night) | 0},${((sc(col[1], 110) + 190 * fog) * night) | 0},${((sc(col[2], 100) + 225 * fog) * night) | 0})`;
            c.fillRect(k * colW, y, colW, ymin - y + 1);
            ymin = y;
          }
          if (ymin <= top) break;
        }
        if (Math.abs(px - cx) < colW) worst = ymin;
      }
      // markers: active target and task points
      const nav = ctx.navFor(this.modeId, f), pts = [];
      const tg = ctx.nav.target(this.modeId);
      if (tg) pts.push({ n: tg.name, lat: tg.lat, lon: tg.lon, big: true });
      if (this.modeId === 'tsk') ctx.nav.task.forEach((p) => { if (p.wp !== tg) pts.push({ n: p.wp.name, lat: p.wp.lat, lon: p.wp.lon }); });
      pts.forEach((m) => {
        const dd = geo.dist(f.lat, f.lon, m.lat, m.lon);
        if (dd < 300 || dd > maxD * 1.6) return;
        const rb = ((geo.bearing(f.lat, f.lon, m.lat, m.lon) - hdg + 540) % 360) - 180;
        if (Math.abs(rb) > 36) return;
        const px = cx + Math.tan(rb * Math.PI / 180) * focal;
        const hh = dem ? dem.elevation(m.lat, m.lon, 300) : undefined;
        const ground = hh === undefined ? (m.big && nav ? f.alt - (nav.arrival !== undefined ? 0 : 0) : f.alt - 300) : hh;
        const py = Math.max(top + 14, Math.min(bot - 14, horizon + ((f.alt - ground) / dd) * focal));
        c.strokeStyle = m.big ? '#ffd400' : '#fff'; c.lineWidth = m.big ? 3 : 2;
        c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - 34); c.stroke();
        sym.otext(c, m.n, px, py - 40, m.big ? 14 : 12, { align: 'center' });
      });
      c.restore();
      // horizon line, heading tape and aircraft reference
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, horizon); c.lineTo(W, horizon); c.stroke();
      sym.otext(c, `${String(Math.round(hdg) % 360).padStart(3, '0')}°`, cx, top + 16, 16, { align: 'center' });
      sym.otext(c, `Alt ${LX.fm.alt(f.alt)} ${LX.units.label('alt')}   AGL ${LX.fm.alt(f.alt - ctx.groundElev(f))}`, 8, bot - 10, 13, { weight: 'normal' });
      sym.otext(c, dem && ctx.dem.stats.loaded ? 'DEM terrain' : 'Synthetic terrain (no DEM loaded)', W - 8, bot - 10, 12, { align: 'right', weight: 'normal' });
      c.strokeStyle = '#ffd400'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - 24, horizon + 30); c.lineTo(cx, horizon + 18); c.lineTo(cx + 24, horizon + 30); c.stroke();
    }

    drawPfd(f) {
      const c = this.c, W = this.W, H = this.H, s = this.ctx.settings.get();
      const navH = this.row.offsetHeight || 52;
      const top = 30, bot = H - navH, tapeW = Math.round(W * 0.14);
      const hx = tapeW, hw = W - 2 * tapeW - 50, hy = top + 28, hh = bot - hy;
      const cx = hx + hw / 2, cy = hy + hh / 2, K = 5;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      // horizon
      c.save(); c.beginPath(); c.rect(hx, hy, hw, hh); c.clip();
      c.translate(cx, cy); c.rotate(-f.roll * Math.PI / 180); c.translate(0, f.pitch * K);
      c.fillStyle = '#2b78d0'; c.fillRect(-1500, -3000, 3000, 3000);
      c.fillStyle = '#8a5a2b'; c.fillRect(-1500, 0, 3000, 3000);
      c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 2; c.font = 'bold 13px Verdana'; c.textAlign = 'left';
      c.beginPath(); c.moveTo(-1500, 0); c.lineTo(1500, 0); c.stroke();
      for (let p = -90; p <= 90; p += 5) {
        if (!p) continue;
        const y = -p * K, long = p % 10 === 0, half = long ? 40 : 18;
        c.beginPath(); c.moveTo(-half, y); c.lineTo(half, y); c.stroke();
        if (long) { c.textAlign = 'right'; c.fillText(String(Math.abs(p)), -half - 5, y + 4); c.textAlign = 'left'; c.fillText(String(Math.abs(p)), half + 5, y + 4); }
      }
      c.restore();
      // aircraft symbol + roll index
      c.strokeStyle = '#ffd400'; c.lineWidth = 4; c.beginPath();
      c.moveTo(cx - 80, cy); c.lineTo(cx - 28, cy); c.lineTo(cx - 28, cy + 10); c.moveTo(cx + 80, cy); c.lineTo(cx + 28, cy); c.lineTo(cx + 28, cy + 10); c.stroke();
      c.fillStyle = '#ffd400'; c.fillRect(cx - 3, cy - 3, 6, 6);
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cx, hy + 4); c.lineTo(cx - 7, hy + 18); c.lineTo(cx + 7, hy + 18); c.fill();
      // compass tape (top)
      this.tapeH(c, hx, top, hw, 24, f.hdg, f.track);
      // airspeed tape (left): window of +-30 in display units
      const spd = LX.units.speed(f.ias);
      this.tapeV(c, 0, hy, tapeW, hh, spd, 5, 10, 25, 'left', (v) => String(Math.round(v)), { marks: [[LX.units.speed(f.stf), '#29d35a']] });
      // altitude tape (right of horizon)
      const alt = LX.units.alt(f.alt);
      this.tapeV(c, hx + hw, hy, tapeW, hh, alt, 10, 50, 100, 'right', (v) => String(Math.round(v)), {});
      // vario tape
      sym.varioTape(c, W - 48, hy, 46, hh, LX.units.vario(f.te), LX.units.vario(s.varioRange));
      sym.otext(c, `${LX.units.label('speed')}`, tapeW / 2, hy - 6, 11, { align: 'center', weight: 'normal' });
      sym.otext(c, `${LX.units.label('alt')}`, hx + hw + tapeW / 2, hy - 6, 11, { align: 'center', weight: 'normal' });
    }

    /** Vertical scrolling tape. `pxPer` pixels per `unit` ticks every `minor`, labelled every `label`. */
    tapeV(c, x, y, w, h, value, minor, label, span, side, fmtFn, o) {
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      c.fillStyle = 'rgba(10,12,16,.92)'; c.fillRect(x, y, w, h);
      const ppu = h / (2 * span / (span / 25 * 1) * 1) ; // pixels per unit chosen so +-span fills the tape
      const px = (h / 2) / (span * 1.1);
      const mid = y + h / 2;
      c.font = '13px Verdana'; c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.textBaseline = 'middle';
      const v0 = Math.floor((value - span * 1.1) / minor) * minor;
      for (let v = v0; v <= value + span * 1.1; v += minor) {
        const yy = mid - (v - value) * px;
        const major = Math.round(v) % label === 0;
        const x0 = side === 'left' ? x + w - (major ? 16 : 9) : x, x1 = side === 'left' ? x + w : x + (major ? 16 : 9);
        c.beginPath(); c.moveTo(x0, yy); c.lineTo(x1, yy); c.stroke();
        if (major) { c.textAlign = side === 'left' ? 'right' : 'left'; c.fillText(fmtFn(v), side === 'left' ? x + w - 20 : x + 20, yy); }
      }
      (o.marks || []).forEach(([v, col]) => { const yy = mid - (v - value) * px; if (yy > y && yy < y + h) { c.fillStyle = col; c.beginPath(); const xx = side === 'left' ? x + w : x; c.moveTo(xx, yy); c.lineTo(xx + (side === 'left' ? -12 : 12), yy - 7); c.lineTo(xx + (side === 'left' ? -12 : 12), yy + 7); c.fill(); } });
      // value box
      c.fillStyle = '#000'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      const bw = w - 6; c.fillRect(x + 3, mid - 14, bw, 28); c.strokeRect(x + 3, mid - 14, bw, 28);
      c.fillStyle = '#fff'; c.font = 'bold 18px Verdana'; c.textAlign = 'center'; c.fillText(fmtFn(value), x + 3 + bw / 2, mid + 1);
      c.restore();
    }

    /** Horizontal compass tape with a track bug. */
    tapeH(c, x, y, w, h, hdg, track) {
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      c.fillStyle = 'rgba(10,12,16,.92)'; c.fillRect(x, y, w, h);
      const ppd = w / 90, mid = x + w / 2;
      c.font = '12px Verdana'; c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let d = Math.floor(hdg - 50); d <= hdg + 50; d++) {
        if (d % 5) continue;
        const xx = mid + (d - hdg) * ppd, dd = ((d % 360) + 360) % 360;
        c.beginPath(); c.moveTo(xx, y + h); c.lineTo(xx, y + h - (dd % 10 === 0 ? 10 : 5)); c.stroke();
        if (dd % 10 === 0) c.fillText(dd % 90 === 0 ? { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] : String(dd / 10), xx, y + 9);
      }
      const dt = ((track - hdg + 540) % 360) - 180;
      if (Math.abs(dt) < 45) { c.fillStyle = '#ff2fd5'; c.beginPath(); c.moveTo(mid + dt * ppd, y + h); c.lineTo(mid + dt * ppd - 6, y + h - 9); c.lineTo(mid + dt * ppd + 6, y + h - 9); c.fill(); }
      c.fillStyle = '#ffd400'; c.beginPath(); c.moveTo(mid, y + h); c.lineTo(mid - 6, y + h - 8); c.lineTo(mid + 6, y + h - 8); c.fill();
      c.restore();
    }

    /* ---------------------------------------------------- airport info page */
    /** Task page 5 (no map): the task's time values (manual 7.7). */
    drawTaskTimes(f) {
      const c = this.c, n = this.ctx.nav, r = this.ctx.runner, fm2 = fm;
      c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H);
      const fin = n.task.length ? n.task[n.task.length - 1].wp : null;
      const nv = this.ctx.navFor('tsk', f);
      const hhmm = (ms) => { const d = new Date(Date.now() - (f.t - ms)); return d.toTimeString().slice(0, 8); };
      const L = [
        ['Task', n.options.name || 'TASK'],
        ['Task distance', fm.dist(LX.TaskTools.distance(n)) + ' ' + LX.units.label('dist')],
        ['Remaining', fm.dist(LX.TaskTools.remaining(n, f)) + ' ' + LX.units.label('dist')],
        ['Start time', n.started ? hhmm(n.startTime) : '--:--:--'],
        ['Elapsed', n.started ? fm.hms((f.t - n.startTime) / 1000) : '--:--:--'],
        ['ETE finish', nv ? fm.time(nv.ete) : '--:--'],
        ['Finish elevation', fin ? fm.alt(fin.elev || 0) + ' ' + LX.units.label('alt') : '---'],
        ['Task speed', fm.spd(r.taskSpeed(f, f.t)) + ' ' + LX.units.label('speed')],
      ];
      this.info.innerHTML = L.map(([k, v]) => `<span class="k">${k.padEnd(18)}</span>${v}`).join('\n');
    }

    drawAptPage(f) {
      const c = this.c;
      c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H);
      const tg = this.ctx.nav.target(this.modeId);
      const nav = this.ctx.navFor(this.modeId, f);
      const lines = [];
      if (tg) {
        lines.push(`<span class="k">Name</span>      ${tg.name}`);
        lines.push(`<span class="k">Type</span>      ${tg.type}`);
        lines.push(`<span class="k">Position</span>  ${tg.lat.toFixed(4)}°  ${tg.lon.toFixed(4)}°`);
        lines.push(`<span class="k">Elevation</span> ${fm.alt(tg.elev || 0)} ${LX.units.label('alt')}`);
        if (nav) {
          lines.push('');
          lines.push(`<span class="k">Bearing</span>   ${fm.hdg(nav.bearing)}      <span class="k">Distance</span> ${fm.dist(nav.dist)} ${LX.units.label('dist')}`);
          lines.push(`<span class="k">Arrival</span>   ${LX.fmt.signed(LX.units.alt(nav.arrival), 0)} ${LX.units.label('alt')}   <span class="k">ETE</span> ${fm.time(nav.ete)}`);
          lines.push(`<span class="k">Head wind</span> ${LX.fmt.signed(LX.units.speed(nav.headwind), 0)} ${LX.units.label('speed')}`);
        }
        lines.push('');
        const rws = tg.runways || [], fqs = tg.freqs || [];
        if (rws.length) rws.slice(0, 3).forEach((r) => lines.push(`<span class="k">Runway</span>    ${r.le || '?'}/${r.he || '?'}  ${r.len ? fm.alt(r.len) + ' ' + LX.units.label('alt') : ''} ${r.surface || ''}${r.hdg === r.hdg ? '  ' + Math.round(r.hdg) + '\u00B0' : ''}`));
        else if (tg.rwLen) lines.push(`<span class="k">Runway</span>    ${tg.rwLen} m`);
        if (fqs.length) fqs.slice(0, 3).forEach((q) => lines.push(`<span class="k">${(q.type || 'FREQ').padEnd(10)}</span> ${q.mhz ? q.mhz.toFixed(3) : (tg.freq || '')}  ${q.desc || ''}`));
        else if (tg.freq) lines.push(`<span class="k">Frequency</span>  ${tg.freq}`);
        if (!rws.length && !fqs.length && !tg.rwLen && !tg.freq) lines.push('<span class="k">No runway / frequency data for this place (load an airport database)</span>');
        // sunrise / sunset at the target, and METAR (fetched once in a while)
        if (LX.sun) { const ss = LX.sun.times(tg.lat, tg.lon, new Date()); if (ss) lines.push(`<span class="k">Sun</span>        ${LX.sun.fmt(ss.rise)} - ${LX.sun.fmt(ss.set)}`); }
        const code = (tg.code || '').toUpperCase();
        if (/^[A-Z]{4}$/.test(code)) {
          if (!this._metar || this._metar.code !== code || performance.now() - this._metar.t > 120000) {
            this._metar = { code, t: performance.now(), v: undefined };
            LX.Files.fetchMetar(code).then((v) => { this._metar = { code, t: performance.now(), v }; });
          }
          lines.push('');
          const m = this._metar && this._metar.v;
          lines.push(m ? `<span class="k">METAR</span>      ${m.raw}` : `<span class="k">METAR</span>      ${this._metar && this._metar.v === undefined ? 'loading\u2026' : 'not available'}`);
        }
      } else lines.push('No target selected');
      const h = lines.join('\n');
      if (this.lastShown.apt !== h) { this.info.innerHTML = h; this.lastShown.apt = h; }
    }

    /* -------------------------------------------------------------- softkeys */
    /** Three MORE>> sets per mode (manual 8.2). Labels not available without extra hardware / data are
        still shown, like on a unit without the option, and explain themselves when pressed. */
    softkeys() {
      if (this.kind === 'custom' && this.editing) return LX.layout.editSoftkeys(this);
      const nav = this.ctx.nav, run = this.ctx.runner;
      const startKey = !nav.started ? (nav.options.arm && !nav.armed ? 'ARM' : 'START') : 'NEXT';
      const m = this.modeId;
      const sets = m === 'tsk' ? [
        ['AIRSPACE', 'FLARM', 'MARK', 'MORE>>', 'EDIT', 'WIND', 'MC/BAL', startKey],
        ['MAP', 'PAN', 'TEAM', 'MORE>>', 'RESTART', 'LAYOUT', 'EVENT', 'MOVE'],
        ['OFF', 'NOTAM', 'XPDR', 'MORE>>', 'RADIO', (nav.starts && nav.starts.length && !nav.started) ? 'CYCLE' : '', '', 'NIGHT'],
      ] : m === 'wpt' ? [
        ['AIRSPACE', 'FLARM', 'MARK', 'MORE>>', 'MAP', 'WIND', 'MC/BAL', 'SELECT'],
        ['PAN', 'LAYOUT', 'TEAM', 'MORE>>', 'EDIT', 'NEW', 'DELETE', 'EVENT'],
        ['OFF', 'NOTAM', 'XPDR', 'MORE>>', 'RADIO', '', '', 'NIGHT'],
      ] : [
        ['AIRSPACE', 'FLARM', 'MARK', 'MORE>>', 'MAP', 'WIND', 'MC/BAL', 'SELECT'],
        ['PAN', 'LAYOUT', 'TEAM', 'MORE>>', 'OFF', 'NOTAM', 'EVENT', 'XPDR'],
        ['RADIO', '', '', 'MORE>>', '', '', '', 'NIGHT'],
      ];
      const labels = sets[this.skSet % 3].slice();
      // FLARM page: quick toggle for gliders-only / all aircraft (an exception to what a real FLARM shows)
      if (this.kind === 'flarm' && this.skSet % 3 === 0) labels[2] = this.ctx.settings.get().trafficFilter === 'all' ? 'ALL A/C' : 'GLIDERS';
      if (this.ctx.settings.get().showFai && this.skSet % 3 === 2 && !labels[6]) labels[6] = 'ROT.FAI';
      return { labels, persist: false };
    }

    button(i, long) {
      if (this.kind === 'custom' && this.editing) return LX.layout.editButton(this, i);
      const label = this.softkeys().labels[i];
      const scr = this.scr, ctx = this.ctx, run = ctx.runner, f = ctx.flight.f;
      const needs = (what) => scr.toast(`${label}: needs ${what} (not available in this simulator)`, 2200);
      switch (label) {
        case 'MORE>>': this.skSet = (this.skSet + 1) % 3; return 'keep';
        case 'ROT.FAI': {
          const order = [1, -1, 0], cur = ctx.faiSide === undefined ? 1 : ctx.faiSide;
          ctx.faiSide = order[(order.indexOf(cur) + 1) % 3];
          scr.toast({ 1: 'FAI area: left of the course line', '-1': 'FAI area: right of the course line', 0: 'FAI area: both sides' }[ctx.faiSide], 2000); return 'keep';
        }
        case 'GLIDERS': case 'ALL A/C': {
          const all = ctx.settings.get().trafficFilter !== 'all';
          ctx.settings.set({ trafficFilter: all ? 'all' : 'gliders' });
          scr.toast(all ? 'FLARM shows all aircraft (not like a real FLARM)' : 'FLARM shows gliders only', 2200);
          return 'keep';
        }
        case 'MC/BAL': scr.open(LX.setup.mcDialog(scr, ctx)); return true;
        case 'WIND': scr.open(LX.setup.windDialog(scr, ctx)); return true;
        case 'MAP': scr.open(LX.setup.mapDialog(scr, ctx)); return true;
        case 'AIRSPACE': scr.open(LX.setup.airspaceList(scr, ctx)); return true;
        case 'FLARM': scr.open(LX.setup.flarmList(scr, ctx)); return true;
        case 'LAYOUT': scr.open(LX.layout.menu(scr, ctx, this)); return true;
        case 'PAN': this.panMode = !this.panMode; this.pan = { e: 0, n: 0 }; scr.toast(this.panMode ? 'Pan: PAGE = north/south, ZOOM = east/west. Press PAN to exit' : 'Pan off', 2500); return false;
        case 'MARK': {
          const n = ctx.nav.waypoints.filter((w) => /^MARK/.test(w.name)).length + 1;
          ctx.nav.waypoints.push({ name: 'MARK' + n, code: 'MARK', lat: f.lat, lon: f.lon, elev: f.alt, type: 'mark' });
          scr.toast(`Waypoint MARK${n} created`, 1500); return false;
        }
        case 'SELECT': scr.open(LX.filesUI.airportSelect(scr, ctx, this.modeId)); return true;
        case 'EDIT': if (this.modeId === 'wpt') { LX.taskEdit.editWaypoint(scr, ctx, ctx.nav.target('wpt'), false); return true; } scr.open(LX.taskEdit.view(scr, ctx)); return true;
        case 'NEW': LX.taskEdit.editWaypoint(scr, ctx, null, true); return true;
        case 'DELETE': {
          const w = ctx.nav.target('wpt');
          if (!w) return false;
          scr.open(new LX.forms.Popup(scr, 'Delete waypoint', `Delete ${w.name}?`, {
            4: { label: 'NO', run: (s) => s.close() },
            7: { label: 'YES', run: (s) => { ctx.nav.deleteWaypoint(w); s.close(); s.toast('Waypoint deleted', 1200); } },
          }));
          return true;
        }
        case 'CYCLE': {
          const n = ctx.nav;
          if (n.started || !n.starts || !n.starts.length) return true;
          const next = n.starts.shift();
          n.starts.push(n.task[0].wp);
          n.task[0].wp = next;
          n.active = 0;
          ctx.runner.reset();
          scr.toast('Start point: ' + next.name, 1500);
          return true;
        }
        case 'ARM': ctx.messages(run.arm()); return false;
        case 'START': ctx.messages(run.start(f, f.t)); return false;
        case 'NEXT': ctx.messages(run.next()); return false;
        case 'RESTART':
          scr.open(new LX.forms.Popup(scr, 'Restart task', 'Restart the task?', {
            4: { label: 'NO', run: (s) => s.close() },
            7: { label: 'YES', run: (s) => { s.close(); ctx._demoManual = false; ctx.messages(run.restart()); } },
          }));
          return true;
        case 'EVENT': ctx.messages(run.event(f.t)); return false;
        case 'MOVE': {
          const p = ctx.nav.task[ctx.nav.active];
          if (!p || !p.zone.aat) { scr.toast('MOVE works for assigned-area points (set AAT in the zone dialog)', 2800); return false; }
          p.target = p.target || { dist: 0, brg: 0 };
          scr.open(new LX.forms.FormView(scr, { title: `Move ${p.wp.name}`, fields: [
            { type: 'spin', label: 'Distance from centre', min: 0, max: p.zone.r1, step: 100, coarse: 10, get: () => p.target.dist, set: (v) => (p.target.dist = v), fmt: (v) => fm.dist(v) + ' ' + LX.units.label('dist') },
            { type: 'spin', label: 'Bearing', min: 0, max: 359, step: 1, coarse: 10, get: () => p.target.brg, set: (v) => (p.target.brg = v), fmt: (v) => v + '\u00B0' },
          ] }));
          return true;
        }
        case 'NIGHT': ctx.settings.set({ night: !ctx.settings.get().night }); return false;
        case 'OFF': scr.powerOff(); return false;
        case 'TEAM': needs('a partner team code'); return false;
        case 'NOTAM': needs('NOTAM data'); return false;
        case 'XPDR': case 'RADIO': needs('the 232 bridge radio/transponder hardware'); return false;
        case '': return false;
        default: scr.toast(`${label}: not implemented`, 1800); return false;
      }
    }

    knob(name, dir) {
      if (this.kind === 'custom' && this.editing) return LX.layout.editKnob(this, name, dir);
      if (this.panMode && (name === 'page' || name === 'zoom')) {
        const step = ZOOMS[clamp(this.ctx.settings.get().mapZoom, 0, ZOOMS.length - 1)] * 100 * dir; // metres
        if (name === 'page') this.pan.n += step; else this.pan.e += step;
        return true;
      }
      if (name === 'zoom') {
        if (this.kind === 'flarm') { const RR = 5, cur = this.radarRange !== undefined ? this.radarRange : 2; this.radarRange = clamp(cur + dir, 0, RR - 1); return true; }
        if (this.kind === 'apt' || this.kind === 'vario' || this.kind === 'meteo') return true;
        this.thermalOverride = true;
        const s = this.ctx.settings;
        s.set({ mapZoom: clamp(s.get().mapZoom + dir, 0, ZOOMS.length - 1) });
        return true;
      }
      if (name === 'page') this.thermalOverride = true;
      return false;
    }
  }

  LX.NavView = NavView;
  LX.Traffic = Traffic;
  /** Page order per mode (manual 7.5-7.7) plus a vario page as an extension. */
  LX.NAV_PAGES = {
    apt: ['map', 'map2', 'side', 'flarm', 'apt', 'vario', 'pfd', '3d', 'meteo'],
    wpt: ['map', 'map2', 'side', 'flarm', 'apt', 'vario', 'pfd', '3d', 'meteo'],
    tsk: ['map', 'tmap2', 'ttime', 'side', 'ttimes', 'vario', 'pfd', '3d'],
  };
})(window);
