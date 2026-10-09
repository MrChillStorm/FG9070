/**
 * Total-energy (TE) compensated variometer, netto and averages.
 *
 * Specific energy height:   E = h + v^2 / (2 g)
 * TE variometer:            TE = dE/dt = vs + (v / g) * dv/dt
 *
 * where vs is the aircraft's own vertical speed and v the speed used for the
 * kinetic term. FlightGear supplies vs directly (no need to differentiate
 * altitude), so only dv/dt is differentiated – smoothed with a short filter
 * because differentiating noisy samples amplifies noise.
 *
 * `source` selects v:
 *   'ias'  indicated airspeed (default) – what a real TE probe sees, so the
 *          small IAS-vs-TAS error of a real instrument is reproduced
 *   'tas'  true airspeed – "high accuracy" mode, exact energy bookkeeping
 *
 * Netto (air-mass vertical velocity) = TE + sink_polar(v_IAS): the polar sink
 * is added back so a glider flying a standard polar in still air reads 0.
 *
 * Outputs (m/s):
 *   raw      unfiltered TE
 *   te       display value filtered with `tau`
 *   fast     lightly filtered value for the audio vario (fast response)
 *   netto    filtered netto
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const G = 9.80665;

  class TEVario {
    constructor() {
      this.reset();
    }

    reset() {
      this.lastT = null;
      this.lastV = null;
      this.dvdt = 0;
      this.vsF = undefined;
      this.out = { raw: 0, te: 0, fast: 0, netto: 0, dvdt: 0, primed: false };
    }

    /**
     * @param t        sample time, ms
     * @param vs       vertical speed, m/s (+ up)
     * @param v        speed for the kinetic term, m/s
     * @param sinkAtV  polar sink at the current IAS, m/s (positive)
     * @param tau      display integration time, s (Vario needle filter)
     * @param comp     digital TE compensation 0..1 (100 % = fully compensated)
     * @param nettoTau netto filter time constant, s (default: max(tau, 1))
     */
    update(t, vs, v, sinkAtV, tau, comp, nettoTau) {
      if (comp === undefined) comp = 1;
      const o = this.out;
      if (this.lastT !== null && t > this.lastT) {
        const dt = (t - this.lastT) / 1000;
        if (dt < 1) {
          const inst = (v - this.lastV) / dt;
          // dv/dt and vs share ONE filter so they stay time-aligned: filtering
          // only dv/dt leaves a transient error whenever the pilot changes
          // the pull (vs jumps, filtered dv/dt lags).
          const a = 1 - Math.exp(-dt / 0.25);
          this.dvdt += (inst - this.dvdt) * a;
          this.vsF = this.vsF === undefined ? vs : this.vsF + (vs - this.vsF) * a;
          const raw = this.vsF + comp * (v / G) * this.dvdt;
          o.raw = raw;
          o.nettoInst = raw + sinkAtV; // unfiltered netto (state.js applies the Netto / SC / Relative filters)
          o.dvdt = this.dvdt;
          if (!o.primed) {
            o.te = o.fast = raw;
            o.netto = raw + sinkAtV;
            o.primed = true;
          } else {
            const f = (tc) => 1 - Math.exp(-dt / Math.max(0.05, tc));
            o.te += (raw - o.te) * f(tau);
            o.fast += (raw - o.fast) * f(0.35);
            o.netto += (raw + sinkAtV - o.netto) * f(nettoTau !== undefined ? nettoTau : Math.max(tau, 1));
          }
        }
      }
      this.lastT = t;
      this.lastV = v;
      return o;
    }
  }

  /** Moving average over a time window (seconds). */
  class Averager {
    constructor(windowS) {
      this.w = windowS * 1000;
      this.buf = [];
    }
    push(t, v) {
      this.buf.push([t, v]);
      while (this.buf.length && t - this.buf[0][0] > this.w) this.buf.shift();
    }
    get value() {
      if (!this.buf.length) return 0;
      let s = 0;
      for (const b of this.buf) s += b[1];
      return s / this.buf.length;
    }
  }

  LX.TEVario = TEVario;
  LX.Averager = Averager;
})(window);
