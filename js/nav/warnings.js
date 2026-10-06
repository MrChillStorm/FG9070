/**
 * Warning logic (manual 7.1.10): airspace, altitude, time alarms, waypoint,
 * FLARM. Pure logic – the UI lives in pages/warnings-ui.js.
 *
 * Airspace (7.1.10.1):
 *   orange  the position projected `warnTime` seconds ahead (track, ground
 *           speed, vertical speed) crosses a zone
 *   red     the projected position crosses a zone AND the glider is already in
 *           the buffer zone (horizontal 1 km / vertical 100 m by default), or
 *           the glider is inside the zone
 *   A warning can be QUIT (message goes away, comes back if it escalates), or
 *   DISMISSed for N minutes; a dismissed zone stays drawn alarmed on the map.
 *
 * Altitude (7.1.10.2): projected altitude (20 s average vertical speed over the
 *   Time setting) passes the set MSL altitude, approaching from below or above.
 *
 * Zone altitudes are treated as MSL (OpenAir/OpenAIP AGL limits are not
 * resolved against terrain in this simulator).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const D2R = Math.PI / 180;

  /* --------------------------------------------------------------- geometry */
  /** Zone outline as ENU points around (lat0, lon0). Circles return {c:{e,n}, r}. */
  function toLocal(zone, lat0, lon0) {
    if (zone.circle) { const c = geo.enu(lat0, lon0, zone.circle.lat, zone.circle.lon); return { circle: { e: c.e, n: c.n }, r: zone.circle.r }; }
    return { poly: zone.poly.map((p) => { const q = geo.enu(lat0, lon0, p[0], p[1]); return [q.e, q.n]; }) };
  }
  function pointInPoly(e, n, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > n !== yj > n && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function segsIntersect(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  /** { inside, dist } : horizontal relation of the origin (0,0) to the zone, and of segment (0,0)->p. */
  function horizontal(z, px, py) {
    if (z.circle) {
      const d = Math.hypot(z.circle.e, z.circle.n);
      const inside = d <= z.r;
      const dist = Math.abs(d - z.r); // to the boundary
      const crosses = segDist(z.circle.e, z.circle.n, 0, 0, px, py) <= z.r;
      return { inside, dist, crosses };
    }
    const inside = pointInPoly(0, 0, z.poly);
    let dist = Infinity, crosses = pointInPoly(px, py, z.poly);
    for (let i = 0, j = z.poly.length - 1; i < z.poly.length; j = i++) {
      dist = Math.min(dist, segDist(0, 0, z.poly[j][0], z.poly[j][1], z.poly[i][0], z.poly[i][1]));
      if (!crosses && segsIntersect([0, 0], [px, py], z.poly[j], z.poly[i])) crosses = true;
    }
    return { inside, dist, crosses: crosses || inside };
  }

  const ZONE_KEY = (z) => z.name + '|' + z.cls;

  /* -------------------------------------------------------------- the engine */
  class Warnings {
    constructor(settings, nav) {
      this.S = settings;
      this.nav = nav;
      this.dismissed = {}; // zone key -> { until (ms), level }
      this.altDismissUntil = 0;
      this.vsHist = []; // [t, vs] for the 20 s average
      this.lastTimeAlarm = [0, 0, 0];
      this.wptWarned = null;
      this.cache = { t: 0, res: null };
    }

    /** Evaluate all airspace zones; returns [{ zone, level, dist, inside, vdist, dismissed }]. */
    airspace(f, tMs) {
      const s = this.S.get();
      const res = [];
      if (!s.warnAirspace || !this.nav.airspaces) return res;
      const T = s.warnTime;
      const brg = f.track * D2R;
      const px = Math.sin(brg) * f.gs * T, py = Math.cos(brg) * f.gs * T;
      const altP = f.alt + f.vs * T;
      for (const zone of this.nav.airspaces) {
        const z = toLocal(zone, f.lat, f.lon);
        // cheap reject: farther than horizontal buffer + projection
        const h = horizontal(z, px, py);
        if (h.dist > s.warnHorz + f.gs * T + 1000 && !h.inside) continue;
        const lo = zone.lower, hi = zone.upper || 20000;
        const vInside = f.alt >= lo && f.alt <= hi;
        const vOverlap = Math.max(f.alt, altP) >= lo && Math.min(f.alt, altP) <= hi;
        const vdist = f.alt < lo ? lo - f.alt : f.alt > hi ? f.alt - hi : 0;
        const inside = h.inside && vInside;
        const cross = h.crosses && vOverlap;
        const inBuffer = (h.inside || h.dist <= s.warnHorz) && vdist <= s.warnVert || (inside);
        let level = null;
        if (inside) level = 'red';
        else if (cross && inBuffer) level = 'red';
        else if (cross) level = 'orange';
        if (!level && !(h.inside || h.dist < s.warnHorz * 3)) continue;
        const d = this.dismissed[ZONE_KEY(zone)];
        const dismissed = !!d && tMs < d.until && !(d.level === 'orange' && level === 'red');
        res.push({ zone, level, dist: h.inside ? 0 : h.dist, inside, vdist, dismissed, cross });
      }
      return res;
    }

    /** Active (not dismissed/quit) airspace warnings, worst first. */
    activeAirspace(f, tMs) {
      return this.airspace(f, tMs).filter((w) => w.level && !w.dismissed).sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1) || a.dist - b.dist);
    }

    dismiss(zone, minutes, tMs, level) {
      this.dismissed[ZONE_KEY(zone)] = { until: tMs + minutes * 60000, level: level || 'orange' };
    }
    /** QUIT: just hide this message; it returns if the level escalates or after 30 s. */
    quit(zone, tMs, level) { this.dismiss(zone, 0.5, tMs, level); }
    reset() { this.dismissed = {}; this.altDismissUntil = 0; }

    /** Altitude warning (MSL). Returns null or { dir, alt }. */
    altitude(f, tMs) {
      const s = this.S.get();
      this.vsHist.push([tMs, f.vs]);
      while (this.vsHist.length && tMs - this.vsHist[0][0] > 20000) this.vsHist.shift();
      if (!s.warnAlt || tMs < this.altDismissUntil || s.warnAltValue <= 0) return null;
      const avg = this.vsHist.reduce((a, b) => a + b[1], 0) / Math.max(1, this.vsHist.length);
      const proj = f.alt + avg * s.warnAltTime;
      const lim = s.warnAltValue;
      if (s.warnAltDir === 'above' && f.alt < lim && proj > lim) return { dir: 'above', alt: lim, proj };
      if (s.warnAltDir === 'below' && f.alt > lim && proj < lim) return { dir: 'below', alt: lim, proj };
      return null;
    }
    dismissAltitude(minutes, tMs) { this.altDismissUntil = minutes === Infinity ? Infinity : tMs + minutes * 60000; }

    /** Time alarms (minutes of flight time); returns indices that fire now. */
    timeAlarms(flightTimeS) {
      const s = this.S.get(), fire = [];
      [s.timeAlarm1, s.timeAlarm2, s.timeAlarm3].forEach((min, i) => {
        if (!min) { this.lastTimeAlarm[i] = 0; return; }
        const n = Math.floor(flightTimeS / (min * 60));
        if (n > this.lastTimeAlarm[i] && flightTimeS > 30) { this.lastTimeAlarm[i] = n; fire.push(i); }
      });
      return fire;
    }

    /** Waypoint warning: fires once when the active target comes within the set distance. */
    waypoint(nav) {
      const d = this.S.get().warnWpt;
      if (!d || !nav || !nav.target) return null;
      if (nav.dist < d && this.wptWarned !== nav.target.name) { this.wptWarned = nav.target.name; return nav.target.name; }
      if (nav.dist > d * 1.5 && this.wptWarned === nav.target.name) this.wptWarned = null;
      return null;
    }

    /** FLARM: targets (with .dist, .alarm 0-3 = none/low/medium/high, .e/.n in track-up) -> worst alert at/above the setting. */
    flarm(targets) {
      const lvl = { 'No alarm': 9, High: 3, Medium: 2, Low: 1 }[this.S.get().flarmWarn];
      if (lvl === undefined || lvl === 9) return null;
      const bad = targets.filter((t) => t.alarm >= lvl).sort((a, b) => b.alarm - a.alarm || a.dist - b.dist)[0];
      if (!bad) return null;
      // clock position relative to the nose, e/n are already in the track-up frame
      const rel = (Math.atan2(bad.e, bad.n) / D2R + 360) % 360;
      return { target: bad, clock: Math.round(rel / 30) % 12 || 12, level: bad.alarm };
    }
  }

  LX.Warnings = Warnings;
  LX.WarnGeo = { horizontal, toLocal, pointInPoly };
})(window);
