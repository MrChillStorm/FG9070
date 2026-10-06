/**
 * Flight path optimisation (manual 7.1.9, 7.4.2.3).
 *
 * The unit lets the pilot pick the number of optimisation points (five = OLC
 * style, three = FAI free flight; manual 7.1.9). Here:
 *   free(points)      best distance start -> TP1..TPn -> finish along the track
 *                     (n = 3: OLC style five points, n = 1: three points)
 *   triangle(points)  best closed FAI-style triangle (simplified, see below)
 *
 * Simplifications (documented in the README): no 10 km minimum leg handling
 * (the manual notes the same limitation), triangle vertices are track points (the real
 * rules let the start/finish gate differ within a 20 % closing allowance), the
 * 28 % / 25 % shortest-side rule is applied, OLC points = distance only.
 * Not an official scoring tool.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;

  /** Reduce to at most `max` points, always keeping first and last. */
  function decimate(fixes, max) {
    if (fixes.length <= max) return fixes.map((f, i) => ({ i, t: f[0], lat: f[1], lon: f[2], alt: f[3] }));
    const out = [];
    const step = (fixes.length - 1) / (max - 1);
    for (let k = 0; k < max; k++) { const i = Math.round(k * step); const f = fixes[i]; out.push({ i, t: f[0], lat: f[1], lon: f[2], alt: f[3] }); }
    return out;
  }

  function matrix(pts) {
    const n = pts.length, d = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) d[a * n + b] = d[b * n + a] = geo.dist(pts[a].lat, pts[a].lon, pts[b].lat, pts[b].lon);
    return d;
  }

  /**
   * Best path through `legs + 1` points in track order maximising total distance.
   * @returns { dist, idx:[indices into pts], legs:[m] }
   */
  function free(fixes, turnpoints, maxPts) {
    const pts = decimate(fixes, maxPts || 160);
    const n = pts.length;
    if (n < 2) return { dist: 0, pts: [], legs: [] };
    const D = matrix(pts);
    const L = (turnpoints || 3) + 1; // legs
    // best[k][j] = best distance using k legs ending at point j
    const best = Array.from({ length: L + 1 }, () => new Float64Array(n).fill(-1));
    const from = Array.from({ length: L + 1 }, () => new Int16Array(n).fill(-1));
    for (let j = 0; j < n; j++) best[0][j] = 0;
    for (let k = 1; k <= L; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i <= j; i++) {
          if (best[k - 1][i] < 0) continue;
          const v = best[k - 1][i] + D[i * n + j];
          if (v > best[k][j]) { best[k][j] = v; from[k][j] = i; }
        }
      }
    }
    let end = 0;
    for (let j = 0; j < n; j++) if (best[L][j] > best[L][end]) end = j;
    const idx = [end];
    for (let k = L; k >= 1; k--) idx.unshift(from[k][idx[0]]);
    const legs = [];
    for (let k = 1; k < idx.length; k++) legs.push(D[idx[k - 1] * n + idx[k]]);
    return { dist: best[L][end], pts: idx.map((i) => pts[i]), legs };
  }

  /** FAI-style triangle: best perimeter with the shortest side >= 28 % (25 % above 750 km). */
  function triangle(fixes, maxPts) {
    const pts = decimate(fixes, maxPts || 70);
    const n = pts.length;
    if (n < 3) return null;
    const D = matrix(pts);
    let best = null;
    for (let a = 0; a < n - 2; a++) {
      for (let b = a + 1; b < n - 1; b++) {
        const ab = D[a * n + b];
        if (ab < 5000) continue;
        for (let c = b + 1; c < n; c++) {
          const bc = D[b * n + c], ca = D[c * n + a];
          const P = ab + bc + ca;
          const minSide = Math.min(ab, bc, ca) / P;
          if (minSide < (P > 750000 ? 0.25 : 0.28)) continue;
          if (!best || P > best.dist) best = { dist: P, pts: [pts[a], pts[b], pts[c], pts[a]], legs: [ab, bc, ca] };
        }
      }
    }
    return best;
  }

  /** Average speed (m/s) of an optimised path from its first to last point. */
  function speed(res) {
    if (!res || res.pts.length < 2) return 0;
    const dt = res.pts[res.pts.length - 1].t - res.pts[0].t;
    return dt > 0 ? res.dist / dt : 0;
  }

  LX.Optimizer = { free, triangle, speed, decimate };
})(window);
