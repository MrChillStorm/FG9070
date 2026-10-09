#!/usr/bin/env node
/**
 * Checks which free weather data services a browser page could use, so the trainer's weather layers
 * (Setup > Graphics, manual 7.1.7.2) are built only on services that actually work:
 *
 *   node tools/weather-probe.js
 *
 * Needs Node 18+ and internet access. For each service it prints whether it answered, how fast, whether it
 * sends the CORS header a browser needs (access-control-allow-origin), and what layers it offers.
 * Nothing is stored or sent anywhere except the plain requests to these services.
 */
const TIMEOUT = 20000;
const UA = 'FG9070-weather-probe/1.0 (personal test)';

async function get(url, opts) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    // Origin: null is what a page opened from file:// sends
    const r = await fetch(url, Object.assign({ signal: ctl.signal, headers: { Origin: 'null', 'User-Agent': UA } }, opts || {}));
    return { r, ms: Date.now() - t0, acao: r.headers.get('access-control-allow-origin') };
  } finally { clearTimeout(timer); }
}

const cors = (acao) => (acao === '*' || acao === 'null' ? `OK (${acao})` : acao ? `only for ${acao}` : 'NO - a page cannot read it');
const out = [];
const say = (s) => { out.push(s); console.log(s); };

async function probe(name, fn) {
  say(`\n=== ${name}`);
  try { await fn(); } catch (e) { say(`  FAILED: ${e.name === 'AbortError' ? 'timed out' : e.message}`); }
}

(async () => {
  say('FG9070 weather probe  ' + new Date().toISOString() + '  node ' + process.version);

  await probe('RainViewer (rain radar)', async () => {
    const { r, ms, acao } = await get('https://api.rainviewer.com/public/weather-maps.json');
    say(`  weather-maps.json: HTTP ${r.status}, ${ms} ms, CORS ${cors(acao)}`);
    if (!r.ok) return;
    const j = await r.json();
    const past = (j.radar && j.radar.past) || [];
    say(`  host: ${j.host}; radar frames: ${past.length} past, ${((j.radar && j.radar.nowcast) || []).length} nowcast`);
    if (!past.length) return;
    const last = past[past.length - 1];
    say(`  newest frame: ${new Date(last.time * 1000).toISOString()}  path ${last.path}`);
    for (const z of [3, 6, 7, 8, 10]) {
      const n = Math.pow(2, z), x = Math.floor(n * (14.2 + 180) / 360);
      const y = Math.floor(n * (1 - Math.log(Math.tan(46.4 * Math.PI / 180) + 1 / Math.cos(46.4 * Math.PI / 180)) / Math.PI) / 2);
      const t = await get(`${j.host}${last.path}/256/${z}/${x}/${y}/2/1_1.png`);
      say(`  tile zoom ${String(z).padStart(2)}: HTTP ${t.r.status}, ${t.r.headers.get('content-type')}, CORS ${cors(t.acao)}`);
    }
  });

  await probe('NASA GIBS (satellite imagery)', async () => {
    const { r, ms, acao } = await get('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml');
    say(`  WMTSCapabilities: HTTP ${r.status}, ${ms} ms, CORS ${cors(acao)}`);
    if (!r.ok) return;
    const xml = await r.text();
    const ids = [...xml.matchAll(/<ows:Identifier>([^<]+)<\/ows:Identifier>/g)].map((m) => m[1]);
    const want = ids.filter((id) => /geocolor|meteosat|himawari|goes|seviri|eumetsat|msg/i.test(id));
    say(`  ${ids.length} identifiers; satellite-like layers (${want.length}):`);
    want.slice(0, 30).forEach((id) => say('    ' + id));
  });

  await probe('EUMETSAT EUMETView (Meteosat, Europe/Africa)', async () => {
    const { r, ms, acao } = await get('https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetCapabilities');
    say(`  GetCapabilities: HTTP ${r.status}, ${ms} ms, CORS ${cors(acao)}`);
    if (!r.ok) return;
    const xml = await r.text();
    const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    const want = names.filter((n) => /msg|mtg|meteosat|natural|airmass|ir108|ir_108|cloud|dust|fog|hrv/i.test(n));
    say(`  ${names.length} layers; matching (${want.length}):`);
    want.slice(0, 30).forEach((n) => say('    ' + n));
    // ask for real map images too: a layer can be listed and still fail (HTTP 500 when it has no data for "now")
    const tryLayers = want.filter((n) => /^msg_fes:/.test(n) && /ir108|ir_108|natural|hrv|clm/i.test(n)).slice(0, 6);
    for (const n of tryLayers) {
      const g = await get(`https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(n)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox=626172.1357,5009377.0857,1252344.2714,5635549.2215`);
      const ct = g.r.headers.get('content-type') || '';
      say(`  GetMap ${n}: HTTP ${g.r.status}, ${ct}${g.r.ok && /image/.test(ct) ? '' : '  ' + (await g.r.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  });

  await probe('Open-Meteo (forecast grid for a gridded overlay)', async () => {
    const lats = [46.0, 46.4, 46.8], lons = [13.8, 14.2, 14.6];
    const la = [], lo = [];
    lats.forEach((a) => lons.forEach((b) => { la.push(a); lo.push(b); }));
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=cloud_cover,cape,boundary_layer_height&forecast_days=1&timezone=GMT`;
    const { r, ms, acao } = await get(url);
    say(`  9 points in one request: HTTP ${r.status}, ${ms} ms, CORS ${cors(acao)}`);
    if (!r.ok) { say('  ' + (await r.text()).slice(0, 200)); return; }
    const j = await r.json();
    say(`  locations returned: ${Array.isArray(j) ? j.length : 1}; hourly fields: ${Object.keys((Array.isArray(j) ? j[0] : j).hourly || {}).join(', ')}`);
  });

  await probe('DWD GeoServer (German Weather Service WMS)', async () => {
    const { r, ms, acao } = await get('https://maps.dwd.de/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities');
    say(`  GetCapabilities: HTTP ${r.status}, ${ms} ms, CORS ${cors(acao)}`);
    if (!r.ok) return;
    const xml = await r.text();
    const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    const want = names.filter((n) => /icon|cloud|bewoelk|niederschlag|precip|radar|sat|wind|cape/i.test(n));
    say(`  ${names.length} layers; matching (${want.length}):`);
    want.slice(0, 30).forEach((n) => say('    ' + n));
  });

  say('\n=== done. Please send everything above (from "FG9070 weather probe") back to Claude.');
})();
