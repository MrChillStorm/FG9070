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
console.log('map tests passed');
