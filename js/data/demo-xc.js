/**
 * Demo source: a cross-country flight (glide, thermal, glide, ...) around the
 * demo task, so every page can be exercised without FlightGear.
 *
 * Physics is deliberately simple but energy-consistent:
 *   vs  = -sink(IAS)*bankPenalty + w_air - (V/g) * dV/dt
 * i.e. the vertical speed handed to the panel is RAW (not TE compensated),
 * exactly like FlightGear's /velocities/vertical-speed-fps, so the panel's TE
 * compensation has real work to do when the "pilot" pulls up or pushes over.
 *
 * Air: slowly varying background sink with thermals (Gaussian lift columns)
 * placed along the task legs; thermals drift with the wind. The pilot flies
 * MacCready speed-to-fly between thermals, takes the ones stronger than MC,
 * centres them (circling with a gentle centring pull) and leaves at "top".
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const clamp = LX.util.clamp;
  const G = 9.80665;
  const D2R = Math.PI / 180;

  // starting point (any real region works; nothing depends on it)
  const START = { lat: 46.36, lon: 14.17, elev: 400 };

  class DemoXC {
    /** o: { props, onValues, onStatus, nav, settings } */
    constructor(o) {
      this.o = o;
      this.timer = null;
      this.stamps = [];
    }

    start() {
      const nav = this.o.nav;
      this.o0 = { lat: START.lat, lon: START.lon };
      nav.makeDemo(START.lat, START.lon);
      nav.setHomeElevation(START.elev);
      this.polar = LX.polar.make('ask21', 0, 0);
      this.mc = 1.5;
      this.x = -866; this.y = -500; // ENU metres: 1 km behind the start line, so the start is crossed properly
      this.h = START.elev + 1100;
      this.hTop = START.elev + 1500; // 'cloudbase': leave thermals here
      this.v = 27;
      this.hdg = 60;
      this.roll = 0;
      this.phase = 'cruise';
      this.th = null; // thermal being worked
      this.t = 0;
      this.last = performance.now();
      this.wind = { from: 300, spd: 5 };
      this.rnd = mulberry(7);
      this.makeThermals();
      this.timer = setInterval(() => this.tick(), 50);
      this.o.onStatus({ mode: 'demo', hz: 20, message: 'Demo cross-country flight' });
    }

    stop() {
      clearInterval(this.timer);
    }

    makeThermals() {
      this.thermals = [];
      const pts = this.o.nav.task.map((p) => geo.enu(this.o0.lat, this.o0.lon, p.wp.lat, p.wp.lon));
      // a first thermal just ahead of the start so the demo starts climbing soon
      this.thermals.push({ x: 1800, y: 1200, w: 4.2, R: 260 });
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Math.hypot(b.e - a.e, b.n - a.n);
        const n = Math.max(2, Math.floor(len / 8000));
        for (let k = 1; k <= n; k++) {
          const f = k / (n + 1);
          this.thermals.push({
            x: a.e + (b.e - a.e) * f + (this.rnd() - 0.5) * 3000,
            y: a.n + (b.n - a.n) * f + (this.rnd() - 0.5) * 3000,
            w: 2.2 + this.rnd() * 3.2,
            R: 220 + this.rnd() * 110,
          });
        }
      }
    }

    airAt(x, y) {
      // background sink varies smoothly with position, thermals add Gaussian lift
      let w = -0.35 + 0.25 * Math.sin(x / 2300) * Math.cos(y / 1900);
      for (const th of this.thermals) {
        const d2 = ((x - th.x) ** 2 + (y - th.y) ** 2) / (th.R * th.R);
        if (d2 < 9) w += th.w * Math.exp(-d2);
      }
      return w;
    }

    /** Best thermal within `range` metres that beats MacCready. */
    pickThermal(range) {
      let best = null, bd = range;
      for (const th of this.thermals) {
        if (th.w < Math.max(this.mc + 0.8, 2.2)) continue;
        const d = Math.hypot(th.x - this.x, th.y - this.y);
        if (d < bd) { bd = d; best = th; }
      }
      return best;
    }

    tick() {
      // ?speed=N fast-forwards the demo (testing); each tick runs N physics steps
      const n = Math.max(1, Math.round((LX.settings && LX.settings.get().demoSpeed) || 1));
      for (let i = 0; i < n; i++) this.step(i === n - 1);
    }

    step(emit) {
      const now = performance.now();
      const dt = Math.min(0.2, (now - this.last) / 1000) || 0.05;
      if (emit) this.last = now;
      this.t += dt;
      const nav = this.o.nav;
      const wv = { // wind vector (towards)
        x: Math.sin((this.wind.from + 180) * D2R) * this.wind.spd,
        y: Math.cos((this.wind.from + 180) * D2R) * this.wind.spd,
      };
      // thermals drift with the wind
      for (const th of this.thermals) { th.x += wv.x * dt; th.y += wv.y * dt; }

      // --- decide phase
      const agl = this.h - START.elev;
      this.cand = null;
      if (this.phase === 'cruise') {
        // seek lift when below cloudbase: wider search when low
        const lowEnough = this.h < this.hTop - 300;
        const range = agl < 500 ? 6000 : lowEnough ? 1800 : 0;
        this.cand = range ? this.pickThermal(range) : null;
        if (this.cand && Math.hypot(this.cand.x - this.x, this.cand.y - this.y) < 220) {
          this.th = this.cand; this.phase = 'climb';
        }
        // safety net: never land out in the demo
        if (agl < 200) this.thermals.push({ x: this.x + 700, y: this.y + 500, w: 4.0, R: 260 });
      } else if (this.h > this.hTop || !this.th || this.th.w < this.mc) {
        this.phase = 'cruise'; this.th = null;
      }

      // --- speed / heading / bank
      let vTarget, rollTarget = 0, turn = 0;
      // steer to the point after the start while the task is not started yet
      const tgt = nav.started || nav.active > 0 ? nav.target('tsk') : (nav.task[1] || nav.target('tsk')).wp;
      let brg = this.hdg;
      if (tgt) {
        const e = geo.enu(this.o0.lat, this.o0.lon, tgt.lat, tgt.lon);
        brg = (Math.atan2(e.e - this.x, e.n - this.y) / D2R + 360) % 360;
      }
      if (this.phase === 'climb') {
        vTarget = 22;
        const bank = 35;
        rollTarget = bank;
        turn = (G * Math.tan(bank * D2R)) / this.v; // rad/s, clockwise
        this.hdg = (this.hdg + turn / D2R * dt + 360) % 360;
        // centring: drift the circle toward the thermal core
        this.x += (this.th.x - this.x) * 0.05 * dt;
        this.y += (this.th.y - this.y) * 0.05 * dt;
      } else {
        // fly toward target (or toward a thermal if we are low)
        let aim = brg;
        if (this.cand) aim = (Math.atan2(this.cand.x - this.x, this.cand.y - this.y) / D2R + 360) % 360;
        const dh = geo.wrap180(aim - this.hdg);
        this.hdg = (this.hdg + clamp(dh, -6 * dt * 3, 6 * dt * 3) + 360) % 360;
        rollTarget = clamp(dh * 0.6, -25, 25);
        const air = this.airAt(this.x, this.y);
        vTarget = LX.polar.speedToFly(this.polar, this.mc, clamp(air - 0, -3, 3), 0);
      }
      this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt / 0.9));

      const dv = clamp(vTarget - this.v, -1.6 * dt, 1.6 * dt);
      this.v += dv;
      const dvdt = dt > 0 ? dv / dt : 0;

      // --- kinematics + energy
      const hr = this.hdg * D2R;
      this.x += (Math.sin(hr) * this.v + wv.x) * dt;
      this.y += (Math.cos(hr) * this.v + wv.y) * dt;
      const w = this.airAt(this.x, this.y);
      const bankFactor = Math.pow(1 / Math.max(0.5, Math.cos(this.roll * D2R)), 1.5);
      const vs = -this.polar.sink(this.v) * bankFactor + w - (this.v / G) * dvdt;
      this.vs = vs;
      this.h += vs * dt;

      // --- task progression
      const f = { lat: 0, lon: 0 };
      const p = geo.dest(this.o0.lat, this.o0.lon, (Math.atan2(this.x, this.y) / D2R + 360) % 360, Math.hypot(this.x, this.y));
      f.lat = p.lat; f.lon = p.lon;

      if (!emit) return;
      const gsx = Math.sin(hr) * this.v + wv.x;
      const gsy = Math.cos(hr) * this.v + wv.y;
      const pitch = Math.atan2(vs, this.v) / D2R + 2.5;
      this.o.onValues({
        lat: f.lat, lon: f.lon,
        alt: this.h / 0.3048,
        ias: this.v / 0.514444,
        gs: Math.hypot(gsx, gsy) / 0.514444,
        vs: vs / 0.3048,
        hdg: this.hdg,
        pitch,
        roll: this.roll,
        wdir: this.wind.from,
        wspd: this.wind.spd / 0.514444,
        qnh: 29.92,
      });

      const tt = performance.now();
      this.stamps.push(tt);
      while (this.stamps.length && tt - this.stamps[0] > 1000) this.stamps.shift();
      this.o.onStatus({ mode: 'demo', hz: this.stamps.length, message: 'Demo cross-country flight' });
    }
  }

  /** Small deterministic PRNG so the demo task/thermals are repeatable. */
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  LX.DemoXC = DemoXC;
})(window);
