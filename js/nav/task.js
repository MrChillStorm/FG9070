/**
 * Task engine (manual 7.7, 11.2): observation zones, start procedures, turn
 * point and finish handling, task distance and speed.
 *
 * Zone model (7.1.8.4 / 7.7.2.3):
 *   { r1, a1, dir, a12, line, r2, a2, aat, autoNext }
 *   a1 = 180  -> cylinder, 45 -> FAI sector; line:true -> line of length 2*r1
 *   dir: 'symmetric' | 'fixed' | 'next' | 'prev' | 'start'   (a12 = fixed bearing)
 *
 * Task state machine (11.2):
 *   before start  - final glide symbol shows "S"; entering the start zone
 *                   gives "Inside start zone"; leaving it (or crossing the line)
 *                   gives "Task started" with START / CLOSE
 *   ARM mode      - ARM before the start, then the next valid start advances
 *                   the task automatically ("Task armed!")
 *   turn points   - "Inside zone": auto advance when Auto next is set, else NEXT
 *   finish        - "Task finished" with time and speed
 *
 * Start procedure limits: max start altitude (A), max start ground speed (G),
 * below-altitude (B), event (PEV) procedure with wait time and start window.
 *
 * `update()` returns messages [{ id, text, buttons? }] for the UI to show.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const { wrap180, wrap360 } = geo;

  const DEFAULT_OPTIONS = {
    name: 'TASK',
    aatTime: 0, // minutes; > 0 => AAT
    navNearest: false,
    arm: false,
    obsCorr: false, // obs.zone distance correction
    beforeStart: 0, // minutes before start opens
    belowAlt: 0, belowTime: 0, // below-altitude start (m, s)
    startAlt: 0, startGsp: 0, // max start altitude (m MSL) / ground speed (m/s); 0 = off
    startOpen: 0, // time of day the start opens, minutes after midnight (local); 0 = use Before start
    gateInterval: 0, // minutes; 0 = off (then the start stays open from the opening time)
    startOutTop: false,
    startWithin: false,
    eventWait: 0, eventWindow: 0, maxEvents: 3, // seconds / seconds / count
    finishBelowStart: 0, // m below start altitude (0 = off)
  };

  /** Default zone for a point kind: the built-in one overlaid with Setup > Observation Zones. */
  const defaultZone = (kind) => Object.assign(baseZone(kind), ((LX.settings && LX.settings.get().zoneDefaults) || {})[kind] || {});
  const baseZone = (kind) => (kind === 'tp'
    ? { r1: 500, a1: 180, dir: 'symmetric', a12: 0, line: false, r2: 0, a2: 0, aat: false, autoNext: true }
    : { r1: 1000, a1: 180, dir: kind === 'start' ? 'next' : 'prev', a12: 0, line: true, r2: 0, a2: 0, aat: false, autoNext: true });

  /** Make sure every task point has a complete zone. */
  function normalise(nav) {
    nav.options = Object.assign({}, DEFAULT_OPTIONS, nav.options || {});
    nav.task.forEach((p, i) => {
      p.kind = i === 0 ? 'start' : i === nav.task.length - 1 ? 'finish' : 'tp';
      const z = Object.assign(defaultZone(p.kind), p.zone || {});
      if (p.radius && !p.zone) { z.r1 = p.radius; if (p.line !== undefined) z.line = !!p.line; }
      p.zone = z;
      p.radius = z.r1; // legacy field used by the map
      p.line = z.line;
    });
  }

  /** Effective position of a task point: the moved target inside an assigned area, else the waypoint. */
  function pointPos(p) {
    if (p.zone && p.zone.aat && p.target && p.target.dist > 0) {
      const q = geo.dest(p.wp.lat, p.wp.lon, p.target.brg, Math.min(p.target.dist, p.zone.r1));
      return { lat: q.lat, lon: q.lon };
    }
    return { lat: p.wp.lat, lon: p.wp.lon };
  }

  /* ------------------------------------------------------------ zone geometry */
  /** Bearing the zone is oriented along, in degrees true. */
  function zoneBearing(task, i) {
    const p = task[i], z = p.zone;
    const nxt = task[i + 1], prv = task[i - 1];
    const b = (a, c) => geo.bearing(a.wp.lat, a.wp.lon, c.wp.lat, c.wp.lon);
    switch (z.dir) {
      case 'fixed': return z.a12;
      case 'next': return nxt ? b(p, nxt) : prv ? b(prv, p) : 0;
      case 'prev': return prv ? b(prv, p) : nxt ? b(p, nxt) : 0;
      case 'start': return task[0] && task[0] !== p ? b(task[0], p) : 0;
      default: // symmetric: bisector pointing away from the legs
        if (prv && nxt) { const a = b(p, prv), c = b(p, nxt); return wrap360(a + wrap180(c - a) / 2 + 180); }
        return nxt ? b(p, nxt) : prv ? b(prv, p) : 0;
    }
  }

  /** Is `pos` inside the (non-line) zone of task point i? */
  function inZone(task, i, pos) {
    const p = task[i], z = p.zone;
    const d = geo.dist(p.wp.lat, p.wp.lon, pos.lat, pos.lon);
    if (z.line) return false; // lines are crossing-based, see crossedLine
    if (d > z.r1 && !(z.r2 && d <= z.r2)) return false;
    if (z.a1 >= 180) return d <= z.r1;
    // sector: pointing along zoneBearing(), half-angle a1/2 each side of the axis
    const rad = geo.bearing(p.wp.lat, p.wp.lon, pos.lat, pos.lon);
    const axis = z.dir === 'symmetric' ? wrap360(zoneBearing(task, i)) : zoneBearing(task, i);
    return Math.abs(wrap180(rad - axis)) <= z.a1 / 2 && d <= z.r1;
  }

  /** Did the segment prev->pos cross the line of point i (line length 2*r1 perpendicular to the axis)? */
  function crossedLine(task, i, prev, pos) {
    const p = task[i], z = p.zone;
    const axis = zoneBearing(task, i);
    const e = (pt) => geo.enu(p.wp.lat, p.wp.lon, pt.lat, pt.lon);
    const a = e(prev), b = e(pos);
    const ax = Math.sin(axis * Math.PI / 180), ay = Math.cos(axis * Math.PI / 180); // line normal = axis
    const sa = a.e * ax + a.n * ay, sb = b.e * ax + b.n * ay; // signed distance along the axis
    if (!(sa < 0 && sb >= 0) && !(sa >= 0 && sb < 0)) return null;
    const t = sa / (sa - sb);
    const cx = a.e + (b.e - a.e) * t, cy = a.n + (b.n - a.n) * t;
    const lateral = Math.abs(cx * ay - cy * ax); // distance along the line direction
    if (lateral > z.r1) return null;
    return sa < 0 ? 'forward' : 'backward'; // crossed in the axis direction?
  }

  /* --------------------------------------------------------------- distances */
  /** Task distance through point centres (obs-zone correction optional). */
  function distance(nav) {
    const t = nav.task;
    let d = 0;
    for (let i = 1; i < t.length; i++) {
      const a = pointPos(t[i - 1]), b = pointPos(t[i]);
      let leg = geo.dist(a.lat, a.lon, b.lat, b.lon);
      if (nav.options.obsCorr) leg = Math.max(0, leg - (t[i - 1].zone.line ? 0 : t[i - 1].zone.r1) - (t[i].zone.line ? 0 : t[i].zone.r1));
      d += leg;
    }
    return d;
  }

  /** Remaining distance from `pos` via the active point to the finish. */
  function remaining(nav, pos) {
    const t = nav.task;
    if (!t.length || nav.active >= t.length) return 0;
    const pa = pointPos(t[nav.active]);
    let d = geo.dist(pos.lat, pos.lon, pa.lat, pa.lon);
    if (nav.options.navNearest && nav.active === t.length - 1 && !t[nav.active].zone.line) d = Math.max(0, d - t[nav.active].zone.r1);
    for (let i = nav.active + 1; i < t.length; i++) { const a = pointPos(t[i - 1]), b = pointPos(t[i]); d += geo.dist(a.lat, a.lon, b.lat, b.lon); }
    return d;
  }

  /* ----------------------------------------------------------------- runner */
  class TaskRunner {
    constructor(nav) {
      this.nav = nav;
      this.reset();
    }

    reset() {
      const n = this.nav;
      n.started = false; n.finished = false; n.armed = false;
      n.active = n.task.length > 1 ? 0 : 0; // start with the start point as target (S mode)
      n.startTime = null; n.startAlt = null; n.startGs = null; n.finishTime = null;
      this.resetAt = Date.now();
      this.prev = null;
      this.insideStart = false;
      this.msgSent = {};
      this.below = { t0: null, done: false };
      this.events = []; // PEV times (s)
      this.flown = 0; // credited distance of completed legs
      this.legs = []; // [{ name, t (ms), dist (m, leg) }]: START, each turn point, FINISH
      this.lastLegIdx = 0;
    }

    /** Pilot presses START (any time) – advances to the first turn point. */
    start(f, tMs) {
      const n = this.nav;
      if (n.started) return [{ id: 'info', text: 'Task already started' }];
      n.started = true;
      n.startTime = tMs; n.startAlt = f.alt; n.startGs = f.gs;
      n.active = Math.min(1, n.task.length - 1);
      this.legs = [{ name: n.task[0] ? n.task[0].wp.name : 'START', t: tMs, dist: 0 }];
      const m = [{ id: 'started', text: `Task started  ${Math.round(LX.units.speed(f.gs))} ${LX.units.label('speed')}  ${Math.round(LX.units.alt(f.alt))} ${LX.units.label('alt')}` }];
      const o = n.options;
      const gt = this.gate(Date.now());
      if (gt && !gt.open) m.push({ id: 'warn', text: 'Started outside the start gate!' });
      if ((o.startAlt && f.alt > o.startAlt) || (o.startGsp && f.gs > o.startGsp)) m.push({ id: 'warn', text: 'Start above the allowed altitude / speed!' });
      return m;
    }

    /**
     * Start gate (manual 7.7.2.4 / 11.2.1): the start opens at `startOpen` (time of day) or `beforeStart` minutes after the
     * task was set up; with a gate interval the start is then valid for one minute every `gateInterval` minutes.
     * Returns null when no gating is configured, else { open, opensIn, closesIn } (seconds).
     */
    gate(nowMs) {
      const o = this.nav.options;
      if (!o.startOpen && !o.beforeStart) return null;
      let openAt;
      if (o.startOpen) { const d = new Date(nowMs); d.setHours(0, 0, 0, 0); openAt = d.getTime() + o.startOpen * 60000; }
      else openAt = (this.resetAt || nowMs) + o.beforeStart * 60000;
      const G = (o.gateInterval || 0) * 60000;
      if (nowMs < openAt) return { open: false, opensIn: (openAt - nowMs) / 1000, closesIn: 0 };
      if (!G) return { open: true, opensIn: 0, closesIn: Infinity };
      const k = Math.floor((nowMs - openAt) / G), into = nowMs - openAt - k * G;
      if (into < 60000) return { open: true, opensIn: 0, closesIn: (60000 - into) / 1000 };
      return { open: false, opensIn: (G - into) / 1000, closesIn: 0 };
    }

    arm() { this.nav.armed = true; return [{ id: 'info', text: 'Task armed!' }]; }

    restart() { const t = this.nav.task; this.reset(); this.nav.active = 0; return [{ id: 'info', text: 'Task restarted' }]; }

    next() {
      const n = this.nav;
      if (n.active < n.task.length - 1) n.active++;
      return [];
    }

    /** PEV event (11.2.1.3). */
    event(tMs) {
      const n = this.nav, o = n.options;
      const last = this.events.length ? this.events[this.events.length - 1] : null;
      if (last !== null && tMs / 1000 - last < 30) return [{ id: 'info', text: `Event marked. (${this.events.length})` }];
      this.events.push(tMs / 1000);
      this.eventAt = tMs / 1000;
      return [{ id: 'info', text: `Event marked. (${this.events.length})` + (this.events.length > o.maxEvents ? '  max.' : '') }];
    }

    /** Seconds until the PEV start window opens / closes (null when not in use). */
    eventState(tMs) {
      const o = this.nav.options;
      if (this.eventAt === undefined || !o.eventWait) return null;
      const t = tMs / 1000 - this.eventAt;
      if (t < o.eventWait) return { phase: 'wait', left: o.eventWait - t };
      if (t < o.eventWait + o.eventWindow) return { phase: 'open', left: o.eventWait + o.eventWindow - t };
      return { phase: 'closed', left: 0 };
    }

    /**
     * Advance the state machine with a new position fix.
     * f: flight state (lat, lon, alt, gs); returns messages.
     */
    update(f, tMs) {
      const n = this.nav, t = n.task, o = n.options, out = [];
      if (!t.length || n.finished) { this.prev = { lat: f.lat, lon: f.lon }; return out; }
      const pos = { lat: f.lat, lon: f.lon };
      const prev = this.prev || pos;

      if (!n.started) {
        const s = t[0];
        let crossed = false, inside = false;
        if (s.zone.line) {
          const c = crossedLine(t, 0, prev, pos);
          crossed = c === 'forward';
        } else {
          inside = inZone(t, 0, pos);
          if (inside && !this.insideStart) out.push({ id: 'inside', text: 'Inside start zone' });
          crossed = !inside && this.insideStart; // left the zone
        }
        this.insideStart = inside;
        // below-altitude procedure
        if (o.belowAlt) {
          if (f.alt < o.belowAlt) { if (this.below.t0 === null) this.below.t0 = tMs; }
          else this.below.t0 = null;
          if (this.below.t0 !== null && !this.below.done && (tMs - this.below.t0) / 1000 >= o.belowTime) {
            this.below.done = true;
            out.push({ id: 'info', text: `You were ${o.belowTime} seconds below ${Math.round(LX.units.alt(o.belowAlt))} ${LX.units.label('alt')}!` });
          }
        }
        const gt = this.gate(Date.now());
        if (crossed && gt && !gt.open) {
          const m = Math.floor(gt.opensIn / 60), sc = Math.round(gt.opensIn % 60);
          out.push({ id: 'gate', text: `Start gate closed - opens in ${m}:${String(sc).padStart(2, '0')}` });
        } else if (crossed) {
          if (n.armed) { n.armed = false; out.push(...this.start(f, tMs)); }
          else out.push({ id: 'start?', text: `Task started? ${Math.round(LX.units.speed(f.gs))} ${LX.units.label('speed')}  ${Math.round(LX.units.alt(f.alt))} ${LX.units.label('alt')}`, buttons: ['CLOSE', 'START'] });
        }
      } else if (n.active < t.length) {
        const p = t[n.active];
        const last = n.active === t.length - 1;
        let hit = false;
        if (p.zone.line) hit = crossedLine(t, n.active, prev, pos) === 'forward';
        else hit = inZone(t, n.active, pos);
        if (hit) {
          if (last) {
            n.finished = true; n.finishTime = tMs;
            this.legs.push({ name: p.wp.name, t: tMs, dist: geo.dist(t[n.active - 1].wp.lat, t[n.active - 1].wp.lon, p.wp.lat, p.wp.lon) });
            const dur = (tMs - n.startTime) / 1000;
            const dist = distance(n);
            out.push({ id: 'finished', text: `Task finished  ${LX.fm ? LX.fm.time(dur) : Math.round(dur)}  ${(dist / dur * 3.6).toFixed(1)} km/h` });
          } else {
            const legD = geo.dist(t[n.active - 1].wp.lat, t[n.active - 1].wp.lon, p.wp.lat, p.wp.lon);
            this.flown += legD;
            this.legs.push({ name: p.wp.name, t: tMs, dist: legD });
            if (p.zone.autoNext) { n.active++; out.push({ id: 'inside', text: 'Inside zone' }); }
            else if (!this.msgSent['next' + n.active]) { this.msgSent['next' + n.active] = 1; out.push({ id: 'next?', text: 'Inside zone', buttons: ['CLOSE', 'NEXT'] }); }
          }
        }
      }
      this.prev = pos;
      return out;
    }

    /** Task speed achieved so far (m/s), 0 if not started. */
    taskSpeed(f, tMs) {
      const n = this.nav;
      if (!n.started) return 0;
      const el = ((n.finished ? n.finishTime : tMs) - n.startTime) / 1000;
      if (el < 10) return 0;
      const credited = n.finished ? distance(n) : Math.max(0, distance(n) - remaining(n, f));
      return credited / el;
    }

    /** { remain, required } for time-limited (AAT) tasks, s and m/s. */
    timeInfo(f, tMs) {
      const n = this.nav, o = n.options;
      if (!n.started || !o.aatTime) return null;
      const left = o.aatTime * 60 - (tMs - n.startTime) / 1000;
      return { remain: left, required: left > 30 ? remaining(n, f) / left : 0 };
    }

    /** What the final-glide symbol's prefix letter is: S, T, A, G, AG, B (8.3.4.1). */
    prefix() {
      const n = this.nav, o = n.options;
      if (!n.started) {
        if (o.belowAlt) return 'B';
        if (o.startAlt && o.startGsp) return 'AG';
        if (o.startAlt) return 'A';
        if (o.startGsp) return 'G';
        return 'S';
      }
      return 'T';
    }
  }

  LX.TaskTools = { pointPos, DEFAULT_OPTIONS, defaultZone, normalise, zoneBearing, inZone, crossedLine, distance, remaining };
  LX.TaskRunner = TaskRunner;
})(window);
