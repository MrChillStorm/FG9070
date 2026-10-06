/**
 * Flight – the "brain": ingests raw FlightGear samples and derives everything
 * the instrument pages show.
 *
 * Raw input (FlightGear units, see data/props.js) -> SI state `f`:
 *   position, MSL altitude, IAS/TAS, ground speed, track, vertical speed,
 *   attitude, wind
 * Derived:
 *   TE vario (IAS or TAS source, % compensation), netto, averages
 *   cruise / climb (SC) mode via Auto SC (GPS circling detection)
 *   MacCready speed-to-fly and delta
 *   circling + thermal tracking (thermal assistant bins, thermal history)
 *   target navigation: bearing, distance, ETE/ETA, head wind, final glide
 *   (arrival altitude, required/current glide ratio)
 *   flight timer and landing detection
 *
 * Everything is recomputed per ingested sample; pages just read `flight.f`.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { wrap360, wrap180, dist, bearing } = LX.geo;
  const KT = LX.util.KT_TO_MS;
  const FT = LX.util.FT_TO_M;
  const clamp = LX.util.clamp;

  /** ISA density ratio sigma = rho/rho0 for altitude h (m). */
  const sigma = (h) => Math.pow(Math.max(0.2, 1 - 2.25577e-5 * Math.max(-500, h)), 4.25588);

  class Flight {
    constructor(settings) {
      this.S = settings;
      this.te = new LX.TEVario();
      this.avgVario = new LX.Averager(20);
      this.avgNetto = new LX.Averager(20);
      this.polar = null;
      this.polarKey = '';
      this.target = null; // { name, lat, lon, elev, code }
      this.reset();
    }

    reset() {
      this.te.reset();
      this.have = false;
      this.seq = 0;
      this.lastPos = null; // { t, lat, lon }
      this.lastTrack = null;
      this.turnRate = 0; // deg/s, signed (+ right)
      this.circlingSince = null;
      this.straightSince = null;
      this.thermal = null; // current thermal record
      this.thermals = []; // finished thermals (newest last)
      this.bins = new Array(24).fill(null); // thermal assistant: TE by compass sector
      this.eHist = []; // [t, totalEnergyHeight, lat, lon] for current glide ratio
      this.flying = false;
      this.flightStart = null;
      this.landedSince = null;
      this.flights = [];
      this.f = {
        t: 0, lat: 0, lon: 0, alt: 0, ias: 0, tas: 0, gs: 0, vs: 0,
        hdg: 0, pitch: 0, roll: 0, track: 0,
        windDir: 0, windSpd: 0, qnhSim: 1013.25,
        te: 0, teFast: 0, teRaw: 0, netto: 0, avgV: 0, avgN: 0, relative: 0,
        mode: 'sc', // 'sc' cruise | 'vario' climb
        stf: 0, stfDelta: 0, sinkNow: 0,
        circling: false, turnRate: 0,
        nav: null, flightTime: 0, flying: false,
        glideRatioNow: Infinity, gForce: 1,
      };
    }

    /** Polar for the current glider / ballast / bugs settings (cached). */
    getPolar() {
      const s = this.S.get();
      const key = `${s.glider}|${s.ballast}|${s.bugs}`;
      if (key !== this.polarKey) {
        this.polar = LX.polar.make(s.glider, s.ballast, s.bugs);
        this.polarKey = key;
      }
      return this.polar;
    }

    setTarget(t) {
      this.target = t;
    }

    /** Main entry: values keyed per props.js in FlightGear-native units. */
    ingest(v, tMs) {
      const s = this.S.get();
      const f = this.f;
      const num = (x, d) => (Number.isFinite(x) ? x : d);

      // --- raw -> SI (keep last good value if a property is missing)
      if (Number.isFinite(v.lat) && Number.isFinite(v.lon)) { f.lat = v.lat; f.lon = v.lon; this.have = true; }
      f.alt = num(v.alt * FT, f.alt);
      f.ias = Math.max(0, num(v.ias * KT, f.ias));
      f.tas = Number.isFinite(v.tas) ? Math.max(0, v.tas * KT) : f.ias / Math.sqrt(sigma(f.alt));
      f.vs = num(v.vs * FT, f.vs);
      f.hdg = num(v.hdg, f.hdg);
      f.pitch = num(v.pitch, f.pitch);
      f.roll = num(v.roll, f.roll);
      f.windDir = num(v.wdir, f.windDir);
      f.windSpd = num(v.wspd * KT, f.windSpd);
      if (Number.isFinite(v.qnh)) f.qnhSim = v.qnh * LX.util.INHG_TO_HPA;
      if (Number.isFinite(v.gelev)) f.gelev = v.gelev;
      f.t = tMs;
      f.valid = this.have;

      // --- track / ground speed from successive positions
      if (this.lastPos && tMs > this.lastPos.t) {
        const dt = (tMs - this.lastPos.t) / 1000;
        const d = dist(this.lastPos.lat, this.lastPos.lon, f.lat, f.lon);
        if (dt > 0.02 && d > 0.3) {
          const gsInst = d / dt;
          const trk = bearing(this.lastPos.lat, this.lastPos.lon, f.lat, f.lon);
          if (!Number.isFinite(v.gs)) f.gs += (gsInst - f.gs) * (1 - Math.exp(-dt / 0.6));
          if (gsInst > 2) {
            const prev = this.lastTrack === null ? trk : this.lastTrack;
            const dTrk = wrap180(trk - prev);
            this.lastTrack = prev + dTrk * (1 - Math.exp(-dt / 0.4));
            f.track = wrap360(this.lastTrack);
            const inst = dTrk / dt;
            this.turnRate += (inst - this.turnRate) * (1 - Math.exp(-dt / 1.5));
          }
          this.lastPos = { t: tMs, lat: f.lat, lon: f.lon };
        }
      } else {
        this.lastPos = { t: tMs, lat: f.lat, lon: f.lon };
        f.track = f.hdg;
      }
      if (Number.isFinite(v.gs)) f.gs = v.gs * KT;
      f.turnRate = this.turnRate;

      // --- TE vario (see te.js). Speed source selectable; % compensation.
      const polar = this.getPolar();
      const vSrc = s.teSource === 'tas' ? f.tas : f.ias;
      const sinkNow = polar.sink(f.ias);
      f.sinkNow = sinkNow;
      const o = this.te.update(tMs, f.vs, vSrc, sinkNow, s.needleTau, s.teComp / 100);
      f.teRaw = o.raw;
      f.te = o.te;
      f.teFast = o.fast; // audio uses its own filter below
      f.netto = o.netto;
      f.relative = o.netto;
      f.teSound = this._soundFilter(o.raw, tMs, s.soundTau);
      this.avgVario.w = s.integrator * 1000;
      this.avgNetto.w = s.nettoTime * 1000;
      this.avgVario.push(tMs, o.raw);
      this.avgNetto.push(tMs, o.netto);
      f.avgV = this.avgVario.value;
      f.avgN = this.avgNetto.value;

      // --- circling detection & cruise/climb mode
      this._circling(tMs, s);

      // --- MacCready speed to fly (uses netto as air movement, SC filtered)
      const hw = this._headwindAlong(f.track);
      f.stf = LX.polar.speedToFly(polar, s.mc, clamp(f.netto, -3, 3), hw);
      f.stfDelta = f.ias - f.stf;

      // --- target navigation + final glide
      f.nav = this._nav(tMs, s, polar);

      // --- flying / landing
      this._flightTimer(tMs, f);

      this.seq++;
      return f;
    }

    /* ------------------------------------------------------------------ sound */
    _soundFilter(raw, t, tau) {
      if (this._sf === undefined) { this._sf = raw; this._sft = t; return raw; }
      const dt = Math.max(0, (t - this._sft) / 1000);
      this._sft = t;
      this._sf += (raw - this._sf) * (1 - Math.exp(-dt / Math.max(0.05, tau)));
      return this._sf;
    }

    /* --------------------------------------------------------------- circling */
    _circling(t, s) {
      const f = this.f;
      const fast = Math.abs(this.turnRate) > 6; // deg/s
      if (fast) {
        this.straightSince = null;
        if (this.circlingSince === null) this.circlingSince = t;
      } else {
        this.circlingSince = null;
        if (this.straightSince === null) this.straightSince = t;
      }
      const was = f.circling;
      f.circling = this.circlingSince !== null && t - this.circlingSince > 8000;
      if (f.circling && !was) this._thermalStart(t);
      if (!f.circling && was && this.straightSince !== null && t - this.straightSince > 6000) this._thermalEnd(t);
      else if (!f.circling && was && !(this.straightSince !== null && t - this.straightSince > 6000)) f.circling = true; // hysteresis

      // Auto SC: GPS circling -> climb (after ~10 s); straight -> cruise.
      if (s.autoSC === 'GPS') f.mode = f.circling ? 'vario' : 'sc';
      else if (s.autoSC === 'IAS') f.mode = f.ias * 3.6 > 130 ? 'sc' : 'vario';
      else if (s.autoSC === 'G-load') f.mode = Math.abs(f.roll) > 25 ? 'vario' : 'sc';
      else f.mode = this.manualMode || f.mode;

      if (f.circling) {
        // thermal assistant: smoothed TE by compass sector of the current track
        const bin = Math.floor(wrap360(f.track) / 15) % 24;
        const prev = this.bins[bin];
        this.bins[bin] = prev === null ? f.teRaw : prev + (f.teRaw - prev) * 0.5;
        if (this.thermal) {
          this.thermal.samples.push(f.teRaw);
          this.thermal.maxAlt = Math.max(this.thermal.maxAlt, f.alt);
        }
      }
    }

    _thermalStart(t) {
      const f = this.f;
      this.bins.fill(null);
      this.thermal = { t0: t, alt0: f.alt, maxAlt: f.alt, lat: f.lat, lon: f.lon, samples: [] };
      if (this.S.get().autoResetIntegrator) this.avgVario.buf.length = 0;
    }

    _thermalEnd(t) {
      const th = this.thermal;
      this.thermal = null;
      if (!th) return;
      const f = this.f;
      const dur = (t - th.t0) / 1000;
      if (dur > 25) {
        const gain = f.alt - th.alt0;
        this.thermals.push({ t0: th.t0, t1: t, alt0: th.alt0, alt1: f.alt, gain, avg: gain / dur, dur, lat: th.lat, lon: th.lon });
        if (this.thermals.length > 30) this.thermals.shift();
      }
      this.bins.fill(null);
    }

    /** Mean climb of the last `n` thermals (m/s), null if none. */
    lastThermalsAvg(n) {
      const list = this.thermals.slice(-n);
      if (!list.length) return null;
      return list.reduce((a, b) => a + b.avg, 0) / list.length;
    }

    /* ------------------------------------------------------------------ wind */
    /** Headwind component (m/s, + = headwind) along `course` degrees. */
    _headwindAlong(course) {
      const f = this.f;
      return f.windSpd * Math.cos((f.windDir - course) * Math.PI / 180);
    }

    /* ------------------------------------------------------------ navigation */
    _nav(t, s, polar) {
      const f = this.f;
      this._energy(t);
      return this.navTo(this.target);
    }

    /** Energy-height history for "E" (current glide ratio over 3 min). */
    _energy(t) {
      const f = this.f;
      const eh = f.alt + (f.tas * f.tas) / (2 * LX.util.G0);
      this.eHist.push([t, eh, f.lat, f.lon]);
      while (this.eHist.length && t - this.eHist[0][0] > 180000) this.eHist.shift();
      let ratio = Infinity;
      if (this.eHist.length > 5) {
        const a = this.eHist[0];
        const lost = a[1] - eh;
        const d = dist(a[2], a[3], f.lat, f.lon);
        if (lost > 0.5) ratio = d / lost;
      }
      f.glideRatioNow = ratio;
    }

    /** Navigation/final-glide numbers toward any target (pure; used per mode). */
    navTo(tg, route) {
      const f = this.f, s = this.S.get(), polar = this.getPolar(), t = f.t;
      if (!tg || !this.have) return null;
      const d = dist(f.lat, f.lon, tg.lat, tg.lon);
      // route: { dist, elev } – final glide over a whole task instead of to the active point
      const D = route ? route.dist : d;
      const elevT = route && Number.isFinite(route.elev) ? route.elev : (tg.elev || 0);
      const brg = bearing(f.lat, f.lon, tg.lat, tg.lon);
      const hw = this._headwindAlong(brg);
      const mcSafe = Math.max(0, s.mc + s.mcOffset);
      const run = (mc) => LX.polar.finalGlide(polar, {
        mc, dist: D, headwind: hw, alt: f.alt, targetElev: elevT, safety: s.safetyAlt, air: 0,
      });
      const fg = run(mcSafe);
      const fg0 = run(0);
      const reqH = f.alt - elevT - s.safetyAlt; // usable height
      const reqE = reqH > 1 ? D / reqH : Infinity;
      const gsEff = Math.max(1, f.gs > 3 ? f.gs : fg.ground);
      return {
        target: tg,
        dist: d,
        distTotal: D,
        bearing: brg,
        relBearing: wrap180(brg - f.track),
        headwind: hw,
        crosswind: f.windSpd * Math.sin((f.windDir - brg) * Math.PI / 180),
        arrival: fg.arrivalHeight, // m above target+safety at Mc(safety)
        arrivalMc0: fg0.arrivalHeight,
        reqE: reqE, // required glide ratio from here
        Emc: fg.ratio,
        Emc0: fg0.ratio,
        stfFG: fg.v,
        pct: fg.heightNeeded > 1 ? (fg.arrivalHeight / fg.heightNeeded) * 100 : (fg.arrivalHeight > 0 ? 999 : -999),
        ete: D / gsEff,
        eta: t / 1000 + D / gsEff, // seconds on the sim timeline
      };
    }

    /* ----------------------------------------------------------- flight timer */
    _flightTimer(t, f) {
      const moving = f.gs > 10 && f.ias > 14;
      if (!this.flying && moving) {
        this.flying = true;
        this.flightStart = t;
        this.flightStartAlt = f.alt;
        this.flightStartPos = { lat: f.lat, lon: f.lon };
        this.maxAlt = f.alt;
        this.landedSince = null;
        this.thermals = [];
      }
      if (this.flying) {
        this.maxAlt = Math.max(this.maxAlt, f.alt);
        if (f.gs < 3 && f.ias < 8) {
          if (this.landedSince === null) this.landedSince = t;
          if (t - this.landedSince > 10000 && t - this.flightStart > 60000) this._landed(t, f);
        } else this.landedSince = null;
      }
      f.flying = this.flying;
      f.flightTime = this.flying ? (t - this.flightStart) / 1000 : 0;
    }

    _landed(t, f) {
      this.flying = false;
      const rec = {
        date: new Date().toISOString().slice(0, 10),
        start: new Date(Date.now() - (t - this.flightStart)).toTimeString().slice(0, 5),
        dur: (t - this.flightStart) / 1000,
        maxAlt: this.maxAlt,
        thermals: this.thermals.length,
      };
      this.flights.unshift(rec);
      if (this.onLanded) this.onLanded(rec);
      try {
        const k = 'fg9070.logbook.v1';
        const old = JSON.parse(global.localStorage.getItem(k) || '[]');
        old.unshift(rec);
        global.localStorage.setItem(k, JSON.stringify(old.slice(0, 200)));
      } catch (e) { /* ignore */ }
    }
  }

  LX.Flight = Flight;
})(window);
