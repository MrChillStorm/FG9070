/**
 * FG9070 simulator – namespace, persistent settings and unit formatting.
 *
 * Unofficial, independent training aid. All internal quantities are SI (m, m/s, kg, degrees true); units are
 * applied only when formatting for display.
 *
 * Uses the generic helpers / HTTP sources in js/shared (AeroPanel namespace).
 */
(function (global) {
  'use strict';
  const LX = (global.LX = global.LX || {});
  LX.pages = {};
  const AP = global.AeroPanel;
  LX.util = AP.util;

  /* ----------------------------------------------------------- data sources */
  /**
   * Where the online data comes from (all free, no key unless noted). Override for testing or a
   * mirror with  ?sources=http://host:port  which expects
   *   /terrarium/{z}/{x}/{y}.png   /tiles/{z}/{x}/{y}.png   /oa/airports.csv|runways.csv|airport-frequencies.csv
   *   /metar?ids={id}
   */
  LX.SOURCES = {
    terrarium: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', // Mapzen/AWS terrain tiles (public dataset)
    ourairports: 'https://davidmegginson.github.io/ourairports-data/', // public domain
    metar: 'https://aviationweather.gov/api/data/metar?ids={id}&format=json', // NOAA AWC
    tiles: null, // null = the styles in map.js (OpenTopoMap / OSM)
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/', // PDF reader library, loaded on first use
    meteo: 'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,cape,boundary_layer_height&wind_speed_unit=ms&timezone=GMT&forecast_days=2', // Open-Meteo (free, no key)
  };
  try {
    const src = new URLSearchParams(global.location.search).get('sources');
    if (src) {
      const b = src.replace(/\/$/, '');
      LX.SOURCES = { terrarium: b + '/terrarium/{z}/{x}/{y}.png', ourairports: b + '/oa/', metar: b + '/metar?ids={id}', tiles: b + '/tiles/{z}/{x}/{y}.png', pdfjs: b + '/pdfjs/', meteo: b + '/meteo?lat={lat}&lon={lon}' };
    }
  } catch (e) { /* ignore */ }

  /* ---------------------------------------------------------------- settings */
  const KEY = 'fg9070.settings.v1';
  const defaults = {
    // connection (FlightGear httpd)
    host: '127.0.0.1',
    port: 5400,
    transport: 'poll', // 'poll' | 'ws' | 'demo'
    hz: 20,
    // units (Setup > Units)
    uSpeed: 'km/h', // km/h | kt | mph
    uAlt: 'm', // m | ft
    uVario: 'm/s', // m/s | kt | ft/min
    uDist: 'km', // km | nm | sm
    distMethod: 'fai', // 'fai' sphere | 'wgs84' ellipsoid (Setup > Units)
    ballastMode: 'weight', // 'weight' (kg of water) | 'load' (kg/m2 wing loading) (Setup > Units)
    // Setup > Hardware > Vario unit: TE compensation
    teSource: 'ias', // 'ias' (realistic, default) | 'tas' (high-accuracy mode)
    teComp: 100, // % digital TE compensation (100 = fully compensated)
    // Setup > Vario Parameters (manual defaults)
    needleTau: 1.5, // s
    soundTau: 1.5, // s
    varioRange: 5, // m/s full scale: 2.5 | 5 | 10
    scBand: 1.0, // m/s audio dead band in speed-to-fly mode
    integrator: 20, // s, average vario
    nettoFilter: 1.5, // s; manual: default = same as the vario needle filter
    scTau: 1.5,
    relTau: 1.5,
    nettoTime: 20, // s, average netto
    autoSC: 'GPS', // OFF | GPS | G-load | IAS
    autoResetIntegrator: false,
    // Setup > Sounds > Audio
    audioMode: 'Linear positive',
    scAudioMode: 'SC mixed',
    freq0: 500,
    freqPlus: 1500,
    freqMinus: 200,
    volVario: 60, // Setup > Sounds > Volumes
    volSC: 60,
    volSpeech: 60,
    volBeep: 60,
    volAlarm: 60,
    // Setup > Sounds > Alarms (manual 7.1.8.3): tone for confirmation points
    alarmFreq: 1000, // Hz
    alarmPeriod: 0.4, // s per beep
    alarmStart: true, alarmTurn: true, alarmFinish: true, alarmFinalGlide: true, alarmEvent: false,
    mute: false,
    speech: false,
    // Polar and glider
    glider: 'ask21', // built-in id or a key of gliders
    gliders: {}, // user gliders (Setup > Polar and Glider > NEW), see LX.polar
    ballast: 0, // kg
    bugs: 0, // %
    // QNH and RES
    mc: 1.0, // MacCready, m/s
    safetyAlt: 100, // m
    mcOffset: 0, // m/s, Safety Mc-offset
    qnh: 1013.25, // hPa
    // Setup > Warnings (manual 7.1.10 defaults where given)
    warnAirspace: true,
    warnTime: 30, // s: projected-position look-ahead
    warnHorz: 1000, // m horizontal buffer
    warnVert: 100, // m vertical buffer
    warnConfirm: false, // confirm dismiss
    warnDismissMin: 5,
    warnAlt: false,
    warnAltValue: 3000, // m MSL
    warnAltTime: 20, // s
    warnAltDir: 'above', // approaching the altitude from 'above' | 'below' ... see warnings.js
    sunsetAlarm: false,
    timeAlarm1: 0, timeAlarm2: 0, timeAlarm3: 0, // minutes of flight time, 0 = off
    warnWpt: 0, // m, 0 = off
    flarmDismiss: 15, // s: how long CLOSE silences a FLARM warning (manual 7.1.12.4.2.2: 0-120 s)
    flarmWarn: 'Medium', // No alarm | Low | Medium | High
    flarmVoice: true, flarmVoiceH: true, flarmVoiceV: true, flarmBearing: 'relative', flarmGraphic: true, // FLARM warning content (manual 7.1.10.3)
    showPcas: true, trafficPaths: 'off', // PCAS circles for non-directional traffic; flown paths of other aircraft
    trafficFilter: 'gliders', // gliders | all – only gliders carry FLARM
    trafficKeywords: '', // extra model-name words that count as gliders
    trafficSource: 'auto', // auto | demo | fg | off
    // Setup > Flight Recorder / Optimization
    recInterval: 4, // s
    pilot: '', copilot: '', gliderReg: '', compId: '', checklists: [],
    optPoints: 5, // 5 = OLC style, 3 = FAI free flight (manual 7.1.9)
    optFaiMin: 0.28, // shortest triangle side as a fraction of the perimeter
    optReset: false,
    showOpt: true, showFai: true, faiAlpha: 22, faiKmLines: true, // optimisation display (manual 7.1.7.7)
    wbEmpty: 400, wbPilot: 80, wbCopilot: 0, wbChute: 8, wbArea: 17.5, // Setup > Weight and Balance
    zoneDefaults: {}, // Setup > Observation Zones
    autoBright: true, brightness: 100, nightBright: 25, // Setup > Display
    customPages: {}, pageSets: {}, // LAYOUT editor: custom pages { id: { els, fontScale } } and page order per mode
    layouts: {}, // user navbox layouts: { 'tsk.map': ['Thermal', 'Brg', ...] }
    // display
    night: false,
    orientation: 'auto', // auto (follows the window shape) | landscape | portrait
    mapZoom: 4, // index into LX.Map.ZOOMS (10 km bar)
    mapUp: 'track', // 'track' | 'north'
    tiles: 'opentopomap', // 'off' | 'opentopomap' | 'osm'  (online raster base map; only drawn when it loads)
    terrain: 'terrarium', // 'off' | 'terrarium'  (online elevation tiles; procedural terrain when off/unavailable)
    autoData: true, // download airports (OurAirports) automatically on the first FlightGear fix when none are loaded
    openaipProxy: '', // e.g. http://localhost:5401 (tools/openaip-proxy.js): the OpenAIP API sends no CORS headers
    openaipKey: '', // free key from openaip.net for the online airspace/airport download
    // Setup > Graphics > Glider and Track (manual 7.1.7.5)
    showPath: true, pathLength: 50, pathStyle: 'fixed', pathColor: '#1a3cff', pathWidth: 2, // pathLength in minutes
    showTrackLine: true, trackColor: '#464646', trackWidth: 2,
    showTargetLine: true, targetColor: '#ff2fd5', targetWidth: 3,
    showCollision: true,
    showRangeCircles: true, rangeColor: '#000000', rangeWidth: 1,
    showGlideArea: false, areaColor: '#ff9a1f', areaBorder: '#ff9a1f', areaFill: 'outside',
    // Setup > Graphics > Thermal Mode (7.1.7.6), Optimization (7.1.7.7), Task (7.1.7.8), FLARM (7.1.7.9), Misc (7.1.7.10)
    thermalMode: true, thermalSwitch: 'circling', thermalAngle: 270, thermalZoom: 1, thermalPathLength: 5, thermalPathStyle: 'autospan', thermalPathWidth: 3,
    optColor: '#ffd400', optWidth: 3, showOptTriangle: false, faiColor: '#ffd400',
    taskColor: '#ff2fd5', zoneColor: '#ff2fd5', zoneAlpha: 0, showSelectedZoneOnly: false,
    showFlarm: true, flarmAbove: '#ff7a45', flarmNear: '#ffffff', flarmBelow: '#4fd37a', flarmLostAfter: 120, flarmSymbolSize: 10, flarmLabels: 'all',
    thermalsCount: 4, buttonTimeout: 10, msgFont: 15,
    // Setup > Graphics > Airspace (7.1.7.3) and Waypoints and Airports (7.1.7.4)
    airspaceBelow: 0, airspaceType: 'A', airspaceStyle: {}, // airspaceBelow: show only zones starting below this MSL altitude (m), 0 = all
    showWaypoints: true, wptMax: 60, wptSize: 6, wptUpper: 'name', wptLower: 'none', wptSingle: false, wptColorize: false, minRwLen: 0,
    showMap: true, shadows: true, terrainQuality: 'high', terrainScheme: 'mountain', terrainOffset: 0, mapBackground: '#000000', showWindLines: false, // Setup > Graphics > Map and Terrain (7.1.7.1)
    // Setup > Graphics > Weather (7.1.7.2): all off, they need internet
    wxSat: false, wxSatLayer: '', wxSatAll: false, wxSatOpacity: 70, wxFc: false, wxFcParam: 'cloud_cover', wxFcOffset: 0, wxFcOpacity: 60, wxRain: false, wxRainOpacity: 70, wxRainHistory: 0, wxRainFreeze: 3, wxMinScale: 0, // wxMinScale: map scale-bar step (km) from which the layers show, 0 = always
    showAirspace: true,
    showThermals: true,
    page: 0,
  };

  let data = Object.assign({}, defaults);
  const listeners = [];

  function load() {
    try {
      const raw = global.localStorage.getItem(KEY);
      if (raw) Object.assign(data, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    const q = new URLSearchParams(global.location.search);
    if (q.get('host')) data.host = q.get('host');
    if (q.get('port')) data.port = parseInt(q.get('port'), 10) || data.port;
    if (q.get('demo') === '1') data.transport = 'demo';
    if (q.get('night') === '1') data.night = true;
    if (q.get('orientation')) data.orientation = q.get('orientation');
    if (q.get('glider')) data.glider = q.get('glider');
    if (q.get('speed')) data.demoSpeed = parseFloat(q.get('speed')) || 1;
  }

  LX.settings = {
    defaults,
    load,
    get: () => data,
    set(patch) {
      const changed = Object.keys(patch).filter((k) => data[k] !== patch[k]);
      Object.assign(data, patch);
      try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
      if (changed.length) listeners.forEach((fn) => fn(data, changed));
    },
    onChange: (fn) => listeners.push(fn),
  };

  /* -------------------------------------------------------------------- units */
  /** Conversion factors FROM SI. */
  const F = {
    speed: { 'km/h': 3.6, kt: 1.943844, mph: 2.236936 },
    alt: { m: 1, ft: 3.280840 },
    vario: { 'm/s': 1, kt: 1.943844, 'ft/min': 196.8504 },
    dist: { km: 0.001, nm: 1 / 1852, sm: 1 / 1609.344 },
  };

  LX.units = {
    F,
    speed: (ms) => ms * F.speed[LX.settings.get().uSpeed],
    alt: (m) => m * F.alt[LX.settings.get().uAlt],
    vario: (ms) => ms * F.vario[LX.settings.get().uVario],
    dist: (m) => m * F.dist[LX.settings.get().uDist],
    label: (k) => LX.settings.get()[{ speed: 'uSpeed', alt: 'uAlt', vario: 'uVario', dist: 'uDist' }[k]],
    /** Vario value in display unit -> SI m/s. */
    varioToSI: (v) => v / F.vario[LX.settings.get().uVario],
  };

  /** Formatting helpers (true minus sign, fixed decimals). */
  LX.fmt = {
    num(v, d) {
      if (!Number.isFinite(v)) return '--';
      const s = Math.abs(v).toFixed(d || 0);
      return (v < 0 && parseFloat(s) !== 0 ? '−' : '') + s;
    },
    signed(v, d) {
      if (!Number.isFinite(v)) return '--';
      const s = Math.abs(v).toFixed(d || 0);
      if (parseFloat(s) === 0) return s;
      return (v < 0 ? '−' : '+') + s;
    },
    varioDigits: () => (LX.settings.get().uVario === 'm/s' || LX.settings.get().uVario === 'kt' ? 1 : 0),
  };
})(window);
