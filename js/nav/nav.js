/**
 * Navigation data model: waypoints, airports, task and the three navigation
 * modes of the LX90xx (Airport / Waypoint / Task – each has its own target).
 *
 * Data comes from three places, in this order of preference:
 *   1. user files loaded in Setup > Files and Transfer (CUP waypoints, OurAirports CSV)
 *   2. the demo task generated around the first position fix (works anywhere
 *      in FlightGear, with no data files)
 *
 * Elevations in metres, coordinates decimal degrees.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;

  class Nav {
    constructor() {
      this.waypoints = []; // { name, code, lat, lon, elev, type }
      this.airports = []; // landable subset (type: 'airport' | 'glider' | 'field')
      this.task = []; // [{ wp, radius, kind: 'start'|'tp'|'finish', angle }]
      this.active = 0; // active task point index
      this.selected = { apt: null, wpt: null }; // selected targets for APT / WPT modes
      this.started = false;
      this.startTime = null;
      this.legs = []; // finished legs [{ name, t0, t1, dist }]
      this.mode = 'tsk'; // which navigation mode supplies the current target
      this.savedTasks = []; // tasks stored in the active waypoint file: { name, points:[waypoint names], options }
      this.options = {};
    }

    /** Build a ~100 km triangle + a few airfields around (lat, lon). */
    makeDemo(lat, lon) {
      const P = (name, brg, d, elev, type) => {
        const p = geo.dest(lat, lon, brg, d);
        return { name, code: name.slice(0, 4).toUpperCase(), lat: p.lat, lon: p.lon, elev, type };
      };
      const home = { name: 'HOME', code: 'HOME', lat, lon, elev: 0, type: 'airport' }; // elev patched by caller
      const a = P('TP1 Ridge', 60, 32000, 520, 'tp');
      const b = P('TP2 Lake', 150, 36000, 410, 'tp');
      this.waypoints = [
        home, a, b,
        P('Valley Field', 20, 12000, 380, 'glider'),
        P('North Strip', 350, 24000, 430, 'field'),
        P('East Airfield', 85, 52000, 460, 'airport'),
        P('South Airfield', 175, 41000, 395, 'airport'),
        P('Pass Field', 120, 21000, 610, 'field'),
      ];
      this.airports = this.waypoints.filter((w) => w.type === 'airport' || w.type === 'glider' || w.type === 'field');
      this.task = [
        { wp: home, radius: 1000, kind: 'start', line: true },
        { wp: a, radius: 500, kind: 'tp' },
        { wp: b, radius: 500, kind: 'tp' },
        { wp: home, radius: 1000, kind: 'finish', line: true },
      ];
      this.active = 0; // before the start the target is the start point (final glide shows S)
      this.started = false;
      // demo airspaces (real data: OpenAIP, see README roadmap)
      const ring = (brg, d, r, n) => {
        const c = geo.dest(lat, lon, brg, d);
        return Array.from({ length: n }, (_, i) => { const q = geo.dest(c.lat, c.lon, 360 * i / n + 20, r); return [q.lat, q.lon]; });
      };
      this.airspaces = [
        { name: 'CTR Home', cls: 'D', lower: 0, upper: 1200, circle: { lat, lon, r: 4500 } },
        { name: 'TMA East', cls: 'C', lower: 2200, upper: 5500, poly: ring(78, 52000, 9000, 6) },
        { name: 'D-14 Danger', cls: 'DNG', lower: 0, upper: 3000, circle: Object.assign(geo.dest(lat, lon, 160, 17000), { r: 3000 }) },
      ];
      this.selected.apt = this.airports[1] || home;
      this.selected.wpt = a;
      this.demo = true;
      this.options = {};
      if (LX.TaskTools) LX.TaskTools.normalise(this);
    }

    setHomeElevation(m) {
      if (this.waypoints[0] && this.waypoints[0].name === 'HOME') this.waypoints[0].elev = m;
    }

    /** Current navigation target for the given mode ('apt' | 'wpt' | 'tsk'). */
    target(mode) {
      if (mode === 'apt') return this.selected.apt;
      if (mode === 'wpt') return this.selected.wpt;
      const p = this.task[this.active];
      if (!p) return null;
      // assigned areas: navigate to the moved target point
      if (p.zone && p.zone.aat && p.target && p.target.dist > 0 && LX.TaskTools) {
        const q = LX.TaskTools.pointPos(p);
        return Object.assign({}, p.wp, { lat: q.lat, lon: q.lon, name: p.wp.name + '*' });
      }
      return p.wp;
    }

    taskLength() {
      let d = 0;
      for (let i = 1; i < this.task.length; i++) {
        d += geo.dist(this.task[i - 1].wp.lat, this.task[i - 1].wp.lon, this.task[i].wp.lat, this.task[i].wp.lon);
      }
      return d;
    }

    /** Remaining task distance from the current position via the active point. */
    taskRemaining(lat, lon) {
      if (!this.task.length || this.active >= this.task.length) return 0;
      let d = geo.dist(lat, lon, this.task[this.active].wp.lat, this.task[this.active].wp.lon);
      for (let i = this.active + 1; i < this.task.length; i++) {
        d += geo.dist(this.task[i - 1].wp.lat, this.task[i - 1].wp.lon, this.task[i].wp.lat, this.task[i].wp.lon);
      }
      return d;
    }

    /** Auto-advance when inside the active observation zone. */
    update(f, tMs) {
      if (!this.task.length || this.active >= this.task.length) return null;
      const p = this.task[this.active];
      const d = geo.dist(f.lat, f.lon, p.wp.lat, p.wp.lon);
      if (d < p.radius) {
        const ev = { index: this.active, name: p.wp.name, kind: p.kind };
        this.legs.push({ name: p.wp.name, t: tMs });
        if (this.active < this.task.length - 1) this.active++;
        return ev;
      }
      return null;
    }

    /** Landable places sorted by distance (Near mode). */
    nearest(lat, lon, n) {
      return this.airports
        .map((w) => ({ w, d: geo.dist(lat, lon, w.lat, w.lon), brg: geo.bearing(lat, lon, w.lat, w.lon) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, n || 20);
    }
  }

  LX.Nav = Nav;
})(window);
