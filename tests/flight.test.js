// Run: node tests/flight.test.js
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util };
['flight/polar.js', 'flight/te.js', 'flight/geo.js'].forEach((f) => require('../js/' + f));
const G = 9.80665;

// --- polar fit reproduces its input points
const p = LX.polar.make('ask21', 0, 0);
[[75, 0.65], [98, 0.80], [150, 1.75]].forEach(([kmh, w]) => {
  assert.ok(Math.abs(p.sink(kmh / 3.6) - w) < 0.01, `sink at ${kmh}`);
});
const ch = LX.polar.characteristics(p);
assert.ok(ch.bestLD.ld > 25 && ch.bestLD.ld < 45, 'best L/D plausible: ' + ch.bestLD.ld);
// ballast raises best-glide speed, bugs lower performance
const pb = LX.polar.make('club15', 100, 0), p0 = LX.polar.make('club15', 0, 0);
assert.ok(LX.polar.characteristics(pb).bestLD.v > LX.polar.characteristics(p0).bestLD.v);
assert.ok(LX.polar.make('ask21', 0, 10).sink(27) > p.sink(27));

// --- TE: pure speed<->height exchange (no air movement) must read ~0
const te = new LX.TEVario();
let v = 40, h = 1000, t = 0;
let last;
for (let i = 0; i < 400; i++) {
  const dt = 0.05;
  // zoom up: decelerate 40 -> 25 m/s trading speed for height, then dive back
  const dvdt = i < 200 ? -1.5 : 1.5;
  const vs = -(v / G) * dvdt; // energy conserved: dh/dt = -(v/g) dv/dt
  v += dvdt * dt; h += vs * dt; t += dt * 1000;
  last = te.update(t, vs, v, 0.7, 1.5, 1);
  if (i > 40 && i !== 200) assert.ok(Math.abs(last.raw) < 0.15, `TE raw ~0 during exchange (i=${i}, ${last.raw.toFixed(3)})`);
}
// without compensation the raw vario would show the climb
const te0 = new LX.TEVario();
v = 40; t = 0; let r0;
for (let i = 0; i < 100; i++) { const dvdt = -1.5; const vs = -(v / G) * dvdt; v += dvdt * 0.05; t += 50; r0 = te0.update(t, vs, v, 0.7, 1.5, 0); }
assert.ok(r0.raw > 4, 'uncompensated raw shows big false climb: ' + r0.raw);

// --- netto: still air at polar sink reads ~0
const tn = new LX.TEVario(); let n;
for (let i = 0; i < 400; i++) n = tn.update(i * 50, -p.sink(27), 27, p.sink(27), 1, 1);
assert.ok(Math.abs(n.netto) < 0.05, 'netto 0 in still air');

// --- speed to fly
const s0 = LX.polar.speedToFly(p, 0, 0, 0);
const s2 = LX.polar.speedToFly(p, 2, 0, 0);
assert.ok(s2 > s0, 'higher MC => faster');
assert.ok(Math.abs(s0 - ch.bestLD.v) < 1.5, 'MC 0 ~ best glide speed');
assert.ok(LX.polar.speedToFly(p, 1, 0, 8) > LX.polar.speedToFly(p, 1, 0, 0), 'headwind => faster');
assert.ok(LX.polar.speedToFly(p, 1, -2, 0) > LX.polar.speedToFly(p, 1, 0, 0), 'sink => faster');
assert.ok(LX.polar.speedToFly(p, 1, 2, 0) < LX.polar.speedToFly(p, 1, 0, 0), 'lift => slower');

// --- final glide: more distance => less arrival height; headwind hurts
const fg = (d, hw) => LX.polar.finalGlide(p, { mc: 0, dist: d, headwind: hw, alt: 2000, targetElev: 300, safety: 100 });
assert.ok(fg(20000, 0).arrivalHeight > fg(40000, 0).arrivalHeight);
assert.ok(fg(30000, 0).arrivalHeight > fg(30000, 8).arrivalHeight);
// 30 km at ~L/D 34 needs ~880 m: 1600 m usable - ~880 ~ +700
const a = fg(30000, 0).arrivalHeight;
assert.ok(a > 400 && a < 1000, 'arrival plausible ' + a);

// --- geodesy
const d = LX.geo.dist(46, 14, 46, 15);
assert.ok(Math.abs(d - 77.9e3) < 1.5e3, 'one degree of lon at 46N ~78 km: ' + d);
assert.ok(Math.abs(LX.geo.bearing(46, 14, 47, 14)) < 0.01);
console.log('flight tests passed');

// "Thermal shows the last thermal average" (manual 7.4/5.x): the last finished thermal, not a mean of four
{
  require('../js/flight/state.js');
  const lt = LX.Flight.prototype.lastThermalAvg;
  assert.strictEqual(lt.call({ thermals: [] }), null);
  assert.strictEqual(lt.call({ thermals: [{ avg: 1 }, { avg: 3 }, { avg: 2.4 }] }), 2.4);
}

// Netto filter time constant (manual 7.1.4): a larger constant reacts more slowly
{
  const run = (nettoTau) => {
    const t = new LX.TEVario(); let ms = 0, o;
    for (let i = 0; i < 20; i++) { o = t.update(ms, 0, 30, 0.7, 1.5, 1, nettoTau); ms += 100; }       // still air: netto ~ 0.7
    for (let i = 0; i < 10; i++) { o = t.update(ms, 2, 30, 0.7, 1.5, 1, nettoTau); ms += 100; }       // step into lift for 1 s
    return o.netto;
  };
  assert.ok(run(0.2) > run(5), 'short netto filter follows a step faster than a long one');
  assert.strictEqual(typeof new LX.TEVario().update(0, 0, 30, 0.7, 1.5, 1).raw, 'number', 'old call form still works');
}
