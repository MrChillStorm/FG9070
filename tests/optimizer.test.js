// Run: node tests/optimizer.test.js
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
const mem = {}; global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
global.LX = { util: AeroPanel.util, filesUI: { download() {} } };
['flight/geo.js', 'flight/polar.js', 'nav/nav.js', 'nav/files.js', 'nav/optimizer.js', 'nav/recorder.js'].forEach(f => require('../js/' + f));
const geo = LX.geo;

// build a track that flies A -> B -> C -> A along straight lines (fixes every ~1 km)
const track = (corners) => {
  const out = []; let t = 0;
  for (let k = 1; k < corners.length; k++) {
    const a = corners[k - 1], b = corners[k], d = geo.dist(a.lat, a.lon, b.lat, b.lon), br = geo.bearing(a.lat, a.lon, b.lat, b.lon);
    for (let s = 0; s < d; s += 1000) { const p = geo.dest(a.lat, a.lon, br, s); out.push([t += 25, p.lat, p.lon, 1500, 40, 0]); }
  }
  const e = corners[corners.length - 1]; out.push([t += 25, e.lat, e.lon, 1500, 40, 0]);
  return out;
};
const A = { lat: 46, lon: 14 }, B = Object.assign({}, geo.dest(46, 14, 60, 30000)), C = Object.assign({}, geo.dest(46, 14, 0, 30000));
// equilateral-ish triangle
const perim = geo.dist(A.lat, A.lon, B.lat, B.lon) + geo.dist(B.lat, B.lon, C.lat, C.lon) + geo.dist(C.lat, C.lon, A.lat, A.lon);
const tri = track([A, B, C, A]);

const f = LX.Optimizer.free(tri, 3);
assert.ok(f.dist >= perim * 0.99 && f.dist <= perim * 1.12, `free distance ~ perimeter: ${f.dist | 0} vs ${perim | 0}`);
assert.strictEqual(f.pts.length, 5, 'start + 3 turn points + finish');
assert.ok(f.pts.every((p, i) => i === 0 || p.t >= f.pts[i - 1].t), 'points in track order');

const out = LX.Optimizer.free(track([A, B, A]), 1);
assert.ok(Math.abs(out.dist - 2 * geo.dist(A.lat, A.lon, B.lat, B.lon)) < 2500, 'out and return: free distance with 1 TP is twice the leg');
assert.strictEqual(out.pts.length, 3);

const T = LX.Optimizer.triangle(tri);
assert.ok(T && T.dist > perim * 0.95 && T.dist <= perim * 1.001, 'FAI triangle found: ' + (T && (T.dist | 0)));
assert.ok(Math.min(...T.legs) / T.dist >= 0.28, '28 % rule');
assert.strictEqual(LX.Optimizer.triangle(track([A, B, A])), null, 'out-and-return is not an FAI triangle');
// a long thin triangle violates the 28 % rule
const thin = track([A, geo.dest(46, 14, 90, 60000), geo.dest(46, 14, 92, 60000), A].map(p => ({ lat: p.lat, lon: p.lon })));
const tt = LX.Optimizer.triangle(thin);
assert.ok(!tt || Math.min(...tt.legs) / tt.dist >= 0.28, 'no invalid thin triangle');
assert.ok(LX.Optimizer.speed(f) > 0);

// decimation keeps the ends
const dec = LX.Optimizer.decimate(tri, 20);
assert.strictEqual(dec.length, 20); assert.strictEqual(dec[0].i, 0); assert.strictEqual(dec[19].i, tri.length - 1);

// recorder: flying -> fixes -> end -> persisted, IGC export parses
const S = { get: () => ({ recInterval: 4, glider: 'ask21', pilot: 'Test Pilot' }) };
const nav = new LX.Nav(); nav.options = { name: 'T' }; nav.task = [];
const rec = new LX.Recorder(S, nav);
for (let i = 0; i < 40; i++) rec.tick({ lat: 46 + i * 0.001, lon: 14, alt: 1000 + i, gs: 30, te: 0 }, true, i * 1000);
assert.ok(rec.cur.fixes.length >= 9 && rec.cur.fixes.length <= 11, 'recording interval 4 s: ' + rec.cur.fixes.length);
const done = rec.end({ thermals: 2 });
assert.ok(done && done.maxAlt === 1000 + 39 - (39 % 4) && done.thermals === 2);
assert.strictEqual(rec.flights.length, 1); assert.strictEqual(rec.cur, null);
const igc = rec.igc(done);
assert.ok(igc.includes('UNOFFICIAL') && igc.split('\r\n').filter(l => l[0] === 'B').length === done.fixes.length);
const st = LX.flightStats(done.fixes);
assert.ok(st.dist > 1000 && st.maxAlt === done.maxAlt && st.dur > 30);
console.log('optimizer + recorder tests passed');
