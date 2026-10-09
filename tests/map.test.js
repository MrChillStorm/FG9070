// Run: node tests/map.test.js   – flown-path colouring (manual 7.1.7.5); pure logic, no canvas needed
const assert = require('assert');
global.window = global;
global.LX = { util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) }, geo: {} };
require('../js/ui/map.js');
const col = (style, h, mc) => LX.Map.Renderer.prototype.pathColorFn.call(null, style, h, mc);
// history points: [lat, lon, alt, vario, groundspeed]
const h = [[0, 0, 1000, 3, 20], [0, 0, 1500, 1, 30], [0, 0, 2000, -1, 40], [0, 0, 1200, 0.2, 25]];
// Mc style: red above Mc+0.5, orange about Mc, blue below Mc-0.5, grey in sink
const mc = col('mc', h, 1);
assert.strictEqual(mc(h[0]), '#ff3b30');
assert.strictEqual(mc(h[1]), '#ff9a1f');
assert.strictEqual(mc(h[2]), '#8a8f99');
assert.strictEqual(mc(h[3]), '#2f7bff');
// vario style
const v = col('vario', h, 1);
assert.strictEqual(v(h[0]), '#ff3b30'); assert.strictEqual(v(h[2]), '#2f7bff');
// altitude: lowest red (hue 0), highest blue (hue 240)
const a = col('altitude', h, 1);
assert.strictEqual(a(h[0]), 'hsl(0,95%,50%)'); assert.strictEqual(a(h[2]), 'hsl(240,95%,50%)');
// ground speed: slowest red, fastest blue
const g = col('speed', h, 1);
assert.strictEqual(g(h[0]), 'hsl(0,95%,50%)'); assert.strictEqual(g(h[2]), 'hsl(240,95%,50%)');
// thermal mode colouring (7.1.7.6): auto span = red strongest lift ... blue weakest; average vario = above/below the mean
const as = col('autospan', h, 1);
assert.strictEqual(as(h[0]), 'hsl(0,95%,50%)'); assert.strictEqual(as(h[2]), 'hsl(240,95%,50%)');
const av = col('avgvario', [[0, 0, 0, 3, 0], [0, 0, 0, 1, 0], [0, 0, 0, -1, 0]], 1); // mean 1
assert.strictEqual(av([0, 0, 0, 3, 0]), '#ff3b30'); assert.strictEqual(av([0, 0, 0, 1, 0]), '#ff9a1f'); assert.strictEqual(av([0, 0, 0, -1, 0]), '#2f7bff');
// terrain colour schemes (7.1.7.1)
const S = LX.Map.SCHEMES;
assert.deepStrictEqual(S.mountain(0), LX.Map.ramp(0)); assert.deepStrictEqual(S.mountain(3200), LX.Map.ramp(1));
assert.deepStrictEqual(S.relative(2000, 1500).map(Math.round), [Math.round(255 + (220 - 255) * (500 / 600)), Math.round(170 + (40 - 170) * (500 / 600)), Math.round(60 + (30 - 60) * (500 / 600))], 'above the glider: orange -> red');
assert.deepStrictEqual(S.relative(1000, 1500), [246, 246, 246], 'reachable (below the glider): white');
assert.ok(S.grayscale(0)[0] < S.grayscale(3000)[0], 'grayscale gets lighter with height');
assert.deepStrictEqual(S.flatland2(100), [240, 240, 236], 'low ground is white in Flatland 2');
assert.strictEqual(Object.keys(LX.Map.SCHEME_NAMES).length, Object.keys(S).length, 'every scheme has a name');
console.log('map tests passed');
