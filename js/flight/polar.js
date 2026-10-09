/**
 * Glider polars and the MacCready maths built on them.
 *
 * A polar is stored as three (speed, sink) points and fitted with the usual
 * quadratic   w(v) = a v^2 + b v + c   (v in m/s, w = sink in m/s, positive
 * = descending). Water ballast scales the polar by sqrt(mass ratio); bugs
 * multiply the sink.
 *
 * !! The point values below are APPROXIMATE, entered from memory of published
 * !! figures, to make the demo behave plausibly. Replace them with the values
 * !! from your glider's flight manual / the FlightGear FDM before relying on
 * !! speed-to-fly or final glide numbers.
 */
(function (global) {
  'use strict';
  const LX = global.LX;

  /** pts: [[km/h, sink m/s positive], x3]; mass in kg at which pts are valid. */
  const GLIDERS = {
    ask21: {
      name: 'ASK 21',
      mass: 470, maxBallast: 0,
      pts: [[75, 0.65], [98, 0.80], [150, 1.75]],
    },
    mdm1: {
      name: 'MDM-1 Fox',
      mass: 350, maxBallast: 0,
      pts: [[80, 0.68], [100, 0.78], [160, 1.75]],
    },
    club15: {
      name: 'Generic 15 m (std class)',
      mass: 350, maxBallast: 150,
      pts: [[80, 0.62], [115, 0.80], [170, 1.55]],
    },
    open18: {
      name: 'Generic 18 m',
      mass: 400, maxBallast: 200,
      pts: [[85, 0.55], [120, 0.72], [180, 1.50]],
    },
  };

  /** Solve for [a, b, c] through three points (speeds converted to m/s). */
  function fit(pts) {
    const v = pts.map((p) => p[0] / 3.6);
    const w = pts.map((p) => p[1]);
    // Cramer's rule on the 3x3 Vandermonde system.
    const det = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = v.map((x) => [x * x, x, 1]);
    const D = det(M);
    const col = (i) => M.map((row, r) => row.map((x, c) => (c === i ? w[r] : x)));
    return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
  }

  /** Build a polar object for the current settings. */
  function make(id, ballastKg, bugsPct) {
    const g = GLIDERS[id] || GLIDERS.ask21;
    const [a, b, c] = fit(g.pts);
    const k = Math.sqrt((g.mass + Math.max(0, ballastKg || 0)) / g.mass);
    const bug = 1 + (bugsPct || 0) / 100;
    // Ballasted polar: w'(v) = k * w(v / k); sink magnitude then scaled by bugs.
    const sink = (v) => {
      const x = v / k;
      return Math.max(0.05, (a * x * x + b * x + c) * k * bug);
    };
    return { id, name: g.name, sink, k, mass: g.mass + (ballastKg || 0), minSpeed: 60 / 3.6, maxSpeed: 250 / 3.6 };
  }

  /** Speed (m/s) of minimum sink and of best glide in still air. */
  function characteristics(p) {
    let minSink = { v: 0, w: 1e9 };
    let bestLD = { v: 0, ld: 0 };
    for (let v = p.minSpeed; v <= p.maxSpeed; v += 0.1) {
      const w = p.sink(v);
      if (w < minSink.w) minSink = { v, w };
      if (v / w > bestLD.ld) bestLD = { v, ld: v / w, w };
    }
    return { minSink, bestLD };
  }

  /**
   * MacCready speed to fly.
   *   mc        MacCready setting, m/s (>= 0)
   *   air       vertical air movement, m/s (+ = lift, - = sink)
   *   headwind  m/s (+ = headwind)
   * Maximises cross-country speed  (v - headwind) / (sink(v) - air + mc)
   * Returns airspeed in m/s.
   */
  function speedToFly(p, mc, air, headwind) {
    let best = p.minSpeed;
    let bestScore = -1e9;
    for (let v = p.minSpeed; v <= p.maxSpeed; v += 0.25) {
      const gs = v - (headwind || 0);
      const denom = p.sink(v) - (air || 0) + Math.max(0, mc);
      if (denom <= 0.01) continue;
      const score = gs / denom;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  /**
   * Final glide to a point `dist` m away, `bearing`-independent: caller gives
   * the headwind component along the track to the point.
   * Returns { v, ground, sink, heightNeeded, arrivalHeight, ratio }
   *   heightNeeded  height lost on the way at MacCready speed-to-fly
   *   arrivalHeight altitude margin above (target elevation + safety) on arrival
   */
  function finalGlide(p, o) {
    const v = speedToFly(p, o.mc, o.air || 0, o.headwind);
    const gs = Math.max(1, v - (o.headwind || 0));
    const sink = p.sink(v) - (o.air || 0);
    const t = o.dist / gs;
    const heightNeeded = Math.max(0, sink) * t;
    const arrival = o.alt - o.targetElev - (o.safety || 0) - heightNeeded;
    return { v, ground: gs, sink, heightNeeded, arrivalHeight: arrival, ratio: gs / Math.max(0.01, sink), time: t };
  }

  /* Ballast can be entered as water weight (kg) or as the resulting wing loading (kg/m2) (manual 7.1.11). */
  function wingLoading(s) { return (s.wbEmpty + s.wbPilot + s.wbCopilot + s.wbChute + s.ballast) / s.wbArea; }
  function ballastFromLoad(s, load, maxBallast) {
    const dry = s.wbEmpty + s.wbPilot + s.wbCopilot + s.wbChute;
    return Math.round(Math.max(0, Math.min(maxBallast, load * s.wbArea - dry)));
  }

  LX.polar = { GLIDERS, fit, make, characteristics, speedToFly, finalGlide, wingLoading, ballastFromLoad };
})(window);
