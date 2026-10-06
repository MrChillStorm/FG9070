/**
 * Task edit dialog (manual 7.7.2) and waypoint edit / new / delete (7.6.1).
 *
 * Task editor actions: EDIT, OK, CANCEL, ZONE, OPTIONS, VIEW, LOAD, SAVE,
 * INVERT, INS PNT, STARTS, DEL PNT, CLEAR, MOVE UP, MOVE DN (three MORE>>
 * sets). Works on a copy; OK commits and restarts the task, CANCEL discards.
 * Not implemented: TO NANO,
 * SoaringSpot loading.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const geo = LX.geo;
  const U = () => LX.units;
  const num = (v, d) => LX.fmt.num(v, d);
  const km = (m) => num(U().dist(m), U().dist(m) < 100 ? 1 : 0) + ' ' + U().label('dist');

  /** Waypoint management on the model (used by WPT mode buttons and the task editor). */
  LX.Nav.prototype.deleteWaypoint = function (w) {
    this.waypoints = this.waypoints.filter((x) => x !== w);
    this.airports = this.airports.filter((x) => x !== w);
    this.task = this.task.filter((p) => p.wp !== w);
    if (this.selected.wpt === w) this.selected.wpt = this.waypoints[0] || null;
    if (this.selected.apt === w) this.selected.apt = this.airports[0] || null;
    if (this.active >= this.task.length) this.active = Math.max(0, this.task.length - 1);
  };
  LX.Nav.prototype.addWaypoint = function (w) {
    this.waypoints.push(w);
    if (w.type === 'airport' || w.type === 'glider' || w.type === 'field') this.airports.push(w);
    return w;
  };

  /* --------------------------------------------------------- waypoint editor */
  function editWaypoint(scr, ctx, wp, isNew) {
    const open = (src) => {
      const w = Object.assign({ name: '', code: '', lat: ctx.flight.f.lat, lon: ctx.flight.f.lon, elev: Math.round(ctx.flight.f.alt), type: 'tp' }, src || {});
      const fields = [
        { type: 'action', label: 'Name', text: w.name || '(enter)', wide: true, run: (s, form) => { const v = global.prompt('Waypoint name', w.name); if (v) { w.name = v.trim(); form.fields[0].text = w.name; } } },
        { type: 'spin', label: 'Latitude', min: -90, max: 90, step: 0.0001, coarse: 100, get: () => w.lat, set: (v) => (w.lat = v), fmt: (v) => v.toFixed(4) + '°' },
        { type: 'spin', label: 'Longitude', min: -180, max: 180, step: 0.0001, coarse: 100, get: () => w.lon, set: (v) => (w.lon = v), fmt: (v) => v.toFixed(4) + '°' },
        { type: 'spin', label: 'Elevation', min: -400, max: 6000, step: 1, coarse: 50, get: () => w.elev, set: (v) => (w.elev = v), fmt: (v) => num(U().alt(v), 0) + ' ' + U().label('alt') },
        { type: 'select', label: 'Type', options: ['tp', 'airport', 'glider', 'field', 'mark'], get: () => w.type, set: (v) => (w.type = v), show: (v) => ({ tp: 'Turn point', airport: 'Airport', glider: 'Glider site', field: 'Outlanding field', mark: 'Marked position' }[v]) },
        { type: 'spin', label: 'Runway length', min: 0, max: 5000, step: 10, coarse: 10, get: () => w.rwLen || 0, set: (v) => (w.rwLen = v), fmt: (v) => v + ' m' },
      ];
      scr.open(new FormView(scr, {
        title: isNew ? 'New waypoint' : 'Edit waypoint',
        fields,
        buttons: {
          5: { label: 'DIS/BRG', run: () => {
            const d = parseFloat(global.prompt(`Distance from ${ctx.nav.target('wpt') ? ctx.nav.target('wpt').name : 'the glider'} (${U().label('dist')})`, '1'));
            const b = parseFloat(global.prompt('Bearing (degrees true)', '0'));
            if (Number.isFinite(d) && Number.isFinite(b)) {
              const o = ctx.nav.target('wpt') || ctx.flight.f;
              const p = geo.dest(o.lat, o.lon, b, d / U().F.dist[U().label('dist')]);
              w.lat = p.lat; w.lon = p.lon;
            }
          } },
          6: { label: 'OK', run: (s) => {
            if (!w.name) { s.toast('A name is required', 1500); return; }
            if (isNew) { w.code = w.code || w.name.slice(0, 4).toUpperCase(); ctx.nav.addWaypoint(w); ctx.nav.selected.wpt = w; }
            else Object.assign(src, w);
            s.close(); s.toast(isNew ? 'Waypoint created' : 'Waypoint updated', 1200);
          } },
        },
      }));
    };
    if (isNew) {
      scr.open(new Popup(scr, 'New waypoint', 'Do you want to copy from airport?', {
        4: { label: 'NO', run: (s) => { s.close(); open(null); } },
        7: { label: 'YES', run: (s) => {
          s.close();
          const items = ctx.nav.airports.map((a) => ({ label: a.name, color: '#5fd0ff', run: (s2) => { s2.close(); open(Object.assign({}, a, { name: a.name + '-2' })); } }));
          s.open(new MenuView(s, items, { title: 'Select airport' }));
        } },
      }));
    } else if (wp) open(wp);
  }

  /* --------------------------------------------------------------- zone dialog */
  function zoneDialog(scr, ctx, pt, onDone) {
    const z = pt.zone;
    const dist = (v) => num(U().dist(v), 1) + ' ' + U().label('dist');
    scr.open(new FormView(scr, {
      title: `Zone - ${pt.wp ? pt.wp.name : ''}`,
      fields: [
        { type: 'spin', label: 'Radius1', min: 50, max: 150000, step: 100, coarse: 50, get: () => z.r1, set: (v) => { z.r1 = v; if (v > 10000) { z.aat = true; z.autoNext = false; } }, fmt: dist },
        { type: 'spin', label: 'Angle1', min: 0, max: 180, step: 0.5, coarse: 45, get: () => z.a1, set: (v) => (z.a1 = v), fmt: (v) => v + '°' },
        { type: 'spin', label: 'Angle12', min: 0, max: 359, step: 1, coarse: 10, get: () => z.a12, set: (v) => (z.a12 = v), fmt: (v) => v + '°' },
        { type: 'select', label: 'Direction', options: ['symmetric', 'fixed', 'next', 'prev', 'start'], get: () => z.dir, set: (v) => (z.dir = v), show: (v) => v[0].toUpperCase() + v.slice(1) },
        { type: 'check', label: '', text: 'Line', get: () => z.line, set: (v) => (z.line = v) },
        { type: 'spin', label: 'Radius2', min: 0, max: 150000, step: 100, coarse: 50, get: () => z.r2, set: (v) => (z.r2 = v), fmt: dist },
        { type: 'spin', label: 'Angle2', min: 0, max: 180, step: 0.5, coarse: 45, get: () => z.a2, set: (v) => (z.a2 = v), fmt: (v) => v + '°' },
        { type: 'check', label: '', text: 'AAT', get: () => z.aat, set: (v) => (z.aat = v) },
        { type: 'check', label: '', text: 'Auto next', get: () => z.autoNext, set: (v) => (z.autoNext = v) },
      ],
      onClose: () => onDone && onDone(),
    }));
  }

  /* ------------------------------------------------------------ options dialog */
  function optionsDialog(scr, ctx, o) {
    const sec = (label, key, max, step, unit, scale) => ({ type: 'spin', label, min: 0, max, step, coarse: 10, get: () => o[key] / (scale || 1), set: (v) => (o[key] = v * (scale || 1)), fmt: (v) => v + unit });
    const alt = (label, key) => ({ type: 'spin', label, min: 0, max: 8000, step: 10, coarse: 10, get: () => o[key], set: (v) => (o[key] = v), fmt: (v) => (v ? num(U().alt(v), 0) + ' ' + U().label('alt') : 'off') });
    scr.open(new FormView(scr, {
      title: 'Task options',
      fields: [
        { type: 'action', label: 'Task name', text: o.name, wide: true, run: (s, form) => { const v = global.prompt('Task description', o.name); if (v) { o.name = v.trim(); form.fields[0].text = o.name; } } },
        { type: 'spin', label: 'AAT task time', min: 0, max: 720, step: 15, coarse: 1, get: () => o.aatTime, set: (v) => (o.aatTime = v), fmt: (v) => (v ? v + ' min' : 'racing task') },
        { type: 'check', label: '', text: 'Navigate to nearest point', get: () => o.navNearest, set: (v) => (o.navNearest = v) },
        { type: 'check', label: '', text: 'Start ARM mode', get: () => o.arm, set: (v) => (o.arm = v) },
        { type: 'check', label: '', text: 'Obs.zone distance correction', get: () => o.obsCorr, set: (v) => (o.obsCorr = v) },
        { type: 'section', label: 'Before start' },
        sec('Before start', 'beforeStart', 240, 1, ' min'),
        { type: 'spin', label: 'Start opens at', min: 0, max: 1439, step: 5, coarse: 30, get: () => o.startOpen || 0, set: (v) => (o.startOpen = v), fmt: (v) => (v ? `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` : 'off') },
        alt('Below alt.', 'belowAlt'),
        sec('Below time', 'belowTime', 600, 5, ' s'),
        { type: 'section', label: 'Start procedure' },
        alt('Start alt.', 'startAlt'),
        { type: 'spin', label: 'Start gsp.', min: 0, max: 100, step: 1, coarse: 10, get: () => Math.round(o.startGsp * 3.6), set: (v) => (o.startGsp = v / 3.6), fmt: (v) => (v ? v + ' km/h' : 'off') },
        sec('Gate interval', 'gateInterval', 60, 1, ' min'),
        { type: 'check', label: '', text: 'Start out of the top', get: () => o.startOutTop, set: (v) => (o.startOutTop = v) },
        { type: 'check', label: '', text: 'Start within zone', get: () => o.startWithin, set: (v) => (o.startWithin = v) },
        { type: 'section', label: 'Event procedure' },
        sec('Wait before', 'eventWait', 1800, 15, ' s'),
        sec('Start period', 'eventWindow', 1800, 15, ' s'),
        { type: 'spin', label: 'Max.events', min: 1, max: 9, step: 1, coarse: 1, get: () => o.maxEvents, set: (v) => (o.maxEvents = v), fmt: (v) => String(v) },
        alt('Finish is below start for', 'finishBelowStart'),
      ],
    }));
  }

  /* ----------------------------------------------------------------- task edit */
  class TaskEditView extends LX.View {
    constructor(scr, ctx) {
      super(scr);
      this.ctx = ctx;
      const nav = ctx.nav;
      this.pts = nav.task.map((p) => ({ wp: p.wp, zone: Object.assign({}, p.zone) }));
      this.opts = Object.assign({}, LX.TaskTools.DEFAULT_OPTIONS, nav.options);
      this.starts = (nav.starts || []).slice(); // alternative start points (cycled with CYCLE in TSK mode)
      this.sel = 0; // 0 = task time control, 1.. = points (len+1 = empty row)
      this.set = 0;
      this.detailed = false;
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar">Task</div><div class="head" style="position:absolute;left:0;right:0;top:24px;height:24px;display:flex;justify-content:space-between;padding:3px 10px;font-size:14px;color:#8fb6ff"></div><div class="pre" style="position:absolute;left:0;right:0;top:50px;bottom:26px;padding:0"></div>';
      this.head = this.el.querySelector('.head');
      this.body = this.el.querySelector('.pre');
    }
    show() { this.render(); }
    resize() { this.render(); }
    kindOf(i) { return i === 0 ? 'Start' : i === this.pts.length - 1 ? 'Finish' : 'Point'; }
    total() {
      let d = 0;
      for (let i = 1; i < this.pts.length; i++) if (this.pts[i - 1].wp && this.pts[i].wp) d += geo.dist(this.pts[i - 1].wp.lat, this.pts[i - 1].wp.lon, this.pts[i].wp.lat, this.pts[i].wp.lon);
      return d;
    }
    render() {
      const aat = this.opts.aatTime > 0;
      this.head.innerHTML = `<span>${aat ? 'AAT' : 'Racing'}  ${km(this.total())}</span><span class="${this.sel === 0 ? 'sel' : ''}" style="${this.sel === 0 ? 'background:#5b5f66;padding:0 6px' : ''}">${aat ? this.opts.aatTime + ' min' : 'time --'}</span>`;
      const rows = this.pts.map((p, i) => {
        const prev = this.pts[i - 1];
        const brg = prev && prev.wp && p.wp ? Math.round(geo.bearing(prev.wp.lat, prev.wp.lon, p.wp.lat, p.wp.lon)) + '°' : '';
        const dis = prev && prev.wp && p.wp ? km(geo.dist(prev.wp.lat, prev.wp.lon, p.wp.lat, p.wp.lon)) : '';
        const z = p.zone.aat ? '#' : '';
        const pos = this.detailed && p.wp ? `  ${p.wp.lat.toFixed(4)} ${p.wp.lon.toFixed(4)}` : '';
        const cur = i + 1 === this.sel ? 'background:#5b5f66;' : '';
        return `<div style="${cur}padding:3px 10px;display:flex;font-size:16px"><span style="width:60px;color:#8fb6ff">${this.kindOf(i)}</span><span style="flex:1">${z}${p.wp ? p.wp.name : '---'}${pos}</span><span style="width:60px">${brg}</span><span style="width:90px;text-align:right">${dis}</span></div>`;
      });
      const empty = `<div style="${this.sel === this.pts.length + 1 ? 'background:#5b5f66;' : ''}padding:3px 10px;font-size:16px;color:#8a8f99">---</div>`;
      this.body.innerHTML = rows.join('') + empty;
    }
    sets() {
      return [
        ['EDIT', 'OK', 'CANCEL', 'MORE>>', 'ZONE', 'OPTIONS', 'VIEW', 'LOAD'],
        ['SAVE', 'INVERT', 'INS PNT', 'MORE>>', 'STARTS', 'DEL PNT', 'CLEAR', 'MOVE UP'],
        ['MOVE DN', '', '', 'MORE>>', '', '', '', 'OK'],
      ];
    }
    softkeys() { return { labels: this.sets()[this.set], persist: true }; }
    knob(name, dir) {
      if (name === 'page' || name === 'zoom') { this.sel = Math.max(0, Math.min(this.pts.length + 1, this.sel + dir * (name === 'zoom' ? 1 : 1))); this.render(); return true; }
      return false;
    }
    cur() { return this.sel >= 1 ? this.sel - 1 : -1; }
    pickWaypoint(cb) {
      const f = this.ctx.flight.f;
      let list = this.ctx.nav.waypoints.map((w) => ({ w, d: geo.dist(f.lat, f.lon, w.lat, w.lon) }));
      if (list.length > 300) list = list.sort((a, b) => a.d - b.d).slice(0, 300); // big databases: the nearest 300
      const items = list.sort((a, b) => a.w.name.localeCompare(b.w.name))
        .map((x) => ({ label: x.w.name, color: x.w.type === 'tp' ? '#ffe14a' : '#5fd0ff', value: () => km(x.d), run: (s) => { s.close(); cb(x.w); } }));
      this.scr.open(new MenuView(this.scr, items, { title: 'Select waypoint' }));
    }
    button(i) {
      const label = this.sets()[this.set][i];
      const scr = this.scr, ctx = this.ctx, idx = this.cur();
      switch (label) {
        case 'MORE>>': this.set = (this.set + 1) % 3; return true;
        case 'EDIT':
          if (this.sel === 0) { scr.open(new FormView(scr, { title: 'Task time', fields: [{ type: 'spin', label: 'Task time', min: 0, max: 720, step: 1, coarse: 15, get: () => this.opts.aatTime, set: (v) => (this.opts.aatTime = v), fmt: (v) => (v ? v + ' min' : 'racing task') }], onClose: () => this.render() })); }
          else this.pickWaypoint((w) => { if (idx >= this.pts.length) this.pts.push({ wp: w, zone: LX.TaskTools.defaultZone('tp') }); else this.pts[idx].wp = w; this.render(); });
          return true;
        case 'OK': this.commit(); return true;
        case 'CANCEL': scr.close(); return true;
        case 'ZONE': if (idx >= 0 && this.pts[idx]) zoneDialog(scr, ctx, this.pts[idx], () => this.render()); return true;
        case 'OPTIONS': optionsDialog(scr, ctx, this.opts); return true;
        case 'VIEW':
          if (this.detailed) { this.detailed = false; scr.open(new LX.TaskMapView(scr, ctx, this)); return true; } // third press: map edit mode (manual 7.7.4)
          this.detailed = true; scr.toast('Detailed list view (VIEW again: map edit)', 1500); this.render(); return true;
        case 'LOAD': this.load(); return true;
        case 'SAVE': this.save(); return true;
        case 'INVERT': this.pts.reverse(); this.render(); return true;
        case 'INS PNT': if (idx >= 0) { this.pts.splice(Math.min(idx, this.pts.length), 0, { wp: null, zone: LX.TaskTools.defaultZone('tp') }); this.render(); } return true;
        case 'STARTS': {
          const names = this.starts.map((w) => w.name).join(', ') || 'none';
          scr.open(new LX.forms.Popup(scr, 'Alternative start points', `Extra starts (use CYCLE in TSK mode): ${names}`, {
            4: { label: 'CLEAR', run: (x) => { this.starts = []; x.close(); } },
            6: { label: 'CLOSE', run: (x) => x.close() },
            7: { label: 'ADD', run: (x) => { x.close(); this.pickWaypoint((w) => { if (!this.starts.includes(w)) this.starts.push(w); }); } },
          }));
          return true;
        }
        case 'DEL PNT': if (this.pts[idx]) { this.pts.splice(idx, 1); this.render(); } return true;
        case 'CLEAR': this.pts = []; this.sel = 1; this.render(); return true;
        case 'MOVE UP': if (idx > 0 && this.pts[idx]) { [this.pts[idx - 1], this.pts[idx]] = [this.pts[idx], this.pts[idx - 1]]; this.sel--; this.render(); } return true;
        case 'MOVE DN': if (idx >= 0 && idx < this.pts.length - 1) { [this.pts[idx + 1], this.pts[idx]] = [this.pts[idx], this.pts[idx + 1]]; this.sel++; this.render(); } return true;
        default: return false;
      }
    }
    commit() {
      const nav = this.ctx.nav;
      const pts = this.pts.filter((p) => p.wp);
      if (pts.length < 2) { this.scr.toast('A task needs at least a start and a finish', 2000); return; }
      nav.task = pts.map((p) => ({ wp: p.wp, zone: p.zone }));
      nav.options = Object.assign({}, this.opts);
      nav.starts = this.starts.filter((w) => w !== pts[0].wp);
      LX.TaskTools.normalise(nav);
      this.ctx._demoManual = true; // you edited the task: from now on you fly it
      this.ctx.runner.reset();
      this.scr.close();
      this.scr.toast('Task updated', 1500);
    }
    save() {
      const nav = this.ctx.nav;
      const names = this.pts.filter((p) => p.wp).map((p) => p.wp.name);
      const key = names.join('>');
      if (nav.savedTasks.some((t) => t.points.join('>') === key)) { this.scr.toast('Task is already saved!', 1800); return; }
      nav.savedTasks.push({ name: this.opts.name, points: names, zones: this.pts.filter((p) => p.wp).map((p) => p.zone), options: Object.assign({}, this.opts) });
      LX.Files && LX.Files.persistTasks && LX.Files.persistTasks(nav);
      this.scr.toast('Task saved', 1500);
    }
    load() {
      const nav = this.ctx.nav;
      if (!nav.savedTasks.length) { this.scr.toast('No tasks in the active waypoint file', 2000); return; }
      const items = nav.savedTasks.map((t) => ({ label: t.name || t.points.join(' > '), color: '#ff2fd5', value: () => `${t.points.length} pts`, run: (s) => {
        const byName = (n) => nav.waypoints.find((w) => w.name === n);
        const pts = t.points.map((n, k) => ({ wp: byName(n), zone: Object.assign(LX.TaskTools.defaultZone(k === 0 ? 'start' : k === t.points.length - 1 ? 'finish' : 'tp'), (t.zones || [])[k] || {}) }));
        if (pts.some((p) => !p.wp)) { s.close(); s.toast('Task uses waypoints that are not loaded', 2500); return; }
        this.pts = pts; this.opts = Object.assign({}, LX.TaskTools.DEFAULT_OPTIONS, t.options || {}); s.close(); this.render();
      } }));
      this.scr.open(new MenuView(this.scr, items, { title: 'Load task' }));
    }
  }

  LX.taskEdit = { view: (scr, ctx) => new TaskEditView(scr, ctx), editWaypoint, zoneDialog, optionsDialog };
})(window);
