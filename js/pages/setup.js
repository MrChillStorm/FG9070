/**
 * Setup mode (manual 7.1) and the dialogs reachable from the navigation pages.
 *
 * Menu order and field labels follow the manual. Dialogs that need data or
 * hardware this simulator does not have (flight recorder, passwords, 
 * Connect, ...) open an honest "not implemented" popup instead of faking it.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const U = () => LX.units;

  /* ------------------------------------------------------------- speech (opt) */
  LX.speech = {
    say(text, force) {
      const s = LX.settings.get();
      if ((!s.speech && !force) || s.mute || !global.speechSynthesis) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.volume = Math.max(0, Math.min(1, s.volSpeech / 100));
        global.speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    },
  };

  /* ----------------------------------------------------------------- helpers */
  const S = () => LX.settings;
  const bind = (key) => ({ get: () => S().get()[key], set: (v) => S().set({ [key]: v }) });
  const spin = (label, key, min, max, step, fmt, extra) => Object.assign({ type: 'spin', label, min, max, step, fmt }, bind(key), extra || {});
  const select = (label, key, options, show, extra) => Object.assign({ type: 'select', label, options, show }, bind(key), extra || {});
  const check = (label, key, text) => Object.assign({ type: 'check', label, text }, bind(key));
  const info = (label, get, extra) => Object.assign({ type: 'info', label, get }, extra || {});
  const section = (label) => ({ type: 'section', label });
  const num = (v, d) => LX.fmt.num(v, d);

  function notImplemented(scr, what) {
    scr.open(new Popup(scr, what, 'Not implemented in this simulator yet.\nSee the README feature list.', { 7: { label: 'OK', run: (s) => s.close() } }));
  }

  /* -------------------------------------------------- Setup > QNH and RES */
  function qnhRes(scr, ctx) {
    return new FormView(scr, {
      title: 'QNH and RES',
      fields: [
        spin('QNH [hPa]', 'qnh', 900, 1100, 0.1, (v) => num(v, 1) + ' hPa', { coarse: 10 }),
        spin('Safety altitude', 'safetyAlt', 0, 1500, 10, (v) => num(U().alt(v), 0) + ' ' + U().label('alt'), { coarse: 5 }),
        spin('Safety Mc-offset', 'mcOffset', 0, 3, 0.1, (v) => '+' + num(U().vario(v), 1) + ' ' + U().label('vario'), { coarse: 5 }),
        info('Altitude source', () => 'FlightGear MSL'),
        { type: 'action', label: 'QNH from simulator', text: 'SET', run: () => S().set({ qnh: Math.round(ctx.flight.f.qnhSim * 10) / 10 }) },
        info('Simulator QNH', () => num(ctx.flight.f.qnhSim, 1) + ' hPa'),
      ],
      live: true,
    });
  }

  /* ------------------------------------------------ Setup > Vario Parameters */
  function varioParams(scr) {
    const sec = (v) => num(v, 1) + 'sec';
    return new FormView(scr, {
      title: 'Vario Parameters',
      fields: [
        spin('Vario needle filter', 'needleTau', 0.1, 5, 0.1, sec, { coarse: 10 }),
        spin('Vario sound filter', 'soundTau', 0.1, 5, 0.1, sec, { coarse: 10 }),
        select('Vario range', 'varioRange', [2.5, 5, 10], (v) => v + ' m/s'),
        spin('SC tab', 'scBand', 0, 3, 0.1, (v) => '±' + num(v, 1) + ' m/s'),
        spin('Integrator time', 'integrator', 1, 60, 1, (v) => v + 'sec', { coarse: 5 }),
        select('Auto SC', 'autoSC', ['OFF', 'GPS', 'G-load', 'IAS']),
        check('', 'autoResetIntegrator', 'Auto reset integrator'),
        spin('Netto filter', 'nettoFilter', 0.1, 20, 0.1, sec, { coarse: 10 }),
        spin('SC filter', 'scTau', 0.1, 20, 0.1, sec, { coarse: 10 }),
        spin('Relative filter', 'relTau', 0.1, 20, 0.1, sec, { coarse: 10 }),
        spin('Netto time', 'nettoTime', 1, 60, 1, (v) => v + 'sec', { coarse: 5 }),
        section('HAWK (inertial wind) is not simulated'),
      ],
    });
  }

  /* ---------------------------------------------------------- Setup > Sounds */
  function audioSettings(scr, ctx) {
    return new FormView(scr, {
      title: 'Audio',
      fields: [
        select('Vario audio mode', 'audioMode', LX.AUDIO_MODES.vario, null, { wide: true }),
        select('SC audio mode', 'scAudioMode', LX.AUDIO_MODES.sc, null, { wide: true }),
        spin('FREQ at 0%', 'freq0', 100, 2000, 10, (v) => v + 'Hz', { coarse: 10 }),
        spin('FREQ at 100%', 'freqPlus', 500, 3000, 10, (v) => v + 'Hz', { coarse: 10 }),
        spin('FREQ at -100%', 'freqMinus', 80, 1000, 10, (v) => v + 'Hz', { coarse: 10 }),
        info('Vario audio source', () => 'Vario (TE)'),
        info('SC audio source', () => 'Vario (TE)'),
      ],
      buttons: { 6: { label: 'DEMO', run: () => { ctx.audio.unlock(); ctx.audio.demo(S().get().audioMode, 4); } } },
    });
  }

  function volumes(scr) {
    return new FormView(scr, {
      title: 'Volumes',
      fields: [
        spin('Vario', 'volVario', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        spin('Speed to fly', 'volSC', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        spin('Speech', 'volSpeech', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        spin('Beep', 'volBeep', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        spin('Alarm', 'volAlarm', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        check('', 'mute', 'Mute all'),
      ],
    });
  }

  function voice(scr) {
    return new FormView(scr, {
      title: 'Voice',
      fields: [
        check('', 'speech', 'Speech announcements (Web Speech API)'),
        spin('Volume', 'volSpeech', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
        section('Messages: final glide reached, thermal average on exit'),
      ],
      buttons: { 6: { label: 'DEMO', run: () => { const s = S().get(); const was = s.speech; S().set({ speech: true }); LX.speech.say('Final glide reached'); S().set({ speech: was }); } } },
    });
  }

  function alarms(scr, ctx) {
    return new FormView(scr, {
      title: 'Alarms',
      fields: [
        check('', 'alarmStart', 'Task started'),
        check('', 'alarmTurn', 'Inside turn point zone'),
        check('', 'alarmFinish', 'Task finished'),
        check('', 'alarmFinalGlide', 'Final glide reached'),
        check('', 'alarmEvent', 'Event marked'),
        spin('Frequency', 'alarmFreq', 200, 3000, 50, (v) => v + 'Hz', { coarse: 4 }),
        spin('Period', 'alarmPeriod', 0.1, 1, 0.05, (v) => num(v, 2) + 's', { coarse: 2 }),
        spin('Volume', 'volAlarm', 0, 100, 5, (v) => v + '%', { coarse: 4 }),
      ],
      buttons: { 6: { label: 'DEMO', run: () => { ctx.audio.unlock(); ctx.audio.playAlarm(); } } },
    });
  }

  function soundsMenu(scr, ctx) {
    return new MenuView(scr, [
      { label: 'Audio Settings', color: '#ffb000', run: (s) => s.open(audioSettings(s, ctx)) },
      { label: 'Volumes', color: '#ffb000', run: (s) => s.open(volumes(s)) },
      { label: 'Voice', color: '#ffb000', run: (s) => s.open(voice(s)) },
      { label: 'Alarms', color: '#ff5a4a', run: (s) => s.open(alarms(s, ctx)) },
    ], { title: 'Sounds' });
  }

  /* ------------------------------------------------------------ Setup > Units */
  function unitsDialog(scr) {
    return new FormView(scr, {
      title: 'Units',
      fields: [
        select('Speed', 'uSpeed', ['km/h', 'kt', 'mph']),
        select('Altitude', 'uAlt', ['m', 'ft']),
        select('Vario', 'uVario', ['m/s', 'kt', 'ft/min']),
        select('Distance', 'uDist', ['km', 'nm', 'sm']),
        info('Dist. calc. method', () => 'FAI sphere'),
      ],
      buttons: {
        6: {
          label: 'METRIC/IMP.',
          run: () => {
            const metric = S().get().uSpeed === 'km/h';
            S().set(metric ? { uSpeed: 'kt', uAlt: 'ft', uVario: 'kt', uDist: 'nm' } : { uSpeed: 'km/h', uAlt: 'm', uVario: 'm/s', uDist: 'km' });
          },
        },
      },
    });
  }

  /* ------------------------------------------------------- Setup > Hardware */
  function varioUnit(scr) {
    const OPTS = [{ v: 'ias', t: 'IAS (indicated, realistic)' }, { v: 'tas', t: 'TAS (true, high accuracy)' }];
    return new FormView(scr, {
      title: 'Vario Unit Settings - TE Compensation',
      fields: [
        Object.assign({ type: 'select', label: 'TE speed source', options: OPTS, wide: true, show: (v) => OPTS.find((o) => o.v === v).t }, bind('teSource')),
        spin('TE compensation', 'teComp', 0, 150, 1, (v) => v + '%', { coarse: 10 }),
        section('100% = digital TE, fully compensated; 0% = no compensation.'),
        section('IAS source reproduces a real probe/digital unit (small IAS/TAS error).'),
        section('TAS source gives exact energy bookkeeping.'),
      ],
    });
  }

  function network(scr, ctx) {
    const OPTS = [{ v: 'poll', t: 'FlightGear HTTP polling' }, { v: 'ws', t: 'FlightGear WebSocket (exp.)' }, { v: 'demo', t: 'Built-in demo flight' }];
    const text = (key, label) => ({ type: 'select', label, options: () => [S().get()[key]], get: () => S().get()[key], set: () => {} });
    return new FormView(scr, {
      title: 'Network (FlightGear)',
      fields: [
        Object.assign({ type: 'select', label: 'Data source', options: OPTS, wide: true, show: (v) => OPTS.find((o) => o.v === v).t }, bind('transport')),
        Object.assign({ type: 'action', label: 'Host / IP', text: S().get().host, wide: true, run: (s, form) => {
          const v = global.prompt('FlightGear host / IP', S().get().host);
          if (v) S().set({ host: v.trim() });
          form.fields[1].text = S().get().host;
        } }),
        spin('HTTP port', 'port', 1, 65535, 1, (v) => String(v), { coarse: 100 }),
        spin('Update rate', 'hz', 5, 60, 5, (v) => v + ' Hz'),
        info('Status', () => ctx.statusText(), { wide: true }),
      ],
      live: true,
    });
  }

  function flarmHw(scr, ctx) {
    const OPTS = [{ v: 'auto', t: 'Auto (demo flight: simulated, else FlightGear AI)' }, { v: 'demo', t: 'Simulated demo traffic' }, { v: 'fg', t: 'FlightGear AI / multiplayer (experimental)' }, { v: 'off', t: 'No traffic' }];
    return new FormView(scr, {
      title: 'FLARM (simulated)',
      live: true,
      fields: [
        Object.assign({ type: 'select', label: 'Traffic source', options: OPTS, wide: true, show: (v) => OPTS.find((o) => o.v === v).t }, bind('trafficSource')),
        { type: 'check', label: '', text: 'Show PCAS circles (powered traffic)', get: () => S().get().showPcas, set: (v) => S().set({ showPcas: v }) },
        Object.assign({ type: 'select', label: 'Paths', options: ['off', 'all'], show: (v) => (v === 'all' ? 'draw flown paths of other aircraft' : 'no paths') }, bind('trafficPaths')),
        Object.assign({ type: 'select', label: 'Show', options: ['gliders', 'all'], show: (v) => (v === 'all' ? 'all aircraft' : 'gliders only (FLARM)') }, bind('trafficFilter')),
        { type: 'action', label: 'Extra glider words', text: S().get().trafficKeywords || 'none', wide: true, run: (s2, form) => {
          const v = global.prompt('Extra words in a model name/path that mark a glider (e.g. "ask21 mymodel"):', S().get().trafficKeywords || '');
          if (v !== null) { S().set({ trafficKeywords: v.trim() }); form.render && form.render(); }
        } },
        info('Targets now', () => `${ctx.traffic.relative(ctx.flight.f, 0).length}`),
        section('FlightGear AI models are read from /ai/models via the HTTP server.'),
      ],
    });
  }

  function hardwareMenu(scr, ctx) {
    const stub = (n) => (s) => notImplemented(s, n);
    return new MenuView(scr, [
      { label: 'Vario Unit Settings (TE comp.)', color: '#6ee06e', run: (s) => s.open(varioUnit(s)) },
      { label: 'Network (FlightGear)', color: '#5fd0ff', run: (s) => s.open(network(s, ctx)) },
      { label: 'Vario Indicator Setup', color: '#8a8f99', run: stub('Vario Indicator Setup') },
      { label: 'FLARM (traffic source)', color: '#5fd0ff', run: (s) => s.open(flarmHw(s, ctx)) },
      { label: 'Remote Stick', color: '#8a8f99', run: stub('Remote Stick') },
      { label: 'AHRS', color: '#8a8f99', run: stub('AHRS') },
      { label: 'NMEA Output', color: '#8a8f99', run: stub('NMEA Output') },
      { label: 'Battery Types', color: '#8a8f99', run: stub('Battery Types') },
    ], { title: 'Hardware' });
  }

  /* ------------------------------------------------- Setup > Polar and Glider */
  function polarGlider(scr, ctx) {
    const ids = Object.keys(LX.polar.GLIDERS);
    return new FormView(scr, {
      title: 'Polar and Glider',
      fields: [
        Object.assign({ type: 'select', label: 'Glider', options: ids, wide: true, show: (v) => LX.polar.GLIDERS[v].name }, bind('glider')),
        {
          type: 'spin', label: 'Water ballast', min: 0, step: 5, coarse: 4,
          get: () => S().get().ballast,
          set: (v) => S().set({ ballast: Math.min(v, LX.polar.GLIDERS[S().get().glider].maxBallast) }),
          get max() { return LX.polar.GLIDERS[S().get().glider].maxBallast; },
          fmt: (v) => v + ' kg',
        },
        spin('Bugs', 'bugs', 0, 30, 1, (v) => v + '%'),
        info('Best L/D', () => { const p = ctx.flight.getPolar(), c = LX.polar.characteristics(p); return `${num(c.bestLD.ld, 1)} @ ${num(U().speed(c.bestLD.v), 0)} ${U().label('speed')}`; }),
        info('Min sink', () => { const p = ctx.flight.getPolar(), c = LX.polar.characteristics(p); return `${num(U().vario(-c.minSink.w), 2)} ${U().label('vario')} @ ${num(U().speed(c.minSink.v), 0)}`; }),
        info('Mass', () => num(ctx.flight.getPolar().mass, 0) + ' kg'),
        section('Polar points are approximations: replace in js/flight/polar.js'),
      ],
      live: true,
    });
  }

  /* ----------------------------------------------------------- Setup > Graphics */
  function mapAndTerrain(scr) {
    return new FormView(scr, {
      title: 'Map and Terrain',
      fields: [
        check('', 'showMap', 'Show map'),
        check('', 'shadows', 'Shadows'),
        Object.assign({ type: 'select', label: 'Terrain quality', options: ['high', 'medium', 'low', 'off'], show: (v) => ({ high: 'High', medium: 'Medium', low: 'Low', off: 'Off (no terrain)' }[v]) }, bind('terrainQuality')),
        Object.assign({ type: 'select', label: 'Colour scheme', options: Object.keys(LX.Map.SCHEME_NAMES), show: (v) => LX.Map.SCHEME_NAMES[v] }, bind('terrainScheme')),
        spin('Offset', 'terrainOffset', -1000, 1000, 50, (v) => (v > 0 ? '+' : '') + num(U().alt(v), 0) + ' ' + U().label('alt'), { coarse: 4 }),
        colorSel('Background', 'mapBackground'),
        check('', 'showWindLines', 'Show wind direction'),
        Object.assign({ type: 'select', label: 'Map orientation', options: ['track', 'north'], show: (v) => (v === 'track' ? 'Track up' : 'North up') }, bind('mapUp')),
        Object.assign({ type: 'select', label: 'Base map', options: ['off', 'opentopomap', 'osm'], wide: true, show: (v) => ({ off: 'Procedural terrain (offline)', opentopomap: 'OpenTopoMap tiles (online)', osm: 'OpenStreetMap tiles (online)' }[v]) }, bind('tiles')),
        Object.assign({ type: 'select', label: 'Terrain data', options: ['terrarium', 'off'], wide: true, show: (v) => (v === 'off' ? 'Procedural terrain only (offline)' : 'Elevation tiles (online, falls back to procedural)') }, bind('terrain')),
        check('', 'showAirspace', 'Show airspace'),
        check('', 'showThermals', 'Show thermal markers'),
        section('Tiles need internet access in the browser; attribution is drawn on the map. Label zoom, land-feature elements and raster maps are not configurable.'),
      ],
    });
  }

  /* named colours for the Graphics colour items (value = CSS colour) */
  const COLORS = { '#ff3b30': 'Red', '#ff9a1f': 'Orange', '#ffd400': 'Yellow', '#29d35a': 'Green', '#1a8a3a': 'Dark green', '#5fd0ff': 'Cyan', '#1a3cff': 'Blue', '#ff2fd5': 'Magenta', '#ffffff': 'White', '#8a8f99': 'Grey', '#464646': 'Dark grey', '#000000': 'Black' };
  const colorSel = (label, key) => Object.assign({ type: 'select', label, options: Object.keys(COLORS), show: (v) => COLORS[v] || v }, bind(key));
  const widthSel = (label, key) => spin(label, key, 1, 8, 1, (v) => v + ' px');

  /* ------------------------------------- Setup > Graphics > Glider and Track (7.1.7.5) */
  function gliderTrack(scr) {
    const PS = { fixed: 'Fixed colour', mc: 'Mc (vs. MacCready)', vario: 'Vario', altitude: 'Altitude', speed: 'Ground speed' };
    return new FormView(scr, {
      title: 'Glider and Track',
      fields: [
        check('', 'showPath', 'Show path'),
        spin('Path length', 'pathLength', 5, 180, 5, (v) => v + ' min', { coarse: 4 }),
        Object.assign({ type: 'select', label: 'Path style', options: Object.keys(PS), show: (v) => PS[v] }, bind('pathStyle')),
        colorSel('Path colour (fixed)', 'pathColor'),
        widthSel('Path width', 'pathWidth'),
        check('', 'showTrackLine', 'Show current track'),
        colorSel('Track colour', 'trackColor'),
        widthSel('Track width', 'trackWidth'),
        check('', 'showTargetLine', 'Show target line'),
        colorSel('Target colour', 'targetColor'),
        widthSel('Target width', 'targetWidth'),
        check('', 'showCollision', 'Show terrain collision point'),
        check('', 'showRangeCircles', 'Show range circles'),
        colorSel('Range colour', 'rangeColor'),
        widthSel('Range width', 'rangeWidth'),
        check('', 'showGlideArea', 'Show glider range area'),
        colorSel('Area colour', 'areaColor'),
        colorSel('Area border', 'areaBorder'),
        Object.assign({ type: 'select', label: 'Fill area', options: ['outside', 'inside'], show: (v) => (v === 'outside' ? 'Outside the range area' : 'Inside the range area') }, bind('areaFill')),
        section('The range area uses the safety Mc and the wind. No Hawk Netto path style or engine colouring: no HAWK / engine.'),
      ],
      buttons: { 6: { label: 'DEFAULT', run: (s, form) => { S().set({ showPath: true, pathLength: 50, pathStyle: 'fixed', pathColor: '#1a3cff', pathWidth: 2, showTrackLine: true, trackColor: '#464646', trackWidth: 2, showTargetLine: true, targetColor: '#ff2fd5', targetWidth: 3, showCollision: true, showRangeCircles: true, rangeColor: '#000000', rangeWidth: 1, showGlideArea: false, areaColor: '#ff9a1f', areaBorder: '#ff9a1f', areaFill: 'outside' }); scr.toast('Defaults restored', 1200); } } },
    });
  }

  /* --------------------------------------- Setup > Graphics > Thermal Mode (7.1.7.6 / 7.8) */
  function thermalModeSetup(scr) {
    const ZS = LX.Map.ZOOMS;
    return new FormView(scr, {
      title: 'Thermal Mode',
      fields: [
        check('', 'thermalMode', 'Enabled'),
        Object.assign({ type: 'select', label: 'Switch by', options: ['circling', 'scvar'], show: (v) => (v === 'circling' ? 'Circling detection' : 'Switching SC / Vario') }, bind('thermalSwitch')),
        spin('Switch angle', 'thermalAngle', 90, 720, 30, (v) => v + '°', { coarse: 3 }),
        Object.assign({ type: 'select', label: 'Page zoom', options: ZS.map((_, i) => i), show: (v) => ZS[v] + ' km' }, bind('thermalZoom')),
        spin('Path length', 'thermalPathLength', 1, 30, 1, (v) => v + ' min', { coarse: 5 }),
        Object.assign({ type: 'select', label: 'Path colouring', options: ['autospan', 'avgvario', 'mc', 'fixed'], show: (v) => ({ autospan: 'Auto span', avgvario: 'Average vario', mc: 'Mc (vs. MacCready)', fixed: 'Fixed colour' }[v]) }, bind('thermalPathStyle')),
        widthSel('Path width', 'thermalPathWidth'),
        section('Leave thermal mode by turning the PAGE or ZOOM knob. No Hawk netto colouring (no HAWK).'),
      ],
    });
  }

  /* --------------------------------------- Setup > Graphics > Optimization (7.1.7.7) */
  function optimizationLook(scr) {
    return new FormView(scr, {
      title: 'Optimization (graphics)',
      fields: [
        check('', 'showOpt', 'Show optimization'),
        colorSel('Optimization colour', 'optColor'),
        widthSel('Optimization width', 'optWidth'),
        check('', 'showOptTriangle', 'Show optimized triangle (may not be an FAI triangle)'),
        check('', 'showFai', 'Show FAI triangle area (assistant)'),
        colorSel('FAI area colour', 'faiColor'),
        Object.assign({ type: 'spin', label: 'FAI area opacity', min: 0, max: 60, step: 2, coarse: 10, fmt: (v) => v + '%' }, bind('faiAlpha')),
        check('', 'faiKmLines', 'Show km lines'),
      ],
    });
  }

  /* --------------------------------------------------- Setup > Graphics > Task (7.1.7.8) */
  function taskLook(scr) {
    return new FormView(scr, {
      title: 'Task (graphics)',
      fields: [
        colorSel('Task colour', 'taskColor'),
        colorSel('Obs. zone colour', 'zoneColor'),
        spin('Obs. zone opacity', 'zoneAlpha', 0, 60, 5, (v) => v + '%', { coarse: 4 }),
        check('', 'showSelectedZoneOnly', 'Show selected zone only'),
        section('Not simulated: flown task display, optimal-track arrow, AAT isolines / fill / text colour.'),
      ],
    });
  }

  /* ------------------------------------------------- Setup > Graphics > FLARM (7.1.7.9) */
  function flarmLook(scr) {
    return new FormView(scr, {
      title: 'FLARM (graphics)',
      fields: [
        check('', 'showFlarm', 'Show FLARM objects'),
        colorSel('Above colour', 'flarmAbove'),
        colorSel('Near colour', 'flarmNear'),
        colorSel('Below colour', 'flarmBelow'),
        spin('Lost device after', 'flarmLostAfter', 10, 600, 10, (v) => v + ' s', { coarse: 6 }),
        Object.assign({ type: 'select', label: 'Show labels', options: ['all', 'near', 'none'], show: (v) => ({ all: 'All objects', near: 'Near objects only', none: 'None' }[v]) }, bind('flarmLabels')),
        spin('Symbol size', 'flarmSymbolSize', 6, 20, 1, (v) => v + ' px'),
        Object.assign({ type: 'select', label: 'Show paths', options: ['off', 'all'], show: (v) => (v === 'all' ? 'All objects' : 'None') }, bind('trafficPaths')),
        check('', 'showPcas', 'Show PCAS'),
      ],
    });
  }

  /* --------------------------------------------------- Setup > Graphics > Misc. (7.1.7.10) */
  function miscLook(scr) {
    return new FormView(scr, {
      title: 'Misc.',
      fields: [
        spin('Statistics thermals count', 'thermalsCount', 2, 8, 1, (v) => String(v)),
        spin('Button timeout', 'buttonTimeout', 3, 30, 1, (v) => v + ' s'),
        spin('Message font size', 'msgFont', 11, 24, 1, (v) => v + ' px'),
        section('No button proximity / button font size: no touch hardware.'),
      ],
    });
  }

  /* ------------------------------------------- Setup > Graphics > Airspace (7.1.7.3) */
  function airspaceLook(scr) {
    const AS_DEFAULT = { zoom: 1000, color: '#ff3b30', width: 2, alpha: 22 };
    const TYPES = LX.Map.AIRSPACE_TYPES.concat('other');
    const cur = () => Object.assign({}, AS_DEFAULT, (S().get().airspaceStyle || {})[S().get().airspaceType]);
    const put = (patch) => { const all = Object.assign({}, S().get().airspaceStyle || {}); all[S().get().airspaceType] = Object.assign(cur(), patch); S().set({ airspaceStyle: all }); };
    return new FormView(scr, {
      title: 'Airspace',
      live: true,
      fields: [
        check('', 'showAirspace', 'Show airspace'),
        spin('Show only airspace below', 'airspaceBelow', 0, 12000, 100, (v) => (v ? num(U().alt(v), 0) + ' ' + U().label('alt') : 'all'), { coarse: 10 }),
        Object.assign({ type: 'select', label: 'Type', options: TYPES, show: (v) => (v === 'other' ? 'Other / unknown' : 'Class / type ' + v) }, bind('airspaceType')),
        { type: 'spin', label: 'Zoom (visible up to)', min: 10, max: 1000, step: 10, coarse: 5, get: () => cur().zoom, set: (v) => put({ zoom: v }), fmt: (v) => (v >= 1000 ? 'always' : v + ' km') },
        { type: 'select', label: 'Colour', options: Object.keys(COLORS), show: (v) => COLORS[v] || v, get: () => cur().color, set: (v) => put({ color: v }) },
        { type: 'spin', label: 'Width', min: 1, max: 6, step: 1, coarse: 1, get: () => cur().width, set: (v) => put({ width: v }), fmt: (v) => v + ' px' },
        { type: 'spin', label: 'Opacity', min: 0, max: 100, step: 5, coarse: 4, get: () => cur().alpha, set: (v) => put({ alpha: v }), fmt: (v) => v + '%' },
        section('Settings apply to the selected type. No inactive zones / NOTAMs / separate side-view styles.'),
      ],
      buttons: { 6: { label: 'DEFAULT', run: () => { const all = Object.assign({}, S().get().airspaceStyle || {}); delete all[S().get().airspaceType]; S().set({ airspaceStyle: all }); } } },
    });
  }

  /* ------------------------------ Setup > Graphics > Waypoints and Airports (7.1.7.4) */
  function waypointLook(scr) {
    const KINDS = ['none', 'name', 'code', 'elev', 'arrival', 'required', 'reqMc', 'reqLD', 'freq'];
    const KN = { none: 'None', name: 'Name', code: 'Code', elev: 'Elevation', arrival: 'Arrival altitude', required: 'Required altitude', reqMc: 'Required Mc', reqLD: 'Required L/D', freq: 'Frequency' };
    return new FormView(scr, {
      title: 'Waypoints and Airports',
      fields: [
        check('', 'showWaypoints', 'Show waypoints'),
        spin('Max. visible', 'wptMax', 10, 300, 10, (v) => String(v), { coarse: 5 }),
        spin('Symbol size', 'wptSize', 3, 12, 1, (v) => v + ' px'),
        Object.assign({ type: 'select', label: 'Upper label', options: KINDS, show: (v) => KN[v] }, bind('wptUpper')),
        Object.assign({ type: 'select', label: 'Lower label', options: KINDS, show: (v) => KN[v] }, bind('wptLower')),
        check('', 'wptSingle', 'Single label (one line)'),
        check('', 'wptColorize', 'Colorize label (green: reachable at Mc, yellow: at Mc 0)'),
        spin('Min. runway length', 'minRwLen', 0, 2000, 50, (v) => (v ? num(v, 0) + ' m' : 'off'), { coarse: 4 }),
        section('Arrival / required altitude use the safety Mc and the wind; no wind profile. Short runways get a red cross. Labels per waypoint type and runway width are not supported.'),
      ],
    });
  }

  /* ------------------------------------------------- Setup > Graphics > Weather (7.1.7.2) */
  function weatherSetup(scr, ctx) {
    const wx = ctx.weather;
    if (!wx.satLayers) wx.loadSatLayers();
    const satOpts = ['']; // filled in place, also when the list arrives after the form was opened
    const fillSat = () => { satOpts.length = 1; wx.satOptions(S().get().wxSatAll).forEach((n) => satOpts.push(n)); };
    fillSat();
    wx.onSatLayers = fillSat;
    const status = (k) => info('', () => wx.status[k], { wide: true });
    return new FormView(scr, {
      title: 'Weather',
      live: true,
      fields: [
        section('Satellite (EUMETSAT Meteosat)'),
        check('', 'wxSat', 'Show satellite layer'),
        Object.assign({ type: 'select', label: 'Layer', options: satOpts, wide: true, show: (v) => (v ? LX.Weather.describeSat(v).label : 'Automatic (' + (wx.satLayerName(S().get()) ? LX.Weather.describeSat(wx.satLayerName(S().get())).label : 'loading') + ')') }, bind('wxSatLayer')),
        info('', () => { const n = wx.satLayerName(S().get()); return n ? LX.Weather.describeSat(n).desc : 'Loading the layer list...'; }, { wide: true }),
        Object.assign({ type: 'check', label: '', text: 'All layers (advanced)', get: () => S().get().wxSatAll, set: (v) => { S().set({ wxSatAll: v }); fillSat(); } }),
        spin('Opacity', 'wxSatOpacity', 10, 100, 10, (v) => v + '%', { coarse: 2 }),
        status('sat'),
        section('Forecast (Open-Meteo, coarse grid)'),
        check('', 'wxFc', 'Show forecast layer'),
        Object.assign({ type: 'select', label: 'Parameter', options: ['cloud_cover', 'cape', 'boundary_layer_height', 'precipitation'], show: (v) => ({ cloud_cover: 'Cloud cover', cape: 'CAPE (convective energy)', boundary_layer_height: 'Boundary layer height (thermal depth)', precipitation: 'Precipitation' }[v]), wide: true }, bind('wxFcParam')),
        spin('Forecast time', 'wxFcOffset', 0, 24, 1, (v) => (v ? '+' + v + ' h' : 'now'), { coarse: 3 }),
        spin('Opacity', 'wxFcOpacity', 10, 100, 10, (v) => v + '%', { coarse: 2 }),
        status('fc'),
        section('Rain radar (RainViewer)'),
        check('', 'wxRain', 'Show rain radar'),
        spin('Opacity', 'wxRainOpacity', 10, 100, 10, (v) => v + '%', { coarse: 2 }),
        spin('History span', 'wxRainHistory', 0, 120, 10, (v) => (v ? v + ' min (animated)' : 'off'), { coarse: 3 }),
        spin('Freeze present time', 'wxRainFreeze', 0, 10, 1, (v) => v + ' s'),
        status('rain'),
        section('All layers'),
        info('Map tiles', () => LX.Map.rasterStats.loaded + ' loaded, ' + LX.Map.rasterStats.failed + ' failed (a high failed count means the service refused or is slow)', { wide: true }),
        Object.assign({ type: 'select', label: 'Minimum zoom distance', options: [0].concat(LX.Map.ZOOMS), show: (v) => (v ? 'map scale ' + v + ' km or wider' : 'always visible') }, bind('wxMinScale')),
        info('Map now', () => 'scale bar ' + LX.Map.ZOOMS[S().get().mapZoom] + ' km (the weather layers show at the chosen step and wider)', { wide: true }),
        section('Free services, no account. They need internet and are for training only, never for flight planning.'),
      ],
    });
  }

  /* ----------------------------------------------------------- Setup > Graphics */
  function graphics(scr, ctx) {
    return new MenuView(scr, [
      { label: 'Map and Terrain', color: '#7ee07e', run: (s) => s.open(mapAndTerrain(s)) },
      { label: 'Airspace', color: '#ff5a4a', run: (s) => s.open(airspaceLook(s)) },
      { label: 'Waypoints and Airports', color: '#5fd0ff', run: (s) => s.open(waypointLook(s)) },
      { label: 'Glider and Track', color: '#ffb000', run: (s) => s.open(gliderTrack(s)) },
      { label: 'Thermal Mode', color: '#ff9a1f', run: (s) => s.open(thermalModeSetup(s)) },
      { label: 'Optimization', color: '#ffd400', run: (s) => s.open(optimizationLook(s)) },
      { label: 'Task', color: '#ff2fd5', run: (s) => s.open(taskLook(s)) },
      { label: 'FLARM', color: '#5fd0ff', run: (s) => s.open(flarmLook(s)) },
      { label: 'Weather', color: '#5fd0ff', run: (s) => s.open(weatherSetup(s, ctx)) },
      { label: 'Misc.', color: '#8a8f99', run: (s) => s.open(miscLook(s)) },
    ], { title: 'Graphics' });
  }

  function display(scr) {
    return new FormView(scr, {
      title: 'Display',
      fields: [
        Object.assign({ type: 'select', label: 'Orientation', options: ['landscape', 'portrait', 'auto'] }, bind('orientation')),
        check('', 'night', 'Night mode (reduced backlight)'),
      ],
    });
  }

  function about(scr, ctx) {
    return new FormView(scr, {
      title: 'About',
      fields: [
        info('Device', () => 'FG9070 trainer (UNOFFICIAL)', { wide: true }),
        info('Simulates', () => 'LX90xx/80xx user manual v9.5 behaviour', { wide: true }),
        info('Data', () => ctx.statusText(), { wide: true }),
        info('Update rate', () => ctx.flight.have ? `${ctx.rate || 0} Hz` : '--'),
        info('Position', () => ctx.flight.have ? `${ctx.flight.f.lat.toFixed(4)}  ${ctx.flight.f.lon.toFixed(4)}` : '--'),
        section('Unofficial. Training aid only; never for navigation.'),
      ],
      live: true,
    });
  }

  /* --------------------------------------------- Setup > Flight Recorder / Optimization */
  function flightRecorder(scr, ctx) {
    const nameField = (label, key) => ({ type: 'action', label, text: S().get()[key] || '(not set)', wide: true, run: (s, form) => {
      const v = global.prompt(label, S().get()[key] || ''); if (v !== null) { S().set({ [key]: v.trim() }); form.render(); } } });
    const f = new FormView(scr, {
      title: 'Flight Recorder',
      fields: [
        select('Recording interval', 'recInterval', [1, 2, 4, 8, 16, 32], (v) => v + ' s'),
        nameField('Pilot', 'pilot'),
        nameField('Co-pilot', 'copilot'),
        section('Wind, speed and vertical speed are recorded with every fix.'),
        section('IGC export from this simulator is UNOFFICIAL and not valid for badges or records.'),
      ],
      buttons: { 6: { label: 'SWAP', run: () => { const s = S().get(); S().set({ pilot: s.copilot, copilot: s.pilot }); } } },
    });
    // keep the displayed names fresh
    f.fields[1].text = undefined; f.fields[2].text = undefined;
    Object.defineProperty(f.fields[1], 'text', { get: () => S().get().pilot || '(not set)' });
    Object.defineProperty(f.fields[2], 'text', { get: () => S().get().copilot || '(not set)' });
    return f;
  }

  function optimization(scr) {
    return new FormView(scr, {
      title: 'Optimization',
      fields: [
        select('Number of points', 'optPoints', [3, 5], (v) => (v === 5 ? '5 (OLC)' : '3 (FAI free flight)')),
        select('FAI triangle group', 'optFaiMin', [0.28, 0.25, 0.2], (v) => ({ 0.28: 'Normal (shortest side 28%)', 0.25: 'Relaxed (25%)', 0.2: 'Marginal triangles allowed (20%)' }[v]), { wide: true }),
        check('', 'optReset', 'Reset optimization on engine run'),
        check('', 'showOpt', 'Show optimization on the map'),
        check('', 'showFai', 'Show FAI triangle area (assistant)'),
        Object.assign({ type: 'spin', label: 'FAI area opacity', min: 0, max: 60, step: 2, coarse: 10, fmt: (v) => v + '%' }, bind('faiAlpha')),
        check('', 'faiKmLines', 'Show km lines'),
        section('Distance only; the 10 km turn point separation is not applied (as in the manual).'),
      ],
    });
  }

  /* ---------------------------------------------------------------- Setup root */
  function setupRoot(scr, ctx) {
    const stub = (n) => (s) => notImplemented(s, n);
    const items = [
      ['QNH and RES', '#4aa3ff', (s) => s.open(qnhRes(s, ctx))],
      ['Flight Recorder', '#ff7a5c', (s) => s.open(flightRecorder(s, ctx))],
      ['Weight and Balance', '#ffb000', (s) => s.open(LX.setup2.weightBalance(s, ctx))],
      ['Vario Parameters', '#7ee07e', (s) => s.open(varioParams(s))],
      ['Display', '#5fd0ff', (s) => s.open(LX.setup2.display(s))],
      ['Files and Transfer', '#ffd400', (s) => s.open(LX.filesUI.filesRoot(s, ctx))],
      ['Graphics', '#ffb000', (s) => s.open(graphics(s, ctx))],
      ['Sounds', '#ffb000', (s) => s.open(soundsMenu(s, ctx))],
      ['Observation Zones', '#ff5a4a', (s) => s.open(LX.setup2.observationZones(s))],
      ['Optimization', '#8fb6ff', (s) => s.open(optimization(s))],
      ['Warnings', '#ffb000', (s) => s.open(LX.warningsUI.warningsMenu(s, ctx))],
      ['Units', '#ffb000', (s) => s.open(unitsDialog(s))],
      ['Hardware', '#ffb000', (s) => s.open(hardwareMenu(s, ctx))],
      ['Polar and Glider', '#5fd0ff', (s) => s.open(polarGlider(s, ctx))],
      ['Profiles and Pilots', '#ffd400', (s) => s.open(LX.setup2.profiles(s, ctx))],
      ['Connect', '#5fd0ff', (s) => LX.setup2.connect(s)],
      ['Language', '#ffd400', (s) => LX.setup2.language(s)],
      ['Password', '#ffd400', (s) => LX.setup2.password(s)],
      ['Admin mode', '#8a8f99', (s) => LX.setup2.admin(s)],
      ['About', '#ffffff', (s) => s.open(about(s, ctx))],
    ].map(([label, color, run]) => ({ label, color, run }));
    return new MenuView(scr, items, { title: 'Setup', root: true });
  }

  /* ------------------------------------------- dialogs from navigation pages */
  function mcDialog(scr, ctx) {
    return new FormView(scr, {
      title: 'MacCready / Ballast / Bugs',
      autoClose: 10000,
      fields: [
        spin('MacCready', 'mc', 0, 5, 0.1, (v) => num(U().vario(v), 1) + ' ' + U().label('vario')),
        {
          type: 'spin', label: 'Ballast', min: 0, step: 5, coarse: 4,
          get: () => S().get().ballast,
          set: (v) => S().set({ ballast: Math.min(v, LX.polar.GLIDERS[S().get().glider].maxBallast) }),
          get max() { return LX.polar.GLIDERS[S().get().glider].maxBallast; },
          fmt: (v) => v + ' kg',
        },
        spin('Bugs', 'bugs', 0, 30, 1, (v) => v + '%'),
        info('Glide ratio at Mc', () => { const n = ctx.flight.navTo(ctx.nav.target('tsk')); return n ? `${num(n.Emc, 0)} @ ${num(U().speed(n.stfFG), 0)} ${U().label('speed')}` : '---'; }),
        info('Speed to fly now', () => `${num(U().speed(ctx.flight.f.stf), 0)} ${U().label('speed')}`),
        info('Suggested Mc (last 4 thermals)', () => { const a = ctx.flight.lastThermalsAvg(4); return a === null ? '---' : `${num(U().vario(a), 1)} ${U().label('vario')}`; }, { wide: true }),
      ],
      buttons: {
        5: { label: 'CLEAN', run: () => S().set({ bugs: 0 }) },
        6: { label: 'SUGGEST', run: () => { const a = ctx.flight.lastThermalsAvg(4); if (a !== null) S().set({ mc: Math.round(Math.max(0, a) * 10) / 10 }); } },
      },
      live: true,
    });
  }

  function windDialog(scr, ctx) {
    return new FormView(scr, {
      title: 'Wind',
      fields: [
        info('Wind (simulator)', () => { const f = ctx.flight.f; return `${Math.round(f.windDir)}° / ${num(U().speed(f.windSpd), 0)} ${U().label('speed')}`; }, { wide: true }),
        info('Head/tail wind to target', () => { const n = ctx.navFor(ctx.currentModeId(), ctx.flight.f); return n ? `${LX.fmt.signed(U().speed(n.headwind), 0)} ${U().label('speed')}` : '---'; }),
        info('Cross wind', () => { const n = ctx.navFor(ctx.currentModeId(), ctx.flight.f); return n ? `${LX.fmt.signed(U().speed(n.crosswind), 0)} ${U().label('speed')}` : '---'; }),
        section('Wind comes from FlightGear /environment. Wind estimation (circling / HAWK) is not simulated.'),
      ],
      live: true,
    });
  }

  function mapDialog(scr, ctx) { return mapAndTerrain(scr); }

  function airspaceList(scr, ctx) {
    const f = ctx.flight.f;
    const fields = (ctx.nav.airspaces || []).map((a) => {
      const c = a.circle || { lat: a.poly[0][0], lon: a.poly[0][1] };
      const d = LX.geo.dist(f.lat, f.lon, c.lat, c.lon);
      return info(`${a.cls}  ${a.name}`, () => `${num(U().dist(d), 0)} ${U().label('dist')}   ${num(U().alt(a.lower), 0)}-${num(U().alt(a.upper), 0)} ${U().label('alt')}`, { wide: true });
    });
    if (!fields.length) fields.push(info('Airspace', () => 'none loaded', { wide: true }));
    return new FormView(scr, { title: 'Airspace (demo data)', fields });
  }

  function flarmList(scr, ctx) {
    const fields = ctx.traffic.relative(ctx.flight.f, 0).map((t) => info(t.id, () => `${num(U().dist(t.dist), 1)} ${U().label('dist')}  ${LX.fmt.signed(U().alt(t.dh), 0)} ${U().label('alt')}`, { wide: true }));
    return new FormView(scr, { title: 'FLARM (' + ({ demo: 'simulated', fg: 'FlightGear', off: 'off' }[ctx.traffic.mode()] || 'traffic') + ')', fields });
  }

  /** SELECT button: pick an airport (APT mode) or waypoint (WPT mode) as target. */
  function targetList(scr, ctx, modeId) {
    const f = ctx.flight.f;
    const list = (modeId === 'wpt' ? ctx.nav.waypoints : ctx.nav.airports)
      .map((w) => ({ w, d: LX.geo.dist(f.lat, f.lon, w.lat, w.lon) })).sort((a, b) => a.d - b.d);
    const items = list.map((x) => ({
      label: x.w.name, color: x.w.type === 'tp' ? '#ffe14a' : '#5fd0ff',
      value: () => `${num(U().dist(x.d), 1)} ${U().label('dist')}`,
      run: (s) => { ctx.nav.selected[modeId === 'wpt' ? 'wpt' : 'apt'] = x.w; s.close(); s.toast(`Target: ${x.w.name}`, 1200); },
    }));
    return new MenuView(scr, items, { title: modeId === 'wpt' ? 'Select waypoint' : 'Select airport' });
  }

  /** LAYOUT (lite): choose the number of navboxes on this page and what each one shows. */
  function layoutDialog(scr, ctx, view) {
    const key = view.layoutKey();
    const cur = () => LX.navboxes.layoutFor(view.modeId, view.kind);
    const save = (arr) => {
      const L = Object.assign({}, S().get().layouts || {});
      L[key] = arr;
      S().set({ layouts: L });
      view.buildRow();
    };
    const ids = LX.navboxes.ids().sort((a, b) => a.localeCompare(b));
    const fields = [{ type: 'spin', label: 'Number of boxes', min: 3, max: 8, step: 1, coarse: 1, get: () => cur().length, set: (v) => {
      const a = cur();
      while (a.length < v) a.push(LX.navboxes.defaults(view.kind)[a.length] || 'Alt');
      save(a.slice(0, v));
    }, fmt: (v) => String(v) }];
    for (let i = 0; i < 8; i++) {
      fields.push({
        type: 'select', label: `Box ${i + 1}`, options: ids,
        get: () => cur()[i] || '(none)',
        set: (v) => { const a = cur(); if (i < a.length) { a[i] = v; save(a); } },
        show: (v) => (LX.navboxes.defs[v] ? `${v}  \u2013  ${LX.navboxes.defs[v].desc}`.slice(0, 44) : v),
      });
    }
    return new FormView(scr, {
      title: `Layout - ${view.modeId.toUpperCase()} page ${view.kind}`,
      fields,
      buttons: { 6: { label: 'RESET', run: () => { const L = Object.assign({}, S().get().layouts || {}); delete L[key]; S().set({ layouts: L }); view.buildRow(); } } },
      live: true,
    });
  }

  LX.setup = { weather: weatherSetup, layoutDialog, setupRoot, mcDialog, windDialog, mapDialog, airspaceList, flarmList, targetList, volumes };
})(window);
