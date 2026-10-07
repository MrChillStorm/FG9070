// Run: node tests/files.test.js  – parsers against small hand-written fixtures (formats per their public specs)
const assert = require('assert');
global.window = global;
require('../js/shared/util.js');
global.LX = { util: AeroPanel.util };
['flight/geo.js', 'nav/nav.js', 'nav/files.js'].forEach(f => require('../js/' + f));
const F = LX.Files;

// ---- CUP
const cup = `name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc
"Lesce Bled","LJBL","SI",4620.100N,01410.000E,504.0m,4,,,"123.500","Glider site, with comma"
"Turn 1","T1","",4630.500N,01420.250E,1640ft,1,,,,
"Lake Field","LAKE","AT",4638.000S,01308.500W,400.0m,3,,,,
-----Related Tasks-----
"Triangle 100","Lesce Bled","Turn 1","Lake Field","Lesce Bled"
Options,NoStart=10:00:00,TaskTime=03:30:00
ObsZone=0,Style=2,R1=1000m,Line=1
ObsZone=1,Style=1,R1=0.5km,A1=180
`;
const c = F.parseCUP(cup);
assert.strictEqual(c.waypoints.length, 3);
assert.ok(Math.abs(c.waypoints[0].lat - (46 + 20.1 / 60)) < 1e-9 && Math.abs(c.waypoints[0].lon - (14 + 10 / 60)) < 1e-9, 'DDMM.mmm parsing');
assert.strictEqual(c.waypoints[0].type, 'glider');
assert.strictEqual(c.waypoints[0].desc, 'Glider site, with comma', 'quoted comma kept');
assert.ok(Math.abs(c.waypoints[1].elev - 1640 * 0.3048) < 0.01, 'feet -> metres');
assert.ok(c.waypoints[2].lat < 0 && c.waypoints[2].lon < 0, 'S/W signs');
assert.strictEqual(c.waypoints[2].type, 'field');
assert.strictEqual(c.tasks.length, 1);
assert.deepStrictEqual(c.tasks[0].points, ['Lesce Bled', 'Turn 1', 'Lake Field', 'Lesce Bled']);
assert.strictEqual(c.tasks[0].options.aatTime, 210);
assert.strictEqual(c.tasks[0].zones[0].dir, 'next'); assert.ok(c.tasks[0].zones[0].line); assert.strictEqual(c.tasks[0].zones[0].r1, 1000);
assert.strictEqual(c.tasks[0].zones[1].r1, 500, 'km unit');
// round trip
const back = F.parseCUP(F.writeCUP(c.waypoints, c.tasks));
assert.strictEqual(back.waypoints.length, 3);
assert.ok(Math.abs(back.waypoints[1].lat - c.waypoints[1].lat) < 1e-4 && Math.abs(back.waypoints[2].lon - c.waypoints[2].lon) < 1e-4, 'CUP round trip');
assert.deepStrictEqual(back.tasks[0].points, c.tasks[0].points);

// ---- OpenAir
const oa = `* comment
AC D
AN CTR Test
AL GND
AH 3500ft AMSL
DP 46:30:00 N 014:00:00 E
DP 46:30:00 N 014:30:00 E
DP 46:10:00 N 014:30:00 E
DP 46:10:00 N 014:00:00 E

AC C
AN TMA Round
AL FL65
AH FL195
V X=46:00:00 N 015:00:00 E
DC 5

AC R
AN Arc Zone
AL 1000m
AH UNL
V X=46:00:00 N 013:00:00 E
V D=+
DP 46:05:00 N 013:00:00 E
DB 46:05:00 N 013:00:00 E, 46:00:00 N 013:05:00 E
DP 46:00:00 N 013:00:00 E
`;
const a = F.parseOpenAir(oa);
assert.strictEqual(a.length, 3);
assert.strictEqual(a[0].name, 'CTR Test'); assert.strictEqual(a[0].poly.length, 4); assert.strictEqual(a[0].lower, 0);
assert.ok(Math.abs(a[0].upper - 3500 * 0.3048) < 0.01);
assert.ok(a[1].circle && Math.abs(a[1].circle.r - 5 * 1852) < 1, 'DC radius in NM');
assert.ok(Math.abs(a[1].lower - 6500 * 0.3048) < 0.01 && Math.abs(a[1].upper - 19500 * 0.3048) < 0.01, 'flight levels');
assert.ok(a[2].poly.length > 8, 'arc approximated by points: ' + a[2].poly.length);
assert.strictEqual(a[2].upper, 20000, 'UNL');

