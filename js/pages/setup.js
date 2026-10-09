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
  function graphics(scr) {
    return new FormView(scr, {
      title: 'Graphics',
      fields: [
        Object.assign({ type: 'select', label: 'Map orientation', options: ['track', 'north'], show: (v) => (v === 'track' ? 'Track up' : 'North up') }, bind('mapUp')),
        Object.assign({ type: 'select', label: 'Base map', options: ['off', 'opentopomap', 'osm'], wide: true, show: (v) => ({ off: 'Procedural terrain (offline)', opentopomap: 'OpenTopoMap tiles (online)', osm: 'OpenStreetMap tiles (online)' }[v]) }, bind('tiles')),
        Object.assign({ type: 'select', label: 'Terrain data', options: ['terrarium', 'off'], wide: true, show: (v) => (v === 'off' ? 'Procedural terrain only (offline)' : 'Elevation tiles (online, falls back to procedural)') }, bind('terrain')),
        check('', 'showAirspace', 'Show airspace'),
        check('', 'showThermals', 'Show thermal markers'),
        section('Tiles need internet access in the browser; attribution is drawn on the map.'),
      ],
    });
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
      ['Graphics', '#ffb000', (s) => s.open(graphics(s))],
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

  function mapDialog(scr, ctx) { return graphics(scr); }

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

  LX.setup = { layoutDialog, setupRoot, mcDialog, windDialog, mapDialog, airspaceList, flarmList, targetList, volumes };
})(window);
