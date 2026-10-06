global.window = global; global.LX = {};
require('../js/nav/sun.js');
const assert = require('assert');
// Ljubljana 46.05N 14.5E on 2026-06-21: rise ~03:11Z, set ~18:57Z
const s = LX.sun.times(46.05, 14.5, new Date('2026-06-21T12:00:00Z'));
const m = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
assert(Math.abs(m(s.rise) - (3 * 60 + 11)) <= 4, LX.sun.fmt(s.rise));
assert(Math.abs(m(s.set) - (18 * 60 + 57)) <= 4, LX.sun.fmt(s.set));
assert.strictEqual(LX.sun.times(80, 0, new Date('2026-12-21T12:00:00Z')), null);
console.log('sun tests passed');
