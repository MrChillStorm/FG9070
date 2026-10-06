// Run: node tests/task.test.js
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util, units: { speed: v => v * 3.6, alt: v => v, label: () => 'x' } };
['flight/geo.js', 'nav/nav.js', 'nav/task.js'].forEach(f => require('../js/' + f));
const geo = LX.geo;

const nav = new LX.Nav(); nav.makeDemo(46, 14); LX.TaskTools.normalise(nav);
const run = new LX.TaskRunner(nav);
const T = nav.task;
assert.deepStrictEqual(T.map(p => p.kind), ['start', 'tp', 'tp', 'finish']);
assert.ok(T[0].zone.line && !T[1].zone.line);

// zone geometry: cylinder inside/outside
const tp1 = T[1].wp;
assert.ok(LX.TaskTools.inZone(T, 1, { lat: tp1.lat, lon: tp1.lon }));
const out = geo.dest(tp1.lat, tp1.lon, 10, 800);
assert.ok(!LX.TaskTools.inZone(T, 1, out));
// FAI sector (45 deg) pointing away from legs
T[1].zone.a1 = 90;
const axis = LX.TaskTools.zoneBearing(T, 1);
const inSec = geo.dest(tp1.lat, tp1.lon, axis, 300), outSec = geo.dest(tp1.lat, tp1.lon, axis + 180, 300);
assert.ok(LX.TaskTools.inZone(T, 1, inSec) && !LX.TaskTools.inZone(T, 1, outSec), 'sector is directional');
T[1].zone.a1 = 180;

// fly start->TP1 along the leg, from 600 m before the start line
const legB = geo.bearing(T[0].wp.lat, T[0].wp.lon, tp1.lat, tp1.lon);
const f = { lat: 0, lon: 0, alt: 1500, gs: 30 };
const fly = (from, brg, step, n, t0, cb) => { let p = from; const msgs = []; for (let i = 0; i < n; i++) { p = geo.dest(p.lat, p.lon, brg, step); f.lat = p.lat; f.lon = p.lon; msgs.push(...run.update(f, t0 + i * 1000)); if (cb) cb(); } return { p, msgs }; };
let r = fly(geo.dest(T[0].wp.lat, T[0].wp.lon, legB + 180, 600), legB, 100, 12, 0);
assert.ok(r.msgs.some(m => m.id === 'start?'), 'crossing the start line prompts: ' + JSON.stringify(r.msgs.map(m => m.id)));
assert.ok(!nav.started, 'not started until START pressed');
run.start(f, 20000);
assert.ok(nav.started && nav.active === 1, 'START advances to TP1');
assert.strictEqual(run.prefix(), 'T');

// reach TP1 -> auto next
r = fly(r.p, geo.bearing(r.p.lat, r.p.lon, tp1.lat, tp1.lon), 200, 200, 30000);
assert.ok(r.msgs.some(m => m.text === 'Inside zone') && nav.active === 2, 'auto next to TP2, active=' + nav.active);

// auto-next off -> prompts NEXT instead of advancing
nav.active = 1; T[1].zone.autoNext = false; run.msgSent = {};
const pin = { lat: tp1.lat, lon: tp1.lon }; f.lat = pin.lat; f.lon = pin.lon;
const m2 = run.update(f, 40000);
assert.ok(m2.some(m => m.id === 'next?') && nav.active === 1, 'no auto advance without Auto next');
T[1].zone.autoNext = true; nav.active = 3;

// finish line (forward) -> finished
const fin = T[3];
const finB = LX.TaskTools.zoneBearing(T, 3);
run.prev = null;
r = fly(geo.dest(fin.wp.lat, fin.wp.lon, finB + 180, 500), finB, 100, 12, 50000);
assert.ok(nav.finished && r.msgs.some(m => m.id === 'finished'), 'finish line crossing finishes');

// ARM: crossing a start line while armed starts automatically
run.reset(); run.arm();
r = fly(geo.dest(T[0].wp.lat, T[0].wp.lon, legB + 180, 600), legB, 100, 12, 0);
assert.ok(nav.started && r.msgs.some(m => m.id === 'started'), 'armed start is automatic');

// start altitude limit gives A and a warning on a high start
run.reset(); nav.options.startAlt = 1200; assert.strictEqual(run.prefix(), 'A');
nav.options.startGsp = 30; assert.strictEqual(run.prefix(), 'AG');
const msgs = run.start({ alt: 1500, gs: 35 }, 0);
assert.ok(msgs.some(m => m.id === 'warn'), 'high/fast start warns');
nav.options.startAlt = 0; nav.options.startGsp = 0;

// PEV event procedure: wait then window
run.reset(); nav.options.eventWait = 300; nav.options.eventWindow = 300;
run.event(0);
assert.strictEqual(run.eventState(10000).phase, 'wait');
assert.strictEqual(run.eventState(310000).phase, 'open');
assert.strictEqual(run.eventState(700000).phase, 'closed');
run.event(15000); assert.strictEqual(run.events.length, 1, 'events within 30 s are one event');

// distances: remaining decreases along the task
run.reset(); nav.active = 1;
const total = LX.TaskTools.distance(nav);
assert.ok(total > 90000 && total < 140000, 'task length ' + total);
assert.ok(LX.TaskTools.remaining(nav, { lat: T[1].wp.lat, lon: T[1].wp.lon }) < total);
// AAT: moving the target inside the area changes the navigation target and the distance
run.reset(); nav.active = 1;
T[1].zone.aat = true; T[1].zone.r1 = 10000;
const before = LX.TaskTools.distance(nav);
T[1].target = { dist: 8000, brg: LX.TaskTools.zoneBearing(T, 1) };
const after = LX.TaskTools.distance(nav);
assert.ok(Math.abs(after - before) > 1000, 'moved AAT target changes task distance');
const tg = nav.target('tsk');
assert.ok(/\*$/.test(tg.name) && geo.dist(tg.lat, tg.lon, T[1].wp.lat, T[1].wp.lon) > 7900, 'navigation target follows the move');
T[1].target = { dist: 99999, brg: 0 };   // clamped to the area radius
const q = LX.TaskTools.pointPos(T[1]);
assert.ok(geo.dist(q.lat, q.lon, T[1].wp.lat, T[1].wp.lon) <= 10001, 'target stays inside the area');
// start gate: opens at a time of day, then for one minute every interval
{
  const n2 = new LX.Nav(); n2.makeDemo(46, 14); LX.TaskTools.normalise(n2);
  const r2 = new LX.TaskRunner(n2);
  assert.strictEqual(r2.gate(Date.now()), null, 'no gating configured');
  const base = new Date(); base.setHours(12, 0, 0, 0); const t0 = base.getTime();
  n2.options.startOpen = 12 * 60; n2.options.gateInterval = 15;
  assert.ok(!r2.gate(t0 - 60000).open && Math.abs(r2.gate(t0 - 60000).opensIn - 60) < 0.01, 'before the first gate');
  assert.ok(r2.gate(t0 + 30000).open && Math.abs(r2.gate(t0 + 30000).closesIn - 30) < 0.01, 'first gate open for a minute');
  assert.ok(!r2.gate(t0 + 90000).open && Math.abs(r2.gate(t0 + 90000).opensIn - 13 * 60 - 30) < 0.01, 'closed until the next gate');
  assert.ok(r2.gate(t0 + 15 * 60000 + 10000).open, 'second gate');
  n2.options.gateInterval = 0;
  assert.ok(r2.gate(t0 + 3 * 3600000).open && r2.gate(t0 + 1).closesIn === Infinity, 'no interval: open after the opening time');
}
console.log('task tests passed');
