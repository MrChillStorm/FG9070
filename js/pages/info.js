/**
 * Information mode (7.2) and Near mode (7.3).
 *
 * Information: GPS status page and a position report to the selected target.
 * Near: list of landable places with bearing, distance and arrival height;
 * GOTO makes the highlighted one the airport-mode target and switches to it.
 * Sky view and network pages show "No satellite info" / "No network": a simulator has neither.
 * Not implemented: FREQ (needs radio bridge).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const fm = LX.fm;
  const clamp = LX.util.clamp;

  class TextView extends LX.View {
    on(fn) { this.onButton = fn; return this; }
    constructor(scr, ctx, title, lines, labels) {
      super(scr);
      this.ctx = ctx; this.title = title; this.lines = lines; this.labels = labels || [];
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar"></div><div class="pre" style="position:absolute;left:0;right:0;top:26px;bottom:0"></div>';
      this.el.firstChild.textContent = title;
      this.pre = this.el.lastChild;
      this.last = 0;
    }
    update(dt, now) {
      if (now - this.last < 250) return;
      this.last = now;
      const t = this.lines(this.ctx);
      if (t !== this.shown) { this.pre.innerHTML = t; this.shown = t; }
    }
    get curLabels() { return typeof this.labels === 'function' ? this.labels(this.ctx) : this.labels; }
    softkeys() { return { labels: this.curLabels, persist: true }; }
    button(i) {
      const l = this.curLabels[i];
      if (l && this.onButton) return this.onButton(l, this.ctx, this);
      if (l) this.scr.toast(`${l}: not implemented in this build`, 1500);
      return true;
    }
  }

  const K = (s) => `<span class="k">${s}</span>`;
  const pad2 = (n) => String(n).padStart(2, '0');

  /** MARK (7.2.1): new waypoint at the current position, named _<date>-<time>, elevation from the terrain database. */
  function markPosition(scr, ctx) {
    const f = ctx.flight.f;
    if (!ctx.flight.have) { scr.toast('No position fix yet', 1500); return; }
    const t = new Date();
    const name = `_${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}-${pad2(t.getHours())}${pad2(t.getMinutes())}`;
    LX.taskEdit.editWaypoint(scr, ctx, { name, code: 'MARK', lat: f.lat, lon: f.lon, elev: Math.round(ctx.groundElev(f)), type: 'mark' }, true, true);
  }

  const watch = { start: 0, acc: 0, running: false };
  const watchMs = (now) => watch.acc + (watch.running ? now - watch.start : 0);
  const hms = (ms) => { const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };

  function gpsPage(scr, ctx) {
    return new TextView(scr, ctx, 'Info', (c) => {
      const fl = c.flight, f = fl.f;
      if (!fl.have) return 'No position fix yet.\n\n' + c.statusText();
      const t = new Date();
      const flightLevel = Math.round((f.alt * 3.28084) / 100);
      return [
        `${K('FILE:')}   ${c.recorder && c.recorder.cur ? 'recording' : '(not recording)'}   ${K('Link:')} ${c.statusText()}   ${K('FLARM')} ${flarmStatus(c)}`,
        `${K('Position')}  ${f.lat.toFixed(5)}°   ${f.lon.toFixed(5)}°`,
        `${K('Altitude')}  ${fm.alt(f.alt)} ${LX.units.label('alt')}   ${K('FL')} ${String(flightLevel).padStart(3, '0')}`,
        `${K('Height')}    ${fm.alt(f.alt - c.groundElev(f))} ${LX.units.label('alt')}  (above terrain, demo model)`,
        `${K('Track')}     ${fm.hdg(f.track)}     ${K('GS')} ${fm.spd(f.gs)} ${LX.units.label('speed')}     ${K('IAS')} ${fm.spd(f.ias)} ${LX.units.label('speed')}`,
        `${K('Time')}      ${t.toTimeString().slice(0, 8)}   ${K('Date')} ${t.toISOString().slice(0, 10)}`,
        '',
        `${K('GPS')}       3D fix (simulated)   ${K('Sats')} 10`,
        `${K('Stopwatch')} ${hms(watchMs(performance.now()))}${watch.running ? '  running' : ''}`,
        (() => { const ss = LX.sun.times(f.lat, f.lon, t); return `${K('Sunrise')}   ${LX.sun.fmt(ss && ss.rise)}   ${K('Sunset')} ${LX.sun.fmt(ss && ss.set)}  (UTC)`; })(),
      ].join('\n');
    }, () => ['', '', '', '', '', '', watch.running ? 'STOP' : 'START', 'MARK'])
      .on((l, c) => {
        const now = performance.now();
        if (l === 'START') { watch.start = now; watch.running = true; }
        else if (l === 'STOP') { watch.acc += now - watch.start; watch.running = false; }
        else if (l === 'MARK') markPosition(scr, c);
        return true;
      });
  }

  /** FLARM status (7.2.1): TX plus the number of other FLARM devices in range. */
  function flarmStatus(c) {
    const mode = c.traffic && c.traffic.mode();
    if (!mode || mode === 'off') return 'off';
    const n = (c.traffic.relative(c.flight.f, 0) || []).length;
    return `TX ${n}`;
  }

  function reportPage(scr, ctx) {
    return new TextView(scr, ctx, 'Position report', (c) => {
      const fl = c.flight, f = fl.f;
      const tg = c.reportPt || c.nav.target('apt') || c.nav.target('tsk');
      if (!fl.have || !tg) return 'No data / no point selected';
      // always nautical miles and MAGNETIC radial (7.2.2)
      const d = LX.geo.dist(tg.lat, tg.lon, f.lat, f.lon) / 1852;
      const rad = (LX.geo.bearing(tg.lat, tg.lon, f.lat, f.lon) - (f.magvar || 0) + 360) % 360;
      return [
        `${K('FILE:')} ${c.recorder && c.recorder.cur ? 'recording' : '(not recording)'}`,
        `${K('Position')}   ${d.toFixed(1)} NM  on radial ${String(Math.round(rad) % 360).padStart(3, '0')}° M`,
        `${K('from')}       ${tg.name}`,
        `${K('Altitude')}   ${fm.alt(f.alt)} ${LX.units.label('alt')}`,
        `${K('Glider')}     ${c.flight.getPolar().name}`,
        '',
        `${K('Radial is magnetic (variation ' + (f.magvar || 0).toFixed(1) + '° E from the simulator), distance in nautical miles.')}`,
      ].join('\n');
    }, ['', '', '', '', '', '', 'REPORT', 'MARK'])
      .on((l, c) => {
        if (l === 'REPORT') scr.open(LX.filesUI.airportSelect(scr, c, 'rep'));
        else if (l === 'MARK') markPosition(scr, c);
        return true;
      });
  }

  function skyPage(scr, ctx) {
    return new TextView(scr, ctx, 'Satellites', () => 'No satellite info\n\n' + K('The simulator provides no GPS satellite data.'), ['', '', '', '', '', '', '', 'MARK'])
      .on((l, c) => { if (l === 'MARK') markPosition(scr, c); return true; });
  }

  function networkPage(scr, ctx) {
    return new TextView(scr, ctx, 'Network', (c) => `${K('Network')}   none (this trainer talks to FlightGear directly)\n${K('Link')}      ${c.statusText()}`, ['', '', '', '', '', '', '', ''])
      .on(() => true);
  }

  /* ----------------------------------------------------------------- Near */
  /* VIEW (7.3) chooses how much detail each row shows */
  const NEAR_VIEWS = [
    { name: 'Standard', cols: ['name', 'brg', 'dis', 'arr'] },
    { name: 'Compact', cols: ['name', 'arr'] },
    { name: 'Detailed', cols: ['name', 'brg', 'dis', 'arr', 'elev', 'rwy', 'freq'] },
  ];
  const NEAR_COLS = {
    name: ['Name', (x) => `${x.short ? '<span style="color:#ff3b30">&#10005;</span> ' : ''}${x.w.name}`],
    brg: ['Brg', (x, c) => fm.hdg(x.brg)],
    dis: ['Dis', (x) => `${fm.dist(x.d)} ${LX.units.label('dist')}`],
    arr: ['Arrival', (x) => (x.n ? LX.fmt.signed(LX.units.alt(x.n.arrival), 0) + LX.units.label('alt') : '--'), (x) => (x.n && x.n.arrival < 0 ? '#ff7a5c' : '#7ee07e')],
    elev: ['Elev', (x) => `${fm.alt(x.w.elev || 0)} ${LX.units.label('alt')}`],
    rwy: ['Rwy', (x) => { const l = x.w.rwLen || (x.w.runways && x.w.runways[0] && x.w.runways[0].len); return l ? `${Math.round(l)} m` : '--'; }],
    freq: ['Freq', (x) => x.w.freq || (x.w.freqs && x.w.freqs[0] && (x.w.freqs[0].mhz || x.w.freqs[0].freq)) || '--'],
  };

  class NearView extends LX.View {
    constructor(scr, ctx) {
      super(scr);
      this.ctx = ctx; this.sel = 0; this.last = 0; this.list = [];
      this.sort = 'arrival'; this.viewIdx = 0;
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar">Near</div><div style="position:absolute;left:0;right:0;top:26px;bottom:26px;overflow:hidden"><table class="list"><thead><tr></tr></thead><tbody></tbody></table></div>';
      this.head = this.el.querySelector('thead tr');
      this.body = this.el.querySelector('tbody');
    }
    /** Landable places around the glider, duplicates removed (user waypoints beat database entries), sorted. */
    compute() {
      const c = this.ctx, f = c.flight.f, st = c.settings.get();
      const seen = [];
      const isDb = (w) => !!(w.runways || w.freqs); // entries from the airport databases carry runway/frequency data
      c.nav.nearest(f.lat, f.lon, 60).forEach((x) => {
        const i = seen.findIndex((y) => LX.geo.dist(x.w.lat, x.w.lon, y.w.lat, y.w.lon) < 150);
        if (i < 0) seen.push(x);
        else if (isDb(seen[i].w) && !isDb(x.w)) seen[i] = x; // the user's own point wins over the database
      });
      const rows = seen.map((x) => {
        x.n = c.flight.navTo(x.w);
        const l = x.w.rwLen || (x.w.runways && x.w.runways[0] && x.w.runways[0].len) || 0;
        x.short = st.minRwLen > 0 && l > 0 && l < st.minRwLen; // red cross: too short for this glider (7.1.7.4)
        return x;
      });
      if (this.sort === 'arrival') rows.sort((a, b) => (b.n ? b.n.arrival : -1e9) - (a.n ? a.n.arrival : -1e9));
      else if (this.sort === 'bearing') rows.sort((a, b) => a.brg - b.brg);
      else rows.sort((a, b) => a.d - b.d);
      return rows.slice(0, 20);
    }
    update(dt, now) {
      if (now - this.last < 300) return;
      this.last = now;
      const c = this.ctx;
      if (!c.flight.have) return;
      this.list = this.compute();
      this.sel = clamp(this.sel, 0, Math.max(0, this.list.length - 1));
      const cols = NEAR_VIEWS[this.viewIdx].cols;
      const sortCol = { arrival: 'arr', distance: 'dis', bearing: 'brg' }[this.sort];
      this.head.innerHTML = cols.map((k) => `<th${k === sortCol ? ' style="background:#5b5f66"' : ''}>${NEAR_COLS[k][0]}</th>`).join('');
      this.body.innerHTML = '';
      this.list.forEach((x, i) => {
        const tr = document.createElement('tr');
        if (i === this.sel) tr.className = 'sel';
        tr.innerHTML = cols.map((k) => { const col = NEAR_COLS[k][2]; return `<td${col ? ` style="color:${col(x)}"` : ''}>${NEAR_COLS[k][1](x, c)}</td>`; }).join('');
        tr.addEventListener('pointerdown', () => { this.sel = i; this.last = 0; });
        this.body.appendChild(tr);
      });
    }
    softkeys() { return { labels: ['', '', '', 'SORT', 'VIEW', 'FREQ', 'REPORT', 'GOTO'], persist: true }; }
    knob(name, dir) {
      if (name === 'page') { this.sel = clamp(this.sel + dir, 0, Math.max(0, this.list.length - 1)); this.last = 0; return true; }
      if (name === 'zoom') { this.sel = clamp(this.sel + dir * 5, 0, Math.max(0, this.list.length - 1)); this.last = 0; return true; }
      return false;
    }
    button(i) {
      const l = this.softkeys().labels[i];
      if (l === 'GOTO' && this.list[this.sel]) {
        this.ctx.nav.selected.apt = this.list[this.sel].w;
        this.ctx.goMode('apt');
        this.scr.toast(`Navigating to ${this.list[this.sel].w.name}`, 1500);
      } else if (l === 'REPORT') {
        if (this.list[this.sel]) this.ctx.reportPt = this.list[this.sel].w;
        this.ctx.goMode('info', 1);
      } else if (l === 'SORT') {
        this.sort = { arrival: 'distance', distance: 'bearing', bearing: 'arrival' }[this.sort]; this.last = 0;
        this.scr.toast('Sorted by ' + this.sort, 1200);
      } else if (l === 'VIEW') {
        this.viewIdx = (this.viewIdx + 1) % NEAR_VIEWS.length; this.last = 0;
        this.scr.toast('View: ' + NEAR_VIEWS[this.viewIdx].name, 1200);
      } else if (l) this.scr.toast(`${l}: needs a radio bridge`, 1500);
      return true;
    }
  }

  LX.info = { gpsPage, reportPage, skyPage, networkPage, markPosition };
  LX.NearView = NearView;
})(window);
