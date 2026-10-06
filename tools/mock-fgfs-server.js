#!/usr/bin/env node
/**
 * Minimal stand-in for FlightGear's built-in HTTP server, for testing the
 * panel's polling path without the simulator:
 *
 *   node tools/mock-fgfs-server.js [port]        (default 5400)
 *
 * Serves GET /json/<property-path> -> { path, name, value, type } with CORS
 * enabled, like fgfs --httpd=PORT. Values swing around slowly so every
 * instrument moves. Properties not in the table return 404 (like a property
 * the aircraft does not have), which exercises the "property missing" chip.
 */
const http = require('http');
const port = parseInt(process.argv[2], 10) || 5400;
const t0 = Date.now();

const props = {
  '/velocities/airspeed-kt': (t) => 90 + 35 * Math.sin(t / 4),
  '/position/altitude-ft': (t) => 3500 + 600 * Math.sin(t / 7),
  '/accelerations/pilot-g': (t) => 1 + 3.5 * Math.sin(t / 3) * Math.abs(Math.sin(t / 9)),
  '/orientation/pitch-deg': (t) => 40 * Math.sin(t / 3),
  '/orientation/roll-deg': (t) => ((t * 40) % 360) - 180,
  '/orientation/heading-deg': (t) => (90 + t * 8) % 360,
  '/instrumentation/slip-skid-ball/indicated-slip-skid': (t) => 0.4 * Math.sin(t),
  '/velocities/vertical-speed-fps': (t) => 25 * Math.cos(t / 3),
  // '/environment/pressure-sea-level-inhg' intentionally omitted -> 404

  // extra properties used by the FG9070 trainer (fg9070/): a glider circling a thermal
  '/position/latitude-deg': (t) => 46.36 + 0.02 * Math.sin(t / 40),
  '/position/longitude-deg': (t) => 14.17 + 0.03 * Math.cos(t / 40),
  '/velocities/groundspeed-kt': (t) => 60 + 5 * Math.sin(t / 7),
  '/position/ground-elev-m': () => 400,
  '/environment/wind-from-heading-deg': () => 300,
  '/environment/wind-speed-kt': () => 10,
};

// FlightGear's /json/ai/models tree (shape as returned by the httpd with ?d=3): two aircraft near the mock glider
const aiTree = () => {
  const t = (Date.now() - t0) / 1000;
  const leaf = (name, value) => ({ path: '/x/' + name, name, index: 0, type: 'double', value });
  const model = (i, callsign, dlat, dlon, alt, hdg, spd, mpath) => ({ path: `/ai/models/aircraft[${i}]`, name: 'aircraft', index: i, type: 'none', children: [
    leaf('callsign', callsign), leaf('valid', true), { name: 'sim', children: [{ name: 'model', children: [leaf('path', mpath)] }] },
    { name: 'position', children: [leaf('latitude-deg', 46.36 + 0.02 * Math.sin(t / 40) + dlat), leaf('longitude-deg', 14.17 + 0.03 * Math.cos(t / 40) + dlon), leaf('altitude-ft', alt)] },
    { name: 'orientation', children: [leaf('true-heading-deg', hdg)] },
    { name: 'velocities', children: [leaf('true-airspeed-kt', spd)] },
  ] });
  return { path: '/ai/models', name: 'models', index: 0, type: 'none', children: [model(0, 'D-TEST', 0.01, 0.01, 4600, 225, 60, 'Aircraft/ASK21/Models/ask21.xml'), model(1, 'OE-FAR', 0.2, 0.2, 5000, 90, 80, 'Aircraft/c172p/Models/c172p.xml'), model(2, 'N172', 0.005, -0.01, 4700, 90, 90, 'Aircraft/c172p/Models/c172p.xml')] };
};

http
  .createServer((req, res) => {
    if (/^\/json\/ai\/models/.test(req.url)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(aiTree()));
    }
    const m = /^\/json(\/.*?)(\?.*)?$/.exec(req.url);
    const fn = m && props[m[1]];
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!fn) {
      res.statusCode = 404;
      return res.end('{}');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: m[1], name: m[1].split('/').pop(), type: 'double', value: fn((Date.now() - t0) / 1000) }));
  })
  .listen(port, () => console.log(`mock FlightGear httpd on :${port}`));
