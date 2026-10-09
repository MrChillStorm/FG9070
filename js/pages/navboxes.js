/**
 * Navbox registry – the numeric boxes of the navigation pages (manual 8.3.1).
 * Each entry: id -> { title, get(h) -> [value, unit] } with
 *   h = { f (flight state), nav (navigation numbers to the page's target, or null),
 *         ctx, modeId }
 * Only boxes whose data exists in this simulator are offered (no engine, flap,
 * battery-monitor, heart-rate, JRES/FES, HAWK, radio boxes).
 *
 * The LAYOUT soft key on a navigation page lets you pick the box for every
 * slot; the choice is stored per mode and page in settings.layouts.
 */
(function (global) {
  'use strict';
  const LX = global.LX;

  const U = () => LX.units;
  const num = (v, d) => LX.fmt.num(v, d);
  const none = ['---', ''];

  const D = {}; // id -> def
  const def = (id, title, get, desc) => { D[id] = { id, title: title || id, get, desc: desc || '' }; };

  const hw = (h) => h.f.windSpd * Math.cos((h.f.windDir - h.f.track) * Math.PI / 180);

  def('Agl', 'Agl', (h) => [LX.fm.alt(h.f.alt - h.ctx.groundElev(h.f)), U().label('alt')], 'Height above ground');
  def('Alt', 'Alt', (h) => [LX.fm.alt(h.f.alt), U().label('alt')], 'Altitude above MSL');
  def('AltGps', 'AltGps', (h) => [LX.fm.alt(h.f.alt), U().label('alt')], 'GPS altitude');
  def('AltIGC', 'AltIGC', (h) => [LX.fm.alt(h.f.alt - ((h.f.qnhSim || 1013.25) - 1013.25) * 8.23), U().label('alt')], 'Pressure altitude (standard 1013.25 hPa, as recorded in the IGC file)');
  def('AltInv', 'AltInv', (h) => [num(h.f.alt * (U().label('alt') === 'm' ? 3.28084 : 1), 0), U().label('alt') === 'm' ? 'ft' : 'm'], 'Altitude in the opposite unit');
  def('AltGain', 'AltGain', (h) => { const t = h.ctx.flight.thermal; return t ? [LX.fm.alt(h.f.alt - t.alt0), U().label('alt')] : none; }, 'Altitude gained in the current thermal');
  def('Arrival', 'Arrival', (h) => [h.nav ? LX.fmt.signed(U().alt(h.nav.arrival), 0) : '---', U().label('alt')], 'Arrival altitude at the target');
  def('ArrMc0', 'ArrMc0', (h) => [h.nav ? LX.fmt.signed(U().alt(h.nav.arrivalMc0), 0) : '---', U().label('alt')], 'Arrival altitude for Mc = 0');
  def('Ballast', 'Ballast', (h) => [num(h.ctx.settings.get().ballast, 0), 'kg'], 'Current water ballast');
  def('Battery', 'Battery', () => ['12.6', 'V'], 'Battery voltage (fixed value in the simulator)');
  def('Brg', 'Brg', (h) => [h.nav ? LX.fm.hdg(h.nav.bearing) : '---', ''], 'Bearing to the target');
  def('Code', 'Code', (h) => [h.nav && h.nav.target.code ? h.nav.target.code : '---', ''], 'Target code');
  def('cWind', 'cWind', (h) => [num(U().speed(hw(h)), 0), U().label('speed')], 'Head/tail wind component');
  def('xWind', 'xWind', (h) => [num(U().speed(h.f.windSpd * Math.sin((h.f.windDir - h.f.track) * Math.PI / 180)), 0), U().label('speed')], 'Cross wind component');
  def('ToWind', 'ToWind', (h) => [h.nav ? num(U().speed(h.nav.headwind), 0) : '---', U().label('speed')], 'Head/tail wind to target');
  def('Date', 'Date', () => [new Date().toISOString().slice(0, 10), ''], 'Date');
  def('Time', 'Time', () => [new Date().toTimeString().slice(0, 5), ''], 'Local time');
  def('Description', 'Description', (h) => [h.nav ? h.nav.target.type : '---', ''], 'Target type');
  def('Dis', 'Dis', (h) => [h.nav ? LX.fm.dist(h.nav.dist) : '---', U().label('dist')], 'Distance to target');
  def('E', 'E', (h) => [LX.fm.ratio(h.f.glideRatioNow), ''], 'Current glide ratio over 3 minutes');
  def('Elevation', 'Elevation', (h) => [h.nav ? LX.fm.alt(h.nav.target.elev || 0) : '---', U().label('alt')], 'Target elevation');
  def('Emc', 'Emc', (h) => [h.nav ? LX.fm.ratio(h.nav.Emc) : '---', ''], 'Best final glide ratio at the chosen MacCready');
  def('Emcwind', 'Emcwind', (h) => [h.nav ? LX.fm.ratio(h.nav.Emc) : '---', ''], 'Glide ratio for Mc and head/tail wind');
  def('ETA', 'ETA', (h) => [h.nav ? LX.fm.time(((Date.now() / 1000) + h.nav.ete) % 86400) : '--:--', ''], 'Estimated time of arrival');
  def('ETE', 'ETE', (h) => [h.nav ? LX.fm.time(h.nav.ete) : '--:--', ''], 'Estimated time en route');
  def('FL', 'FL', (h) => [String(Math.round((h.f.alt * 3.28084) / 100)).padStart(3, '0'), ''], 'Flight level');
  def('FltTime', 'FltTime', (h) => [LX.fm.hms(h.f.flightTime), ''], 'Flight time');
  def('g-load', 'g-load', (h) => [num(1 / Math.max(0.3, Math.cos(h.f.roll * Math.PI / 180)), 1), 'g'], 'g-load (estimated from the bank angle)');
  def('GS', 'GS', (h) => [LX.fm.spd(h.f.gs), U().label('speed')], 'Ground speed');
  def('GS-TAS', 'GS-TAS', (h) => [LX.fmt.signed(U().speed(h.f.gs - h.f.tas), 0), U().label('speed')], 'Ground speed minus TAS');
  def('Gate', 'Gate', (h) => { const g = h.ctx.runner && h.ctx.runner.gate(Date.now()); if (!g) return ['---', '']; const t = g.open ? g.closesIn : g.opensIn; return [!isFinite(t) ? 'OPEN' : LX.fm.time(t).replace(/^00:/, '') + (g.open ? ' open' : ''), '']; }, 'Start gate: time until it opens / closes');
  def('Gnd', 'Gnd', (h) => { const e = h.ctx.dem.elevation(h.f.lat, h.f.lon, 150); return [e === undefined ? '---' : LX.fm.alt(e), U().label('alt')]; }, 'Terrain elevation below');
  def('Hdg', 'Hdg', (h) => [LX.fm.hdg(h.f.hdg), ''], 'Heading');
  def('Height', 'Height', (h) => [LX.fm.alt(h.f.alt - (h.ctx.flight.flightStartAlt || h.ctx.groundElev(h.f))), U().label('alt')], 'Height above the take-off point');
  def('IAS', 'IAS', (h) => [LX.fm.spd(h.f.ias), U().label('speed')], 'Indicated airspeed');
  def('TAS', 'TAS', (h) => [LX.fm.spd(h.f.tas), U().label('speed')], 'True airspeed');
  def('liveWind', 'liveWind', (h) => [`${Math.round(h.f.windDir)}°/${num(U().speed(h.f.windSpd), 0)}`, ''], 'Wind direction and speed');
  def('LON/LAT', 'LON/LAT', (h) => [`${h.f.lat.toFixed(3)} ${h.f.lon.toFixed(3)}`, ''], 'Position');
  def('Mc', 'Mc', (h) => [num(U().vario(h.ctx.settings.get().mc), 1), U().label('vario')], 'MacCready value');
  def('Netto', 'Netto', (h) => [LX.fm.vario(h.f.netto), U().label('vario')], 'Netto vertical speed of the air mass');
  def('netto avg', 'netto avg', (h) => [LX.fm.vario(h.f.avgN), U().label('vario')], 'Average netto');
  def('Near.Apt', 'Near.Apt', (h) => { const n = h.ctx.nav.nearest(h.f.lat, h.f.lon, 1)[0]; return [n ? n.w.name.slice(0, 10) : '---', '']; }, 'Nearest airport');
  const oat = (f) => (f.oat === null || f.oat === undefined ? 15 - 0.0065 * f.alt : f.oat); // FlightGear air temperature, ISA when unavailable
  def('OAT', 'OAT', (h) => [num(oat(h.f), 1), '°C'], 'Outside temperature (simulator, ISA model if not available)');
  def('Opt', 'Opt', (h) => [LX.fm.dist(h.ctx.flownDist), U().label('dist')], 'Distance flown (the optimisation result is on the Statistics page)');
  def('Pot.Temp', 'Pot.Temp', (h) => [num(oat(h.f) + 0.0098 * h.f.alt, 1), '°C'], 'Potential temperature: OAT brought to sea level on the dry adiabat');
  def('QNH', 'QNH', (h) => [num(h.ctx.settings.get().qnh, 1), 'hPa'], 'QNH setting');
  def('Radial', 'Radial', (h) => [h.nav ? LX.fm.hdg(LX.geo.bearing(h.nav.target.lat, h.nav.target.lon, h.f.lat, h.f.lon)) : '---', ''], 'Radial from the target');
  def('Radius', 'Radius', (h) => { const w = Math.abs(h.f.turnRate) * Math.PI / 180; return [h.f.circling && w > 0.02 ? num(h.f.gs / w, 0) : '---', 'm']; }, 'Circling radius');
  def('Req.Mc', 'Req.Mc', (h) => {
    if (!h.nav) return none;
    const p = h.ctx.flight.getPolar(), s = h.ctx.settings.get();
    const arr = (mc) => LX.polar.finalGlide(p, { mc, dist: h.nav.distTotal || h.nav.dist, headwind: h.nav.headwind, alt: h.f.alt, targetElev: h.nav.target.elev || 0, safety: s.safetyAlt }).arrivalHeight;
    if (arr(0) < 0) return ['> max', '']; // cannot be reached even at Mc 0 -> any Mc is "required" too low... shown as unreachable
    let lo = 0, hi = 6;
    if (arr(hi) > 0) return [num(U().vario(hi), 1), U().label('vario')];
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (arr(mid) > 0) lo = mid; else hi = mid; }
    return [num(U().vario(lo), 1), U().label('vario')];
  }, 'MacCready needed to just reach the target at the safety altitude');
  def('reqE', 'reqE', (h) => [h.nav ? LX.fm.ratio(h.nav.reqE) : '---', ''], 'Required glide ratio to the target');
  def('STF', 'STF', (h) => [LX.fm.spd(h.f.stf), U().label('speed')], 'Speed to fly');
  def('Thermal', 'Thermal', (h) => { const a = h.ctx.flight.lastThermalAvg(); return a === null ? none : [LX.fm.vario(a), U().label('vario')]; }, 'Average climb of the last thermal');
  def('Trk', 'Trk', (h) => [LX.fm.hdg(h.f.track), ''], 'Track');
  def('Vario', 'Vario', (h) => [LX.fm.vario(h.f.te), U().label('vario')], 'TE vario');
  def('Avg', 'Avg', (h) => [LX.fm.vario(h.f.avgV), U().label('vario')], 'Average vario (integrator)');
  def('tDis', 'tDis', (h) => [LX.fm.dist(LX.TaskTools.remaining(h.ctx.nav, h.f)), U().label('dist')], 'Remaining task distance');
  def('tskE', 'tskE', (h) => { const n = h.ctx.navFor('tsk', h.f); return [n ? LX.fm.ratio(n.reqE) : '---', '']; }, 'Required glide ratio to the task finish');
  def('Tsk.Sp', 'Tsk.Sp', (h) => [LX.fm.spd(h.ctx.runner.taskSpeed(h.f, h.f.t)), U().label('speed')], 'Task speed so far');
  def('tReq.Sp', 'tReq.Sp', (h) => { const t = h.ctx.runner.timeInfo(h.f, h.f.t); return t ? [LX.fm.spd(t.required), U().label('speed')] : none; }, 'Speed required to finish (AAT)');
  def('tRemain', 'tRemain', (h) => { const t = h.ctx.runner.timeInfo(h.f, h.f.t); return [t ? LX.fm.time(t.remain) : '--:--', '']; }, 'Remaining task time (AAT)');

  /** Default box ids per page kind (manual 7.5-7.7). */
  const DEFAULTS = {
    map: ['Thermal', 'Brg', 'Dis', 'Alt', 'reqE', 'E'],
    map2: ['Netto', 'Trk', 'GS', 'Agl', 'Opt'],
    side: ['Thermal', 'Brg', 'Dis', 'Alt', 'reqE', 'E'],
    flarm: ['AltIGC', 'AltInv', 'OAT', 'Battery', 'ETA', 'ETE'],
    tmap2: ['Netto', 'Trk', 'GS', 'tDis', 'tskE'],
    ttime: ['Tsk.Sp', 'tReq.Sp', 'tRemain', 'tDis', 'Alt', 'E'],
    ttimes: ['Alt', 'OAT', 'Pot.Temp', 'Battery'],
    vario: ['IAS', 'STF', 'GS', 'Alt', 'Avg', 'Netto'],
    pfd: ['IAS', 'Alt', 'Vario', 'Hdg'],
    apt: [],
  };

  LX.navboxes = {
    defs: D,
    ids: () => Object.keys(D),
    title: (id) => (D[id] ? D[id].title : id),
    get: (id, h) => (D[id] ? D[id].get(h) : none),
    defaults: (kind) => (DEFAULTS[kind] || []).slice(),
    /** Box ids for a page: user layout from settings or the manual's default. */
    layoutFor(modeId, kind) {
      const L = LX.settings.get().layouts || {};
      return (L[modeId + '.' + kind] || DEFAULTS[kind] || []).slice();
    },
  };
})(window);
