/**
 * Small geodesy helpers (spherical earth; plenty accurate for a cockpit
 * display – the real unit offers WGS84/FAI-sphere selection).
 * Angles in degrees, distances in metres.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const R = 6371008.8;
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  const wrap360 = (a) => ((a % 360) + 360) % 360;
  const wrap180 = (a) => {
    a = wrap360(a);
    return a > 180 ? a - 360 : a;
  };

  /** Great-circle distance, m. */
  function dist(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R;
    const dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Initial bearing from point 1 to point 2, degrees true. */
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return wrap360(Math.atan2(y, x) * R2D);
  }

  /** Point `d` m from (lat, lon) along bearing `brg`. */
  function dest(lat, lon, brg, d) {
    const p1 = lat * D2R, l1 = lon * D2R, b = brg * D2R, dr = d / R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
  }

  /** Local east/north offset (m) of (lat, lon) relative to (lat0, lon0). */
  function enu(lat0, lon0, lat, lon) {
    return {
      e: (lon - lon0) * D2R * R * Math.cos(lat0 * D2R),
      n: (lat - lat0) * D2R * R,
    };
  }

  LX.geo = { R, wrap360, wrap180, dist, bearing, dest, enu };
})(window);
