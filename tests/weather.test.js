// Run: node tests/weather.test.js  – weather layer logic (no network)
const assert = require('assert');
global.window = global;
global.LX = {};
require('../js/nav/weather.js');
const W = LX.Weather;

// web-mercator bbox of a tile: whole world at z0, a quadrant at z1
const bb = (z, x, y) => W.tileBBox(z, x, y).split(',').map(Number);
assert.ok(Math.abs(bb(0, 0, 0)[0] + 20037508.343) < 1 && Math.abs(bb(0, 0, 0)[3] - 20037508.343) < 1);
const q = bb(1, 1, 0); // north-east quadrant
assert.ok(Math.abs(q[0]) < 1 && Math.abs(q[1]) < 1 && Math.abs(q[2] - 20037508.343) < 1 && Math.abs(q[3] - 20037508.343) < 1);

// forecast colours
assert.ok(W.fcColor('cloud_cover', 100)[3] > W.fcColor('cloud_cover', 10)[3], 'more cloud = more opaque');
assert.strictEqual(W.fcColor('precipitation', 0)[3], 0, 'no rain = invisible');
const lo = W.fcColor('cape', 0), hi = W.fcColor('cape', 3000);
assert.ok(hi[0] > lo[0] && hi[2] < lo[2], 'CAPE goes blue -> red');

// rain frame choice: history span 0 = newest, otherwise a loop with the newest held for "freeze"
const wx = new W({ get: () => ({}) });
wx.rain = { host: 'h', frames: [0, 1, 2, 3].map((i) => ({ time: 1000 + i * 600, path: '/p' + i })), fetched: 0 };
assert.strictEqual(wx.rainFrame(5000, { wxRainHistory: 0 }).path, '/p3');
const seen = new Set(); for (let t = 0; t < 4 * 600 + 3000; t += 100) seen.add(wx.rainFrame(t, { wxRainHistory: 30, wxRainFreeze: 3 }).path);
assert.ok(seen.has('/p0') && seen.has('/p3'), 'the loop covers the 30 minute span');
assert.strictEqual(wx.rainFrame(4 * 600 + 100, { wxRainHistory: 30, wxRainFreeze: 3 }).path, '/p3', 'newest frame is held during the freeze time');

// satellite layer choice: the chosen one, else natural colour / IR 10.8 / HRV / first
wx.satLayers = ['msg_fes:hrv', 'msg_fes:ir108', 'msg_fes:rgb_naturalenhncd', 'mtg_fd:vis'];
assert.strictEqual(wx.satLayerName({}), 'msg_fes:rgb_naturalenhncd');
assert.strictEqual(wx.satLayerName({ wxSatLayer: 'mtg_fd:vis' }), 'mtg_fd:vis');
wx.satLayers = ['msg_fes:ir039', 'msg_fes:hrv'];
assert.strictEqual(wx.satLayerName({}), 'msg_fes:hrv');

// layers(): nothing enabled -> nothing; minimum zoom distance hides them when zoomed in
const vp = { rect: { w: 800, h: 480 }, mpp: 100, box: { lat0: 46, lat1: 47, lon0: 14, lon1: 15 } };
assert.deepStrictEqual(wx.layers(vp, {}).rasters, []);
wx.rain = { host: 'https://t', frames: [{ time: 1, path: '/v2/radar/x' }], fetched: Date.now() };
const on = wx.layers(vp, { wxRain: true, wxRainOpacity: 50 });
assert.strictEqual(on.rasters.length, 1);
assert.strictEqual(on.rasters[0].urlFor(5, 17, 11), 'https://t/v2/radar/x/256/5/17/11/2/1_1.png');
assert.deepStrictEqual(on.attr, ['Weather data by RainViewer']);
assert.deepStrictEqual(wx.layers(vp, { wxRain: true, wxMinZoom: 500 }).rasters, [], 'zoomed in closer than the minimum: hidden');
console.log('weather tests passed');
