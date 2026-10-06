/**
 * More Setup dialogs: Profiles and Pilots (7.1.14), Weight and Balance
 * (7.1.3), Observation Zones (7.1.8.4), Display brightness (7.1.5).
 *
 * Profiles store the device settings and the navbox layouts, like the real
 * unit; connection settings stay global. A profile can be exported to / loaded
 * from a file (JSON, extension .lxprofile.json – NOT compatible with the real
 * unit's .lxprofile files).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const S = () => LX.settings;
  const U = () => LX.units;
  const num = (v, d) => LX.fmt.num(v, d);
  const bind = (key) => ({ get: () => S().get()[key], set: (v) => S().set({ [key]: v }) });
  const spin = (label, key, min, max, step, fmt, extra) => Object.assign({ type: 'spin', label, min, max, step, fmt }, bind(key), extra || {});
  const check = (text, key) => Object.assign({ type: 'check', label: '', text }, bind(key));
  const section = (label) => ({ type: 'section', label });
  const info = (label, get, extra) => Object.assign({ type: 'info', label, get }, extra || {});

  /* ----------------------------------------------------------------- profiles */
  const PKEY = 'fg9070.profiles.v1';
  const GLOBAL_KEYS = ['host', 'port', 'transport', 'hz', 'mapZoom', 'page', 'openaipKey', 'demoSpeed'];
  const load = () => { try { return JSON.parse(global.localStorage.getItem(PKEY)) || null; } catch (e) { return null; } };
  const store = (p) => { try { global.localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { /* ignore */ } };
  const snapshot = () => {
    const s = Object.assign({}, S().get());
    GLOBAL_KEYS.forEach((k) => delete s[k]);
    return JSON.parse(JSON.stringify(s));
  };
  function profiles() {
    let p = load();
    if (!p) { p = { active: 'DEFAULT', list: { DEFAULT: { pilot: '', settings: snapshot() } } }; store(p); }
    return p;
  }

  function profilesDialog(scr, ctx) {
    let p = profiles();
    const build = () => {
      p = profiles();
      return Object.keys(p.list).map((name) => ({
        label: name, color: name === p.active ? '#29d35a' : '#ffd400',
        value: () => (name === p.active ? 'ACTIVE' : (p.list[name].pilot || '')),
        run: (s) => { s.toast('Press LOAD to activate this profile', 1500); },
      }));
    };
    const view = new MenuView(scr, build(), {
      title: 'Profiles and Pilots',
      extra: {
        0: { label: 'ADD', run: (s, v) => {
          const n = global.prompt('New profile name (a copy of the current settings)', 'PROFILE ' + (Object.keys(p.list).length + 1));
          if (!n) return;
          const q = profiles(); q.list[n.trim().toUpperCase()] = { pilot: S().get().pilot || '', settings: snapshot() }; store(q);
          v.items = build(); v.render();
        } },
        1: { label: 'DELETE', run: (s, v) => {
          const name = v.items[v.sel] && v.items[v.sel].label;
          const q = profiles();
          if (!name || Object.keys(q.list).length < 2) { s.toast('At least one profile is required', 1800); return; }
          s.open(new Popup(s, 'Delete profile', `Delete ${name}?`, { 4: { label: 'NO', run: (x) => x.close() }, 7: { label: 'YES', run: (x) => { delete q.list[name]; if (q.active === name) q.active = Object.keys(q.list)[0]; store(q); x.close(); v.items = build(); v.render(); } } }));
        } },
        2: { label: 'EDIT', run: (s, v) => {
          const old = v.items[v.sel] && v.items[v.sel].label; if (!old) return;
          const n = global.prompt('Profile name', old); if (!n || n === old) return;
          const q = profiles(); q.list[n.trim().toUpperCase()] = q.list[old]; delete q.list[old]; if (q.active === old) q.active = n.trim().toUpperCase(); store(q);
          v.items = build(); v.render();
        } },
        3: { label: 'SAVE', run: (s, v) => { const q = profiles(); q.list[q.active].settings = snapshot(); store(q); s.toast(`Saved to ${q.active}`, 1500); v.items = build(); v.render(); } },
        5: { label: 'TO FILE', run: (s, v) => { const name = v.items[v.sel].label; LX.filesUI.download(`${name}.lxprofile.json`, JSON.stringify(profiles().list[name], null, 1), 'application/json'); } },
        6: { label: 'LOAD FILE', run: async (s, v) => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
          inp.onchange = async () => { try { const j = JSON.parse(await inp.files[0].text()); const n = inp.files[0].name.replace(/\.lxprofile\.json$|\.json$/i, '').toUpperCase(); const q = profiles(); q.list[n] = j; store(q); v.items = build(); v.render(); s.toast(`Profile ${n} loaded`, 1800); } catch (e) { s.toast('Not a profile file', 2000); } };
          inp.click();
        } },
      },
    });
    // SELECT activates the highlighted profile
    view.select = function () {
      const name = this.items[this.sel] && this.items[this.sel].label; if (!name) return;
      const q = profiles(); q.list[q.active].settings = snapshot(); // keep edits to the one we leave
      q.active = name; store(q);
      S().set(Object.assign({}, q.list[name].settings));
      this.items = build(); this.render();
      scr.toast(`Profile ${name} active`, 1800);
    };
    view.softkeys = function () { const l = ['ADD', 'DELETE', 'EDIT', 'SAVE', 'CLOSE', 'TO FILE', 'LOAD FILE', 'LOAD']; return { labels: l, persist: true }; };
    return view;
  }

  /** Manual 11.1.2: with several profiles the unit asks which to use at power-on. */
  function powerOnProfiles(scr, ctx) {
    if (Object.keys(profiles().list).length < 2) return;
    const v = profilesDialog(scr, ctx);
    scr.open(v);
    scr.toast('Choose a profile: SELECT activates it, CLOSE keeps the current one', 3500);
  }

  /* --------------------------------------------------------- weight and balance */
  function weightBalance(scr, ctx) {
    const kg = (v) => v + ' kg';
    const maxBal = () => LX.polar.GLIDERS[S().get().glider].maxBallast;
    return new FormView(scr, {
      title: 'Weight and Balance',
      live: true,
      fields: [
        spin('Empty weight', 'wbEmpty', 100, 900, 1, kg, { coarse: 10 }),
        spin('Pilot', 'wbPilot', 30, 150, 1, kg, { coarse: 5 }),
        spin('Co-pilot', 'wbCopilot', 0, 150, 1, kg, { coarse: 5 }),
        spin('Parachute', 'wbChute', 0, 20, 1, kg, { coarse: 5 }),
        { type: 'spin', label: 'Water ballast', min: 0, step: 5, coarse: 4, get: () => S().get().ballast, set: (v) => S().set({ ballast: Math.min(v, maxBal()) }), get max() { return maxBal(); }, fmt: kg },
        spin('Wing area', 'wbArea', 5, 30, 0.1, (v) => num(v, 1) + ' m²', { coarse: 10 }),
        info('Total mass', () => { const s = S().get(); return kg(s.wbEmpty + s.wbPilot + s.wbCopilot + s.wbChute + s.ballast); }),
        info('Wing loading', () => { const s = S().get(); return num((s.wbEmpty + s.wbPilot + s.wbCopilot + s.wbChute + s.ballast) / s.wbArea, 1) + ' kg/m²'; }),
        section('The polar is scaled by the WATER BALLAST only (relative to its reference mass).'),
        section('Centre of gravity limits are not simulated.'),
      ],
    });
  }

  /* ----------------------------------------------------------- observation zones */
  const TEMPLATES = {
    '500 m cylinders': { start: { r1: 500, a1: 180, line: false, dir: 'symmetric' }, tp: { r1: 500, a1: 180, line: false, dir: 'symmetric' }, finish: { r1: 500, a1: 180, line: false, dir: 'symmetric' } },
    '500 m and start line': { start: { r1: 500, a1: 180, line: true, dir: 'next' }, tp: { r1: 500, a1: 180, line: false, dir: 'symmetric' }, finish: { r1: 500, a1: 180, line: true, dir: 'prev' } },
    'FAI and start line': { start: { r1: 500, a1: 180, line: true, dir: 'next' }, tp: { r1: 3000, a1: 90, line: false, dir: 'symmetric' }, finish: { r1: 500, a1: 180, line: true, dir: 'prev' } },
  };
  function zoneDefaultsDialog(scr, kind) {
    const z = () => { const d = S().get().zoneDefaults || {}; return Object.assign({}, LX.TaskTools.defaultZone(kind), d[kind] || {}); };
    const put = (patch) => { const d = Object.assign({}, S().get().zoneDefaults || {}); d[kind] = Object.assign(z(), patch); S().set({ zoneDefaults: d }); };
    const dist = (v) => num(U().dist(v), 1) + ' ' + U().label('dist');
    return new FormView(scr, {
      title: { start: 'Start zone', tp: 'Turn point zone', finish: 'Finish zone' }[kind],
      fields: [
        { type: 'spin', label: 'Radius1', min: 50, max: 150000, step: 100, coarse: 50, get: () => z().r1, set: (v) => put({ r1: v }), fmt: dist },
        { type: 'spin', label: 'Angle1', min: 0, max: 180, step: 0.5, coarse: 45, get: () => z().a1, set: (v) => put({ a1: v }), fmt: (v) => v + '°' },
        { type: 'select', label: 'Direction', options: ['symmetric', 'fixed', 'next', 'prev', 'start'], get: () => z().dir, set: (v) => put({ dir: v }), show: (v) => v[0].toUpperCase() + v.slice(1) },
        { type: 'check', label: '', text: 'Line', get: () => z().line, set: (v) => put({ line: v }) },
        { type: 'check', label: '', text: 'Auto next', get: () => z().autoNext, set: (v) => put({ autoNext: v }) },
      ],
    });
  }
  function observationZones(scr) {
    return new MenuView(scr, [
      { label: 'Start zone', color: '#ff5a4a', run: (s) => s.open(zoneDefaultsDialog(s, 'start')) },
      { label: 'Turn point zone', color: '#ffb000', run: (s) => s.open(zoneDefaultsDialog(s, 'tp')) },
      { label: 'Finish zone', color: '#7ee07e', run: (s) => s.open(zoneDefaultsDialog(s, 'finish')) },
      ...Object.keys(TEMPLATES).map((n) => ({ label: 'Template: ' + n, color: '#5fd0ff', run: (s) => { S().set({ zoneDefaults: JSON.parse(JSON.stringify(TEMPLATES[n])) }); s.toast(`Template applied: ${n}`, 1800); } })),
    ], { title: 'Observation Zones' });
  }

  /* -------------------------------------------------------------------- display */
  function display(scr) {
    return new FormView(scr, {
      title: 'Display',
      fields: [
        check('Automatic brightness', 'autoBright'),
        spin('Brightness (manual)', 'brightness', 10, 100, 5, (v) => v + '%', { coarse: 4 }),
        spin('Night mode brightness', 'nightBright', 5, 100, 5, (v) => v + '%', { coarse: 4 }),
        Object.assign({ type: 'select', label: 'Display orientation', options: ['landscape', 'portrait', 'auto'] }, bind('orientation')),
        check('Night mode', 'night'),
        section('The simulator has no ambient light sensor: "automatic" = full brightness by day.'),
      ],
    });
  }
  /** Apply brightness to the LCD (called from device.js on settings changes). */
  function brightness() {
    const s = S().get(), lcd = document.getElementById('lcd');
    if (!lcd) return;
    const b = (s.night ? s.nightBright : s.autoBright ? 100 : s.brightness) / 100;
    lcd.style.filter = `brightness(${b.toFixed(2)})${s.night ? ' saturate(.75) sepia(.2)' : ''}`;
  }

  const popup = (title, text) => (s) => s.open(new Popup(s, title, text, { 7: { label: 'OK', run: (x) => x.close() } }));

  LX.setup2 = {
    profiles: profilesDialog, powerOnProfiles, weightBalance, observationZones, display, brightness,
    language: popup('Language', 'English only in this simulator.'),
    password: popup('Password', 'Passwords protect profiles on the real unit.\nNot simulated.'),
    admin: popup('Admin mode', 'Manufacturer / dealer functions.\nNot simulated.'),
    connect: popup('Connect', 'Needs an account and a Wi-Fi module.\nNot simulated.'),
    applyProfileAtStart() { const p = load(); if (p && p.list[p.active]) S().set(Object.assign({}, p.list[p.active].settings)); },
  };
})(window);
