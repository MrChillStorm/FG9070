// Run: node tests/warnings.test.js
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util };
['flight/geo.js', 'nav/nav.js', 'nav/warnings.js'].forEach(f => require('../js/' + f));
const geo = LX.geo;
const cfg = { warnAirspace: true, warnTime: 30, warnHorz: 1000, warnVert: 100, warnAlt: true, warnAltValue: 3000, warnAltTime: 20, warnAltDir: 'above',
  timeAlarm1: 10, timeAlarm2: 0, timeAlarm3: 0, warnWpt: 2000, flarmWarn: 'Medium' };
const S = { get: () => cfg };
const nav = new LX.Nav();
const W = new LX.Warnings(S, nav);

// zone: circle r=3 km at (46,14), 0..1500 m MSL
nav.airspaces = [{ name: 'CTR', cls: 'D', lower: 0, upper: 1500, circle: { lat: 46, lon: 14, r: 3000 } }];
const at = (brg, d, alt, trk, gs, vs) => { const p = geo.dest(46, 14, brg, d); return { lat: p.lat, lon: p.lon, alt, track: trk, gs, vs: vs || 0 }; };
// 6 km south of the centre flying north at 40 m/s (30 s => 1200 m ahead): projected end 4.8 km away: no warning
let f = at(180, 6000, 1000, 0, 40);
assert.strictEqual(W.activeAirspace(f, 0).length, 0, 'far away: nothing');
// 4.1 km south, 1200 m ahead -> projected 2.9 km: crosses the circle (r 3 km) but not in buffer (1.1 km outside) => orange
f = at(180, 4100, 1000, 0, 40);
let w = W.activeAirspace(f, 0);
assert.strictEqual(w.length, 1); assert.strictEqual(w[0].level, 'orange', 'projected crossing = orange');
// 3.5 km south: 500 m outside the boundary => in the 1 km buffer and crossing => red
f = at(180, 3500, 1000, 0, 40);
assert.strictEqual(W.activeAirspace(f, 0)[0].level, 'red', 'projected crossing + in buffer = red');
// heading away: no crossing -> no warning even though inside the buffer
f = at(180, 3500, 1000, 180, 40);
assert.strictEqual(W.activeAirspace(f, 0).length, 0, 'moving away: no warning');
// vertically clear (500 m above the top) -> no warning
f = at(180, 3500, 2000, 0, 40);
assert.strictEqual(W.activeAirspace(f, 0).length, 0, 'above the zone: no warning');
// 60 m above the top: inside the vertical buffer, projected crossing horizontally but vertical overlap needs descending
f = at(180, 3500, 1560, 0, 40, -3);
assert.strictEqual(W.activeAirspace(f, 0)[0].level, 'red', 'descending into a zone within the vertical buffer');
// inside the zone: red
f = at(0, 500, 1000, 90, 30);
assert.strictEqual(W.activeAirspace(f, 0)[0].level, 'red'); assert.strictEqual(W.activeAirspace(f, 0)[0].inside, true);

// dismiss: orange dismissed for 5 min is hidden, but escalation to red re-raises it
f = at(180, 4100, 1000, 0, 40);
W.dismiss(nav.airspaces[0], 5, 1000, 'orange');
assert.strictEqual(W.activeAirspace(f, 2000).length, 0, 'dismissed');
assert.strictEqual(W.airspace(f, 2000)[0].dismissed, true);
f = at(180, 3500, 1000, 0, 40);
assert.strictEqual(W.activeAirspace(f, 2000)[0].level, 'red', 'escalation overrides the dismissal');
assert.strictEqual(W.activeAirspace(f, 1000 + 5 * 60000 + 1)[0].level, 'red', 'dismissal expired');

// polygon zone
nav.airspaces = [{ name: 'TMA', cls: 'C', lower: 1000, upper: 5000, poly: [[46.1, 14], [46.1, 14.3], [46.3, 14.3], [46.3, 14]] }];
f = { lat: 46.05, lon: 14.15, alt: 2000, track: 0, gs: 40, vs: 0 }; // 5.5 km south of the southern edge, heading north
assert.strictEqual(W.activeAirspace(f, 0).length, 0);
f = { lat: 46.09, lon: 14.15, alt: 2000, track: 0, gs: 40, vs: 0 }; // ~1.1 km south: projected 1.2 km crosses; outside the buffer? 1.1 km > 1 km
const pw = W.activeAirspace(f, 0);
assert.ok(pw.length === 1 && pw[0].level === 'orange', 'polygon crossing orange: ' + JSON.stringify(pw.map(x => x.level)));
f = { lat: 46.1, lon: 14.15, alt: 2000, track: 0, gs: 40, vs: 0 }; // on the edge
assert.ok(W.activeAirspace(f, 0).some(x => x.level === 'red'));

// altitude warning: approaching 3000 m from below climbing 5 m/s -> projected 100 m above the limit
W.vsHist = [];
let alt = null;
for (let t = 0; t < 21000; t += 1000) alt = W.altitude({ alt: 2920, vs: 5 }, t);
assert.ok(alt && alt.dir === 'above', 'altitude warning when approaching from below');
W.dismissAltitude(1, 21000);
assert.strictEqual(W.altitude({ alt: 2920, vs: 5 }, 22000), null, 'dismissed for a minute');
assert.ok(W.altitude({ alt: 2920, vs: 5 }, 22000 + 60000), 'returns after the dismissal');
assert.strictEqual(W.altitude({ alt: 3100, vs: 5 }, 100000), null, 'already above: no warning');

// time alarm every 10 min of flight time
assert.deepStrictEqual(W.timeAlarms(500), []);
assert.deepStrictEqual(W.timeAlarms(601), [0]);
assert.deepStrictEqual(W.timeAlarms(700), []);
assert.deepStrictEqual(W.timeAlarms(1201), [0]);

// waypoint warning
assert.strictEqual(W.waypoint({ dist: 5000, target: { name: 'TP1' } }), null);
assert.strictEqual(W.waypoint({ dist: 1500, target: { name: 'TP1' } }), 'TP1');
assert.strictEqual(W.waypoint({ dist: 1400, target: { name: 'TP1' } }), null, 'fires once');

// FLARM: Medium shows alarm>=1 only; clock position relative to the nose (track-up e/n)
const tg = [{ id: 'A', dist: 3000, alarm: 0, e: 0, n: 3000 }, { id: 'B', dist: 1500, alarm: 2, e: 1500, n: 0 }, { id: 'C', dist: 900, alarm: 3, e: 0, n: -900 }];
let fl = W.flarm(tg);
assert.strictEqual(fl.target.id, 'C'); assert.strictEqual(fl.clock, 6, 'behind = 6 o\'clock');
cfg.flarmWarn = 'High'; assert.strictEqual(W.flarm(tg.slice(0, 2)), null, 'High ignores medium alerts');
cfg.flarmWarn = 'No alarm'; assert.strictEqual(W.flarm(tg), null);
console.log('warnings tests passed');
