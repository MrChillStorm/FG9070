/**
 * FlightGear properties read by the FG9070 simulator.
 * `rate`: 'fast' every poll cycle, 'slow' every ~25th cycle.
 * `optional`: aircraft may legitimately lack it (panel derives a fallback);
 * a missing optional property is NOT reported as a problem.
 *
 * FlightGear-native units are converted to SI in flight-state.js.
 */
(function (global) {
  'use strict';
  const LX = global.LX;

  LX.PROPS = [
    { key: 'lat',   path: '/position/latitude-deg',                              rate: 'fast' },
    { key: 'lon',   path: '/position/longitude-deg',                             rate: 'fast' },
    { key: 'alt',   path: '/position/altitude-ft',                               rate: 'fast' },   // MSL, ft
    { key: 'ias',   path: '/velocities/airspeed-kt',                             rate: 'fast' },   // kt
    { key: 'tas',   path: '/instrumentation/airspeed-indicator/true-speed-kt',   rate: 'fast', optional: true },
    { key: 'gs',    path: '/velocities/groundspeed-kt',                          rate: 'fast', optional: true },
    { key: 'gelev', path: '/position/ground-elev-m',                           rate: 'fast', optional: true },
    { key: 'vs',    path: '/velocities/vertical-speed-fps',                      rate: 'fast' },   // ft/s
    { key: 'hdg',   path: '/orientation/heading-deg',                            rate: 'fast' },
    { key: 'pitch', path: '/orientation/pitch-deg',                              rate: 'fast' },
    { key: 'roll',  path: '/orientation/roll-deg',                               rate: 'fast' },
    { key: 'wdir',  path: '/environment/wind-from-heading-deg',                  rate: 'slow', optional: true },
    { key: 'wspd',  path: '/environment/wind-speed-kt',                          rate: 'slow', optional: true },
    { key: 'magvar', path: '/environment/magnetic-variation-deg',                rate: 'slow', optional: true },   // east positive
    { key: 'qnh',   path: '/environment/pressure-sea-level-inhg',                rate: 'slow', optional: true },
  ];
})(window);
