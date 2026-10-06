// Run: node tests/ai.test.js
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util };
['flight/geo.js', 'data/ai-traffic.js'].forEach(f => require('../js/' + f));
const { parseModels, alarmFor, relativeFromModels } = LX.aiTools;

const leaf = (name, value) => ({ name, value });
const tree = { name: 'models', children: [
  { name: 'aircraft', index: 0, children: [leaf('callsign', 'D-ABCD'), { name: 'position', children: [leaf('latitude-deg', 46.5), leaf('longitude-deg', 14.2), leaf('altitude-ft', 3280.84)] }, { name: 'orientation', children: [leaf('true-heading-deg', 90)] }, { name: 'velocities', children: [leaf('true-airspeed-kt', 100)] }] },
  { name: 'multiplayer', index: 1, children: [leaf('valid', false), { name: 'position', children: [leaf('latitude-deg', 46.6), leaf('longitude-deg', 14.3)] }] },
  { name: 'carrier', children: [{ name: 'position', children: [leaf('latitude-deg', 1), leaf('longitude-deg', 1)] }] },
  { name: 'aircraft', index: 2, children: [{ name: 'position', children: [leaf('latitude-deg', 'x')] }] },
] };
const m = parseModels(tree);
assert.strictEqual(m.length, 1, 'only valid aircraft/multiplayer with a numeric position: ' + JSON.stringify(m));
assert.strictEqual(m[0].id, 'D-ABCD'); assert.ok(Math.abs(m[0].alt - 1000) < 0.01); assert.ok(Math.abs(m[0].spd - 51.44) < 0.01); assert.strictEqual(m[0].hdg, 90);
assert.deepStrictEqual(parseModels({ name: 'models' }), []);

// collision alarms from time to closest approach (own: north 40 m/s)
const own = { e: 0, n: 40 };
assert.strictEqual(alarmFor({ e: 0, n: 600 }, own, { e: 0, n: -40 }), 3, 'head-on 7.5 s -> high');
assert.strictEqual(alarmFor({ e: 0, n: 880 }, own, { e: 0, n: -40 }), 2, '11 s -> medium');
assert.strictEqual(alarmFor({ e: 0, n: 1200 }, own, { e: 0, n: -40 }), 1, '15 s -> low');
assert.strictEqual(alarmFor({ e: 0, n: 2000 }, own, { e: 0, n: -40 }), 0, '25 s -> none');
assert.strictEqual(alarmFor({ e: 2000, n: 600 }, own, { e: 0, n: -40 }), 0, 'passes 2 km away -> none');
assert.strictEqual(alarmFor({ e: 0, n: 600 }, own, { e: 0, n: 40 }), 0, 'same speed same way -> none');
assert.strictEqual(alarmFor({ e: 0, n: -600 }, own, { e: 0, n: 40 }), 0, 'receding');

// relative frame: target 1 km due east of a glider heading north is at "3 o'clock" (e>0, n~0)
const f = { lat: 46, lon: 14, track: 0, gs: 40, alt: 1500 };
const east = LX.geo.dest(46, 14, 90, 1000);
const rel = relativeFromModels([{ id: 'E', lat: east.lat, lon: east.lon, alt: 1600, hdg: 270, spd: 0 }], f)[0];
assert.ok(Math.abs(rel.e - 1000) < 5 && Math.abs(rel.n) < 5 && Math.abs(rel.dh - 100) < 1e-9, 'relative position and height');
// same target, glider heading east: it is straight ahead (n>0, e~0)
const rel2 = relativeFromModels([{ id: 'E', lat: east.lat, lon: east.lon, alt: 1600, hdg: 270, spd: 0 }], Object.assign({}, f, { track: 90 }))[0];
assert.ok(Math.abs(rel2.n - 1000) < 5 && Math.abs(rel2.e) < 5, 'track-up rotation');
assert.strictEqual(relativeFromModels([{ id: 'far', lat: 50, lon: 14, alt: 0, hdg: 0, spd: 0 }], f).length, 0, '>20 km dropped');
// glider-only filter (FLARM is carried by gliders)
const G = LX.aiTools.isGlider;
assert.ok(G({ path: 'Aircraft/ASK21/Models/ask21.xml' }) && G({ path: '/sim/Aircraft/ls8/x.xml' }) && G({ id: 'Glider1' }));
assert.ok(!G({ path: 'Aircraft/c172p/Models/c172p.xml', id: 'N172' }) && !G({ path: 'Aircraft/737/x.xml' }));
assert.ok(G({ path: 'Aircraft/mything/x.xml' }, 'mything'), 'user keywords');
const mdl = [{ id: 'A', path: 'Aircraft/ask21/x.xml', lat: east.lat, lon: east.lon, alt: 1500, hdg: 0, spd: 0 }, { id: 'B', path: 'Aircraft/c172p/x.xml', lat: east.lat, lon: east.lon, alt: 1500, hdg: 0, spd: 0 }];
assert.strictEqual(relativeFromModels(mdl, f, { glidersOnly: true }).length, 1);
assert.strictEqual(relativeFromModels(mdl, f, { glidersOnly: false }).length, 2);
assert.ok(parseModels({ name: 'models', children: [{ name: 'aircraft', children: [leaf('callsign', 'X'), { name: 'sim', children: [{ name: 'model', children: [leaf('path', 'Aircraft/ASK21/m.xml')] }] }, { name: 'position', children: [leaf('latitude-deg', 1), leaf('longitude-deg', 1)] }] }] })[0].path.indexOf('ASK21') > 0);
console.log('ai tests passed');
