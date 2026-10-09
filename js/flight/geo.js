/**
 * Small geodesy helpers. Distances use the FAI sphere or the WGS84 ellipsoid (Setup > Units); bearings, destination
 * points and the local east/north offsets stay spherical, which is plenty accurate for a cockpit display.
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

  // Setup > Units > Dist. calc. method (manual 7.1.11): 'fai' = FAI sphere (R = 6371 km), 'wgs84' = WGS84 ellipsoid (Vincenty)
  let method = 'fai';
  const R_FAI = 6371000;
  const WGS = { a: 6378137, f: 1 / 298.257223563 };

  /** Great-circle distance on a sphere of radius `r`, m. */
  function sphereDist(lat1, lon1, lat2, lon2, r) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R;
    const dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Geodesic distance on the WGS84 ellipsoid (Vincenty's inverse formula), m; falls back to the sphere if it does not converge. */
  function ellipsoidDist(lat1, lon1, lat2, lon2) {
    const { a, f } = WGS, b = a * (1 - f);
    const L = (lon2 - lon1) * D2R;
    const U1 = Math.atan((1 - f) * Math.tan(lat1 * D2R)), U2 = Math.atan((1 - f) * Math.tan(lat2 * D2R));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, sinS, cosS, sigma, cos2a, cos2sm;
    for (let i = 0; i < 100; i++) {
      const sl = Math.sin(lam), cl = Math.cos(lam);
      sinS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
      if (sinS === 0) return 0; // coincident points
      cosS = sU1 * sU2 + cU1 * cU2 * cl;
      sigma = Math.atan2(sinS, cosS);
      const sinA = (cU1 * cU2 * sl) / sinS;
      cos2a = 1 - sinA * sinA;
      cos2sm = cos2a ? cosS - (2 * sU1 * sU2) / cos2a : 0; // equatorial line
      const C = (f / 16) * cos2a * (4 + f * (4 - 3 * cos2a));
      const prev = lam;
      lam = L + (1 - C) * f * sinA * (sigma + C * sinS * (cos2sm + C * cosS * (-1 + 2 * cos2sm * cos2sm)));
      if (Math.abs(lam - prev) < 1e-12) {
        const u2 = (cos2a * (a * a - b * b)) / (b * b);
        const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
        const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
        const ds = B * sinS * (cos2sm + (B / 4) * (cosS * (-1 + 2 * cos2sm * cos2sm) - (B / 6) * cos2sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2sm * cos2sm)));
        return b * A * (sigma - ds);
      }
    }
    return sphereDist(lat1, lon1, lat2, lon2, R_FAI); // nearly antipodal: no convergence
  }

  /** Distance between two points, m, by the selected calculation method. */
  function dist(lat1, lon1, lat2, lon2) {
    return method === 'wgs84' ? ellipsoidDist(lat1, lon1, lat2, lon2) : sphereDist(lat1, lon1, lat2, lon2, R_FAI);
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

  LX.geo = { R, wrap360, wrap180, dist, bearing, dest, enu, ellipsoidDist, sphereDist, setMethod: (m) => { method = m === 'wgs84' ? 'wgs84' : 'fai'; }, get method() { return method; } };
})(window);
