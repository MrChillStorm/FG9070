// Run: node tests/demo.test.js  – flies the demo for simulated minutes through the real Flight engine
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util, units: { speed: v => v * 3.6, alt: v => v, label: () => 'x' } };
global.localStorage = { getItem: () => null, setItem() {} };
['flight/geo.js','flight/polar.js','flight/te.js','nav/nav.js','nav/task.js','flight/state.js','data/demo-xc.js'].forEach(f => require('../js/'+f));
let now = 0; global.performance = { now: () => now };
const timers = []; global.setInterval = (fn) => { timers.push(fn); return 1; }; global.clearInterval = () => {};
const S = { get: () => ({ teSource:'ias', teComp:100, needleTau:1.5, soundTau:1.5, integrator:20, nettoTime:20, autoSC:'GPS', mc:1.5, mcOffset:0, safetyAlt:100, glider:'ask21', ballast:0, bugs:0, autoResetIntegrator:false }) };
const nav = new LX.Nav(); const fl = new LX.Flight(S); const run = new LX.TaskRunner(nav);
const src = new LX.DemoXC({ nav, onStatus(){}, onValues(v){ fl.ingest(v, now); for (const m of run.update(fl.f, now)) { if (m.id === 'start?') run.start(fl.f, now); if (m.id === 'finished') run.restart(); } } });
src.start();
let circ=0, climbs=[], maxTeErr=0, minH=1e9, maxH=0, lastMode='', modeChanges=0, tp=0, lastAct=nav.active;
const T=40*60;
for (let i=0;i<T*20;i++) {
  now += 50; timers[0]();
  const f = fl.f; if (!fl.have) continue;
  fl.setTarget(nav.target('tsk'));
  if (f.circling) circ++;
  minH=Math.min(minH,f.alt); maxH=Math.max(maxH,f.alt);
  if (f.mode!==lastMode){modeChanges++;lastMode=f.mode;}
  if (nav.active!==lastAct){tp++;lastAct=nav.active;}
}
console.log('sim minutes', T/60, '| circling share', (circ/(T*20)*100).toFixed(0)+'%', '| thermals', fl.thermals.length, '| mode changes', modeChanges, '| task points reached', tp);
console.log('alt range m', minH.toFixed(0), maxH.toFixed(0));
console.log('thermal avgs', fl.thermals.map(t=>t.avg.toFixed(1)).join(' '));
console.log('flight time', (fl.f.flightTime/60).toFixed(1),'min  final f.nav arrival', fl.f.nav && fl.f.nav.arrival.toFixed(0), 'reqE', fl.f.nav && fl.f.nav.reqE.toFixed(1));
const bad = [];
if (minH < 150) bad.push('landed out');
if (!fl.thermals.length) bad.push('no thermals detected');
if (tp < 1) bad.push('task not progressing');
if (bad.length) { console.log('PROBLEMS:', bad.join(', ')); process.exit(1); }
console.log('demo OK');
