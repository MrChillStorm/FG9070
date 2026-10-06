// Run: node tests/audio.test.js   (pure logic; no browser or audio needed)
const assert = require('assert');
global.window = global;
global.LX = { util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } };
require('../js/audio/vario-audio.js');
const T = LX.audioTone;
const p = { f0: 500, fPlus: 1500, fMinus: 200 };
const lp = { kind: 'positive' }, ln = { kind: 'negative' }, lpo = { kind: 'positive-only' }, lin = { kind: 'linear' };
const dig = { kind: 'positive', digital: true };

// frequency map from the manual defaults
assert.strictEqual(Math.round(T(lin, 1, p).freq), 1500);
assert.strictEqual(Math.round(T(lin, -1, p).freq), 200);
assert.strictEqual(Math.round(T(lin, 0.5, p).freq), 1000);
assert.strictEqual(Math.round(T(lin, -0.5, p).freq), 350);

// Linear positive: beeps above zero, continuous below
assert.ok(T(lp, 0.4, p).beeping && !T(lp, 0.4, p).silent);
assert.ok(!T(lp, -0.4, p).beeping && !T(lp, -0.4, p).silent);
// Linear negative is the inverse
assert.ok(T(ln, -0.4, p).beeping && !T(ln, 0.4, p).beeping);
// positive-only: silent in sink
assert.ok(T(lpo, -0.6, p).silent && !T(lpo, 0.6, p).silent);
// dead centre is silent
assert.ok(T(lp, 0, p).silent);
// beep rate rises with lift
assert.ok(T(lp, 0.9, p).period < T(lp, 0.2, p).period);
// digital steps: nearby values give identical frequency
assert.strictEqual(T(dig, 0.41, p).freq, T(dig, 0.44, p).freq);
assert.notStrictEqual(T(dig, 0.41, p).freq, T(dig, 0.61, p).freq);
console.log('audio tone tests passed');

// confirmation alarm (manual 7.1.8.3): needs an unlocked audio context, then plays three beeps
{
  const set = { get: () => ({ alarmPeriod: 0.4 }) };
  const a = new LX.VarioAudio(set);
  a.playAlarm();
  assert.ok(!a.alarmBeepUntil, 'no alarm before audio is unlocked');
  a.ctx = {};
  const t0 = performance.now();
  a.playAlarm();
  assert.ok(Math.abs(a.alarmBeepUntil - t0 - 1200) < 50, 'three beeps of 0.4 s');
}