// ---- OurAirports
const csv = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords"
1,"LJLJ","large_airport","Ljubljana ""Joze Pucnik"" Airport",46.2237,14.4576,1273,"EU","SI","SI-061","Brnik","yes","LJLJ","LJU","","","",""
2,"LJBL","small_airport","Lesce-Bled",46.3433,14.1725,1655,"EU","SI","SI-005","Lesce","no","LJBL","","","","","glider gliding"
3,"XX01","heliport","Heli Pad",46.1,14.1,500,"EU","SI","","","no","","","","","",""
4,"FAR","small_airport","Far Away",10,100,0,"AS","TH","","","no","","","","","",""
`;
const ap = F.parseOurAirports(csv);
assert.strictEqual(ap.length, 3, 'heliport excluded');
assert.strictEqual(ap[0].name, 'Ljubljana "Joze Pucnik" Airport', 'escaped quotes');
assert.strictEqual(ap[1].type, 'glider', 'gliding keyword');
assert.ok(Math.abs(ap[0].elev - 1273 * 0.3048) < 0.01);
const near = F.parseOurAirports(csv, { center: { lat: 46.3, lon: 14.3 }, radius: 100000 });
assert.strictEqual(near.length, 2, 'radius filter drops Far Away');

// ---- OpenAIP JSON (core API shapes)
const as = F.parseOpenAIPAirspaces({ items: [{ name: 'Test CTR', icaoClass: 3, lowerLimit: { value: 0, unit: 1 }, upperLimit: { value: 65, unit: 6 }, geometry: { type: 'Polygon', coordinates: [[[14, 46], [14.5, 46], [14.5, 46.5], [14, 46]]] } }, { name: 'Bad', geometry: { type: 'Point' } }] });
assert.strictEqual(as.length, 1); assert.strictEqual(as[0].cls, 'D');
assert.ok(Math.abs(as[0].upper - 6500 * 0.3048) < 0.01); assert.deepStrictEqual(as[0].poly[1], [46, 14.5], 'lon,lat -> lat,lon');
const ao = F.parseOpenAIPAirports({ items: [{ name: 'Lesce', icaoCode: 'LJBL', type: 3, geometry: { type: 'Point', coordinates: [14.17, 46.34] }, elevation: { value: 504, unit: 0 }, frequencies: [{ value: '123.5' }] }] });
assert.strictEqual(ao[0].type, 'glider'); assert.strictEqual(ao[0].elev, 504); assert.strictEqual(ao[0].lat, 46.34);

// ---- nav merge: user waypoints win over database duplicates
const nav = new LX.Nav(); nav.setAirports(ap); nav.setWaypointFile(c.waypoints);
assert.ok(nav.airports.length >= 3 && nav.waypoints.length === 3);
assert.strictEqual(nav.airports.filter(x => Math.abs(x.lat - 46.3433) < 0.01 && Math.abs(x.lon - 14.1725) < 0.01).length, 1, 'Lesce appears once (user file wins)');

// ---- IGC writer
const igc = F.writeIGC([[3600, 46.5, 14.25, 1234.4], [3601, -33.8, -70.7, 99]], { date: new Date(Date.UTC(2026, 9, 6)) });
const bs = igc.split('\r\n').filter(l => l[0] === 'B');
assert.strictEqual(bs[0], 'B0100004630000N01415000EA0123401234');
assert.ok(/^B010001\d{4}\d{3}S\d{5}W/.test(bs[1]) || /S/.test(bs[1]) && /W/.test(bs[1]), 'S/W hemispheres');
assert.ok(igc.startsWith('AXXX') && igc.includes('HFDTE061026'), 'headers');
// flight declaration round trip
{
  const decl = { pilot: 'A. Pilot', glider: 'ASK 21', regId: 'D-1234', compId: 'XY', name: 'Triangle', date: new Date(Date.UTC(2026, 5, 21, 9, 30, 0)),
    points: [{ name: 'START', lat: 46.5, lon: 14.25 }, { name: 'TP1 Ridge', lat: 46.8, lon: 14.9 }, { name: 'FINISH', lat: 46.5, lon: 14.25 }] };
  const txt = LX.Files.writeDeclaration(decl);
  assert.ok(/^C210626093000000000/m.test(txt) && /HFCIDCOMPETITIONID:XY/.test(txt), 'header + C declaration line');
  const back = LX.Files.parseDeclaration(txt);
  assert.strictEqual(back.pilot, 'A. Pilot'); assert.strictEqual(back.regId, 'D-1234'); assert.strictEqual(back.name, 'Triangle');
  assert.strictEqual(back.points.length, 3); assert.strictEqual(back.points[1].name, 'TP1 Ridge');
  assert.ok(Math.abs(back.points[1].lat - 46.8) < 1e-4 && Math.abs(back.points[1].lon - 14.9) < 1e-4, 'coordinates survive');
}
// checklists
{
  const lists = LX.Files.parseChecklists('# Before take-off\nControls free\nCanopy locked\n\n# Landing\nGear\nBrakes\n');
  assert.strictEqual(lists.length, 2); assert.strictEqual(lists[0].items.length, 2); assert.strictEqual(lists[1].title, 'Landing');
  assert.deepStrictEqual(LX.Files.parseChecklists(LX.Files.writeChecklists(lists)), lists);
  assert.strictEqual(LX.Files.parseChecklists('one\ntwo')[0].items.length, 2, 'file without a heading');
}
// OpenAIP download: back off on HTTP 429, keep partial results
(async () => {
  const F2 = LX.Files; F2.openaipPause = 0;
  const mk = (seq) => { let i = 0; return async () => { const s = seq[Math.min(i++, seq.length - 1)]; return { status: s.status, ok: s.status === 200, headers: { get: () => null }, json: async () => s.body }; }; };
  const nav = { airspaces: [], setAirports() {} };
  global.fetch = mk([{ status: 200, body: { items: [], nextPage: 2 } }, { status: 429 }, { status: 200, body: { items: [] } }]);
  assert.ok(/0 airspace zones$/.test(await F2.fetchOpenAIP(nav, 'airspaces', { lat: 46, lon: 14 }, 1000, 'K')), 'recovers after one 429');
  global.fetch = mk([{ status: 200, body: { items: [], nextPage: 2 } }, { status: 429 }]);
  assert.ok(/stopped early/.test(await F2.fetchOpenAIP(nav, 'airspaces', { lat: 46, lon: 14 }, 1000, 'K')), 'partial result kept on persistent 429');
  // resumes at the page that was refused, keeping the earlier pages
  F2._oaip = null;
  const urls = [];
  const seq = [{ status: 200, body: { items: [], nextPage: 2 } }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 200, body: { items: [] } }];
  let n = 0;
  global.fetch = async (u) => { urls.push(u); const s = seq[n++]; return { status: s.status, ok: s.status === 200, headers: { get: () => null }, json: async () => s.body }; };
  assert.ok(/stopped early/.test(await F2.fetchOpenAIP(nav, 'airspaces', { lat: 46, lon: 14 }, 1000, 'K')));
  assert.ok(/0 airspace zones$/.test(await F2.fetchOpenAIP(nav, 'airspaces', { lat: 46, lon: 14 }, 1000, 'K')), 'second run completes');
  assert.ok(/page=2/.test(urls[urls.length - 1]) && !/page=1&/.test(urls[urls.length - 1]), 'continues at page 2, not page 1');
  F2._oaip = null;
  global.fetch = mk([{ status: 429 }]);
  await assert.rejects(F2.fetchOpenAIP(nav, 'airspaces', { lat: 46, lon: 14 }, 1000, 'K'), /rate limit/);
  console.log('files tests passed');
})();
