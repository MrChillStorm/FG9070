/** Sunrise / sunset (NOAA algorithm, accurate to about a minute). Times are Date objects (UTC instants). */
(function (global) {
  'use strict';
  const R = Math.PI / 180;

  function times(lat, lon, date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const n = Math.floor(d.getTime() / 86400000) + 2440587.5 - 2451545.0 + 0.5;
    const out = {};
    for (const k of ['rise', 'set']) {
      let tUTC = k === 'rise' ? 6 - lon / 15 : 18 - lon / 15; // hours, refined once
      let r = null;
      for (let it = 0; it < 3; it++) {
        const T = (n + tUTC / 24) / 36525;
        const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
        const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
        const C = Math.sin(M * R) * (1.914602 - T * 0.004817) + Math.sin(2 * M * R) * 0.019993 + Math.sin(3 * M * R) * 0.000289;
        const lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * R);
        const eps = 23.439291 - 0.0130042 * T + 0.00256 * Math.cos((125.04 - 1934.136 * T) * R);
        const dec = Math.asin(Math.sin(eps * R) * Math.sin(lam * R));
        const y = Math.tan((eps * R) / 2) ** 2;
        const eot = 4 / R * (y * Math.sin(2 * L0 * R) - 2 * 0.016708634 * Math.sin(M * R) + 4 * 0.016708634 * y * Math.sin(M * R) * Math.cos(2 * L0 * R) - 0.5 * y * y * Math.sin(4 * L0 * R) - 1.25 * 0.016708634 ** 2 * Math.sin(2 * M * R));
        const cosH = (Math.cos(90.833 * R) - Math.sin(lat * R) * Math.sin(dec)) / (Math.cos(lat * R) * Math.cos(dec));
        if (cosH > 1 || cosH < -1) return null; // polar day / night
        const H = Math.acos(cosH) / R;
        tUTC = (720 - 4 * (lon + (k === 'rise' ? H : -H)) - eot) / 60;
        r = tUTC;
      }
      out[k] = new Date(d.getTime() + r * 3600000);
    }
    if (out.set < out.rise) out.set = new Date(out.set.getTime() + 86400000);
    return out;
  }

  const fmt = (d) => (d ? d.toISOString().slice(11, 16) + 'Z' : '--:--');
  global.LX.sun = { times, fmt };
})(window);
