/**
 * AeroPanel – core utilities.
 *
 * The whole app is built from classic (non-module) scripts hanging off one
 * global namespace, `AeroPanel`, so index.html works when opened straight from
 * disk (browsers block ES modules on file://).
 *
 *   AeroPanel.util        math, angle helpers, piecewise scales, smoothing
 *   AeroPanel.svg         tiny SVG construction helpers
 *   AeroPanel.units       unit systems (metric / imperial)
 *   AeroPanel.instruments instrument factories (one file each)
 *   AeroPanel.data        data sources + manager
 */
(function (global) {
  'use strict';

  const AP = (global.AeroPanel = global.AeroPanel || {});
  AP.instruments = AP.instruments || {};
  AP.data = AP.data || {};

  /* ------------------------------------------------------------------ math */
  const util = (AP.util = {});

  util.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  util.lerp = (a, b, t) => a + (b - a) * t;
  util.wrap360 = (a) => ((a % 360) + 360) % 360;
  /** Wrap to (-180, 180]. */
  util.wrap180 = (a) => {
    a = util.wrap360(a);
    return a > 180 ? a - 360 : a;
  };
  util.isNum = (v) => typeof v === 'number' && isFinite(v);

  /** Format with explicit sign, e.g. +3.2 / -1.0 (uses a true minus sign). */
  util.signed = (v, digits) => {
    const s = Math.abs(v).toFixed(digits);
    if (parseFloat(s) === 0) return ' ' + s;
    return (v < 0 ? '−' : '+') + s;
  };

  /**
   * Piecewise-linear scale. `stops` = [[value, fraction], ...] ascending in
   * both columns. Returns fn(value) -> fraction, linearly extrapolated past
   * the ends (so needles can overshoot a little instead of sticking).
   */
  util.piecewise = (stops) => {
    return (v) => {
      const n = stops.length;
      let i = 1;
      while (i < n - 1 && v > stops[i][0]) i++;
      const [v0, f0] = stops[i - 1];
      const [v1, f1] = stops[i];
      return f0 + ((v - v0) / (v1 - v0)) * (f1 - f0);
    };
  };

  /** Frame-rate independent exponential smoothing of a scalar. */
  util.Smooth = class {
    constructor(tau, v0) {
      this.tau = tau;
      this.value = v0 === undefined ? 0 : v0;
      this.target = this.value;
      this.primed = v0 !== undefined;
    }
    set(target) {
      this.target = target;
      if (!this.primed) {
        this.value = target;
        this.primed = true;
      }
    }
    snap(v) {
      this.value = this.target = v;
      this.primed = true;
    }
    step(dt) {
      this.value += (this.target - this.value) * (1 - Math.exp(-dt / this.tau));
      return this.value;
    }
  };

  /**
   * Smoothing for angles in degrees. Always travels the SHORT way round, so a
   * roll sample going 179 -> -179 sweeps 2 degrees, not 358 (the classic
   * "attitude indicator tumbles" bug). `value` is unwrapped (continuous).
   */
  util.SmoothAngle = class extends util.Smooth {
    set(target) {
      if (!this.primed) {
        this.value = target;
        this.primed = true;
      }
      this.target = this.value + util.wrap180(target - this.value);
    }
    snap(v) {
      // Keep the unwrapped value continuous; only the residue mod 360 changes.
      const w = this.primed ? this.value + util.wrap180(v - this.value) : v;
      this.value = this.target = w;
      this.primed = true;
    }
  };

  /* ------------------------------------------------------------------- svg */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (AP.svg = {});

  /** Create an SVG element, set attributes, optionally append to `parent`. */
  svg.el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  svg.text = (parent, x, y, str, cls, attrs) => {
    const t = svg.el('text', Object.assign({ x, y, class: cls || 'ap-text' }, attrs), parent);
    t.textContent = str;
    return t;
  };

  /** Point on a circle. Angle in degrees, 0 = 12 o'clock, clockwise. */
  svg.polar = (cx, cy, r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };

  /** SVG path for an arc from angle a0 to a1 (clockwise, degrees from top). */
  svg.arc = (cx, cy, r, a0, a1) => {
    const [x0, y0] = svg.polar(cx, cy, r, a0);
    const [x1, y1] = svg.polar(cx, cy, r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 >= a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  /** Radial line (tick) between two radii at one angle. */
  svg.tick = (parent, cx, cy, r0, r1, deg, cls) => {
    const [x0, y0] = svg.polar(cx, cy, r0, deg);
    const [x1, y1] = svg.polar(cx, cy, r1, deg);
    return svg.el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: cls || 'ap-tick' }, parent);
  };

  /** Create the root <svg> for a square instrument inside `host`. */
  svg.root = (host, viewBox) => {
    host.textContent = '';
    return svg.el(
      'svg',
      { viewBox: viewBox || '0 0 400 400', preserveAspectRatio: 'xMidYMid meet', role: 'img' },
      host
    );
  };

  /** Standard round bezel + face used by the dial instruments. */
  svg.dialFace = (root, cx, cy, r) => {
    svg.el('circle', { cx, cy, r: r + 8, class: 'ap-bezel-outer' }, root);
    svg.el('circle', { cx, cy, r, class: 'ap-face' }, root);
    svg.el('circle', { cx, cy, r: r - 1, class: 'ap-face-sheen' }, root);
  };

  /* ----------------------------------------------------------------- units */
  /**
   * Unit systems. Everything inside the app is kept in FlightGear-native units
   * (kt, ft, fpm, degrees, g); instruments convert only for display.
   */
  AP.units = (system) => {
    const metric = system !== 'imperial';
    return metric
      ? {
          system: 'metric',
          speed: { label: 'km/h', fromKt: 1.852, fromMs: 3.6 },
          alt: { label: 'm', fromFt: 0.3048 },
          vs: { label: 'm/s', fromFpm: 0.00508 },
          press: { label: 'hPa', fromHpa: 1, step: 1, digits: 0 },
        }
      : {
          system: 'imperial',
          speed: { label: 'kt', fromKt: 1, fromMs: 1.943844 },
          alt: { label: 'ft', fromFt: 1 },
          vs: { label: 'fpm', fromFpm: 1 },
          press: { label: 'inHg', fromHpa: 0.0295300, step: 0.01, digits: 2 },
        };
  };

  util.G0 = 9.80665;
  util.KT_TO_MS = 0.514444;
  util.FT_TO_M = 0.3048;
  util.INHG_TO_HPA = 33.8639;
})(window);
