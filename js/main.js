/**
 * FG9070 trainer bootstrap.
 *
 * Wires: settings -> data source (FlightGear HTTP/WebSocket or demo) ->
 * Flight (TE vario, netto, STF, final glide...) -> pages + audio.
 */
(function () {
  'use strict';
  const LX = window.LX;
  const AP = window.AeroPanel;
  const geo = LX.geo;
  const Files = LX.Files;

  LX.settings.load();
  const settings = LX.settings;
  LX.device.init();

  /* ----------------------------------------------------------------- model */
  const nav = new LX.Nav();
  const flight = new LX.Flight(settings);
  const audio = new LX.VarioAudio(settings);
  const traffic = new LX.Traffic();
  let ai = null;
  traffic.filter = () => ({ glidersOnly: settings.get().trafficFilter !== 'all', keywords: settings.get().trafficKeywords });
  traffic.mode = () => { const t = settings.get().trafficSource; return t === 'auto' ? (settings.get().transport === 'demo' ? 'demo' : 'fg') : t; };
  const runner = new LX.TaskRunner(nav);
  const warnings = new LX.Warnings(settings, nav);
  const recorder = new LX.Recorder(settings, nav);
  const dem = new LX.DEM(settings);

  const ctx = {
    settings, flight, nav, audio, traffic, runner, warnings, recorder, dem,
    weather: new LX.Weather(settings),
    history: [], flownDist: 0, ref: null, events: 0, rate: 0,
    srcStatus: { mode: 'idle', message: '', hz: 0 },
    sampleWall: 0,
    /** Terrain height below: FlightGear's own ground elevation, else the DEM, else the home field. */
    groundElev(f) {
      if (Number.isFinite(f.gelev)) return f.gelev;
      const e = dem.elevation(f.lat, f.lon, 150);
      if (e !== undefined) return e;
      return nav.waypoints[0] ? nav.waypoints[0].elev : 0;
    },
    statusText() {
      const s = this.srcStatus;
      const label = { live: 'LIVE', demo: 'DEMO', connecting: 'CONNECTING', error: 'NO LINK', idle: 'IDLE' }[s.mode] || s.mode;
      return `${label}${s.message ? ' · ' + s.message : ''}${s.hz ? ' · ' + s.hz + ' ' + (s.unit || 'Hz') : ''}`;
    },
    /** Navigation numbers for a mode's target. Task mode: final glide over the whole remaining task. */
    navFor(modeId, f) {
      if (modeId !== 'tsk') return flight.navTo(nav.target(modeId));
      const tg = nav.target('tsk');
      if (!tg || !nav.task.length) return null;
      const fin = nav.task[nav.task.length - 1].wp;
      const n = flight.navTo(tg, { dist: LX.TaskTools.remaining(nav, flight.f), elev: fin.elev });
      if (n && !nav.started) {
        // before the start: arrival altitude AT THE START LINE from the current energy loss rate (manual 11.2.1)
        const E = isFinite(flight.f.glideRatioNow) && flight.f.glideRatioNow > 1 ? Math.min(60, flight.f.glideRatioNow) : n.Emc;
        n.arrival = flight.f.alt - n.dist / Math.max(1, E);
        n.pct = 0;
      }
      return n;
    },
    /** Show task messages: toasts, or a popup with buttons (START / NEXT). */
    messages(list) {
      (list || []).forEach((m) => {
        const alarm = m.id === 'started' ? 'alarmStart' : m.id === 'finished' ? 'alarmFinish'
          : (m.id === 'next?' || (m.id === 'inside' && m.text === 'Inside zone')) ? 'alarmTurn'
          : /^Event marked/.test(m.text) ? 'alarmEvent' : null;
        if (alarm && ctx.settings.get()[alarm]) audio.playAlarm();
        if (source instanceof LX.DemoXC && !this._demoManual) {
          // the demo "pilot" presses the buttons for us
          if (m.id === 'start?') { this.messages(runner.start(flight.f, performance.now())); return; }
          if (m.id === 'next?') { runner.next(); return; }
          if (m.id === 'finished') setTimeout(() => this.messages(runner.restart()), 8000);
        }
        if (m.id === 'start?' || m.id === 'next?') {
          const b = m.buttons || ['CLOSE', 'OK'];
          const act = b[1] === 'START' ? () => this.messages(runner.start(flight.f, performance.now())) : () => runner.next();
          screen.open(new LX.forms.Popup(screen, 'Task', m.text, {
            4: { label: b[0], run: (s) => s.close() },
            7: { label: b[1], run: (s) => { s.close(); act(); } },
          }));
        } else screen.toast(m.text, m.id === 'warn' ? 3500 : 2500);
      });
    },
    currentModeId() { return screen.mode.id; },
    goMode(id, page) {
      screen.stack.length = 0;
      const i = screen.modes.findIndex((m) => m.id === id);
      if (i >= 0) { screen.modeIdx = i; if (page != null) screen.pageIdx[id] = page; screen._showCurrent(); }
    },
  };

  /* ---------------------------------------------------------------- screen */
  const lcd = document.getElementById('lcd');
  const screen = new LX.Screen(lcd, ctx);
  screen.onPowerOn = () => LX.setup2.powerOnProfiles(screen, ctx);
  if (!/[?&](demo|noprofile)=?/.test(location.search)) setTimeout(() => LX.setup2.powerOnProfiles(screen, ctx), 900); // several profiles: ask at power-on

  const navPages = (modeId) => {
    const saved = (settings.get().pageSets || {})[modeId], cp = settings.get().customPages || {};
    const refs = (saved && saved.length ? saved : LX.NAV_PAGES[modeId].map((k) => ({ kind: k }))).filter((r) => r.kind !== 'checklist' && (r.kind !== 'custom' || cp[r.id]));
    return refs.map((r) => new LX.NavView(screen, ctx, modeId, r.kind, r.id));
  };
  screen.addMode({ id: 'apt', name: 'Airport', pages: navPages('apt') });
  screen.addMode({ id: 'wpt', name: 'Waypoint', pages: navPages('wpt') });
  screen.addMode({ id: 'tsk', name: 'Task', pages: navPages('tsk') });
  screen.addMode({ id: 'stat', name: 'Statistics', pages: ['general', 'task', 'olc'].map((k) => new LX.StatsView(screen, ctx, k)) });
  screen.addMode({ id: 'setup', name: 'Setup', pages: [LX.setup.setupRoot(screen, ctx)] });
  screen.addMode({ id: 'info', name: 'Information', pages: [LX.info.gpsPage(screen, ctx), LX.info.reportPage(screen, ctx), LX.info.skyPage(screen, ctx), LX.info.networkPage(screen, ctx)] });
  screen.addMode({ id: 'near', name: 'Near', pages: [new LX.NearView(screen, ctx)] });
  screen.modeIdx = 2; // Task mode, like a unit with a declared task
  screen.start();
  LX.docsUI.ChecklistView.sync(screen, ctx);

  LX.warningsUI.install(screen, ctx);
  LX.device.on('knob', (e) => screen.knob(e.name, e.dir));
  LX.device.on('button', (e) => screen.button(e.index, e.long));
  LX.device.on('resize', () => { screen.resize(); });

  /* ----------------------------------------------------------------- audio */
  audio.provider = () => {
    const f = flight.f;
    f.valid = flight.have && performance.now() - ctx.sampleWall < 2500;
    return f;
  };
  const hint = document.getElementById('hint');
  LX.device.unlockAudio = () => { audio.unlock(); hint.hidden = true; };
  hint.hidden = false;
  window.addEventListener('pointerdown', () => LX.device.unlockAudio(), { once: false });

  /* --------------------------------------------------------- data connection */
  let source = null;
  let prevArr = null;
  let prevThermals = 0;

  function onValues(v) {
    const now = performance.now();
    ctx.sampleWall = now;
    flight.ingest(v, now);
    if (flight.have && !ctx.ref) {
      ctx.ref = { lat: flight.f.lat, lon: flight.f.lon };
      nav.homeCenter = { lat: flight.f.lat, lon: flight.f.lon };
      if (!nav.demo && !nav.waypoints.length) {
        // FlightGear and nothing loaded: build the demo task around wherever the sim starts
        nav.makeDemo(flight.f.lat, flight.f.lon);
        nav.setHomeElevation(Number.isFinite(flight.f.gelev) ? flight.f.gelev : flight.f.alt);
      }
      runner.reset();
      if (!(source instanceof LX.DemoXC) && settings.get().autoData) {
        Files.bootstrap(nav, ctx.ref)
          .then((m) => { if (m) screen.toast(m, 4500); })
          .catch((e) => screen.toast(`Airport data: ${e.message} (Setup > Files and Transfer)`, 6000));
      }
    }
  }

  function connect() {
    if (source) source.stop();
    flight.reset();
    runner.reset();
    ctx.history = []; ctx.flownDist = 0; ctx.flightStart = null;
    const s = settings.get();
    const opts = {
      props: LX.PROPS, host: s.host, port: s.port, hz: s.hz, nav,
      onValues, onStatus: (st) => { ctx.srcStatus = Object.assign({}, ctx.srcStatus, st); },
    };
    if (s.transport === 'demo') {
      if (nav.demo) { nav.demo = false; }
      ctx.ref = null;
      source = new LX.DemoXC(opts);
    } else {
      // leaving demo mode: drop the demo data, but keep files the user loaded
      if (nav.demo) { nav.demo = false; nav.waypoints = []; nav.airports = []; nav.task = []; nav.airspaces = []; nav.selected = { apt: null, wpt: null }; Files.restore(nav); }
      ctx.ref = null;
      source = s.transport === 'ws' ? new AP.data.WsSource(opts) : new AP.data.HttpSource(opts);
    }
    if (ai) { ai.stop(); ai = null; }
    source.start();
    if (s.transport !== 'demo' && traffic.mode() === 'fg') { ai = new LX.AiTraffic({ host: s.host, port: s.port }); ai.start(); }
    if (s.transport === 'demo' && flight.have === false) { /* ref is set on first sample */ }
  }

  LX.geo.setMethod(settings.get().distMethod);
  LX.polar.setUser(settings.get().gliders);
  settings.onChange((s, changed) => {
    if (changed.indexOf('distMethod') >= 0) LX.geo.setMethod(s.distMethod);
    if (changed.indexOf('gliders') >= 0) LX.polar.setUser(s.gliders);
    if (changed.some((k) => ['host', 'port', 'transport', 'hz', 'trafficSource'].indexOf(k) >= 0)) connect();
    if (changed.indexOf('orientation') >= 0) screen.resize();
  });

  /* ------------------------------------------------------------- frame loop */
  let last = performance.now();
  let histT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (flight.have) {
      // target depends on the displayed navigation mode
      const mid = screen.mode.id;
      if (mid === 'apt' || mid === 'wpt' || mid === 'tsk') flight.setTarget(nav.target(mid));
      // task progress is independent of the display
      if (flight.seq !== ctx._seq) {
        ctx._seq = flight.seq;
        ctx.messages(runner.update(flight.f, now));
        // announcements
        const n = flight.navTo(nav.target('tsk'));
        if (n) {
          if (prevArr !== null && prevArr < 0 && n.arrival >= 0) { LX.speech.say('Final glide reached'); if (ctx.settings.get().alarmFinalGlide) audio.playAlarm(); }
          prevArr = n.arrival;
        }
        if (flight.thermals.length > prevThermals) {
          const t = flight.thermals[flight.thermals.length - 1];
          LX.speech.say(`Thermal average ${LX.fmt.num(LX.units.vario(t.avg), 1)}`);
        }
        prevThermals = flight.thermals.length;
      }
      // flown track + distance
      if (now - histT > 2000 && flight.f.flying) {
        histT = now;
        const h = ctx.history, f = flight.f;
        if (h.length) ctx.flownDist += geo.dist(h[h.length - 1][0], h[h.length - 1][1], f.lat, f.lon);
        if (!ctx.flightStart) ctx.flightStart = { lat: f.lat, lon: f.lon };
        h.push([f.lat, f.lon, f.alt, f.te, f.gs]); // + altitude, vario, ground speed for the path colouring styles
        if (h.length > 5400) h.shift(); // 3 h at one point per 2 s
      }
    }
    if (flight.have) recorder.tick(flight.f, flight.flying, now);
    if (flight.have && now - (ctx._demT || 0) > 1000) { // keep terrain tiles near the glider and the target warm
      ctx._demT = now;
      dem.prefetch(flight.f.lat, flight.f.lon, 12000, 150);
      const tg = nav.target(screen.mode.id === 'apt' || screen.mode.id === 'wpt' ? screen.mode.id : 'tsk');
      if (tg) { dem.prefetch(tg.lat, tg.lon, 3000, 300); const mid = geo.dest(flight.f.lat, flight.f.lon, geo.bearing(flight.f.lat, flight.f.lon, tg.lat, tg.lon), geo.dist(flight.f.lat, flight.f.lon, tg.lat, tg.lon) / 2); dem.prefetch(mid.lat, mid.lon, 6000, 300); }
    }
    if (ai) { traffic.models = ai.list; traffic.pathsSrc = ai.paths; }
    if (ctx.warnTick) ctx.warnTick(now);
    screen.frame(dt, now);
    requestAnimationFrame(frame);
  }

  // The demo flies before anyone is "flying" (gs threshold); make the track appear promptly.
  flight.onLanded = (rec) => { recorder.end({ thermals: rec.thermals }); };
  recorder.load();
  LX.filesUI.enableDrop(screen, ctx);
  Files.restore(nav).catch(() => {}).then(() => { connect(); });
  requestAnimationFrame(frame);

  LX.app = { ctx, screen, flight, nav, audio, settings, connect };
})();
