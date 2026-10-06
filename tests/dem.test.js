// Run: node tests/dem.test.js   (decode, tile maths, terrain clearance with a stubbed elevation model)
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util };
['flight/geo.js', 'nav/dem.js'].forEach(f => require('../js/' + f));
const { decodeRGBA, zoomFor, tileX, tileY } = LX.demTools;

// Terrarium decoding: elevation = R*256 + G + B/256 - 32768
const px = (m) => { const v = m + 32768; return [Math.floor(v / 256), Math.floor(v) % 256, Math.floor((v - Math.floor(v)) * 256), 255]; };
const data = new Uint8ClampedArray(256 * 256 * 4);
[0, 1234.5, -50.25, 4807.75].forEach((m, i) => data.set(px(m), i * 4));
const out = decodeRGBA(data);
[0, 1234.5, -50.25, 4807.75].forEach((m, i) => assert.ok(Math.abs(out[i] - m) < 0.01, `decode ${m}: ${out[i]}`));

// tile maths: lon -180 -> x 0, lon 180 -> x n; equator -> y n/2
assert.strictEqual(tileX(-180, 1024), 0); assert.ok(Math.abs(tileX(0, 1024) - 512) < 1e-9);
assert.ok(Math.abs(tileY(0, 1024) - 512) < 1e-6);
assert.ok(zoomFor(46, 100) === 10 && zoomFor(46, 2000) < zoomFor(46, 100), 'coarser pixels -> lower zoom');

// bilinear sampling + clearance against a synthetic height field (a 2 km ridge 12 km out)
const dem = new LX.DEM({ get: () => ({ terrain: 'terrarium' }) });
const geo = LX.geo;
const f = { lat: 46, lon: 14, alt: 1800 };
const ridge = (lat, lon) => { const d = geo.dist(46, 14, lat, lon); return 500 + (d > 11000 && d < 13000 ? 1500 : 0); };
dem.elevation = (lat, lon) => ridge(lat, lon);
const nav = { dist: 30000, bearing: 90, Emc: 30 };
const c = dem.clearance(f, nav, 100, geo);
// path at 12 km: 1800 - 12000/30 = 1400 m; terrain 2000 + 100 safety => need ~700 m
assert.ok(c && c.climb > 600 && c.climb < 800, 'climb needed over the ridge: ' + (c && c.climb));
assert.ok(c.dist > 11000 && c.dist < 13000, 'collision point on the ridge');
assert.strictEqual(dem.clearance(Object.assign({}, f, { alt: 3500 }), nav, 100, geo), null, 'clear when high');
assert.strictEqual(dem.clearance(f, Object.assign({}, nav, { Emc: Infinity }), 100, geo), null, 'no glide ratio -> no check');
assert.strictEqual(dem.clearance(f, { dist: 800, bearing: 90, Emc: 30 }, 100, geo), null, 'target close by -> no check');
// unknown terrain (tiles not loaded) must not produce false alarms
dem.elevation = () => undefined;
assert.strictEqual(dem.clearance(f, nav, 100, geo), null, 'missing tiles -> null');
console.log('dem tests passed');
