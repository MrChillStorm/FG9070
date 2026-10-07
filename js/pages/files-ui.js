/**
 * Setup > Files and Transfer (manual 7.1.6) and the airport selection dialog
 * (7.5.6.1: filter, ICAO and list methods).
 *
 * Files and Transfer: load CUP waypoints/tasks, OpenAir or OpenAIP-JSON
 * airspace, OurAirports CSV or OpenAIP-JSON airports from your computer (also
 * by dragging files onto the page); download OurAirports / OpenAIP data online
 * for the area around the glider; save waypoints+tasks as CUP; save the last
 * flight as an (unofficial) IGC file.
 *
 * Not implemented: SD card / USB stick handling, Connect, map database
 * management. (PDF documents, checklists and flight declarations: see docs-ui.js.)
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const Files = LX.Files;
  const U = () => LX.units;

  /* ------------------------------------------------------------ file helpers */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '';
      inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      inp.click();
    });
  }

  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function loadFile(scr, ctx, file) {
    try {
      const msg = await Files.loadText(ctx.nav, file.name, await file.text());
      scr.toast(`${file.name}: ${msg}`, 3500);
    } catch (e) {
      scr.toast(`${file.name}: ${e.message}`, 4000);
    }
  }

  /** Drag & drop of data files anywhere on the page. */
  function enableDrop(scr, ctx) {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      [...(e.dataTransfer.files || [])].forEach((f) => loadFile(scr, ctx, f));
    });
  }

  const here = (ctx) => ({ lat: ctx.flight.have ? ctx.flight.f.lat : (ctx.ref ? ctx.ref.lat : 0), lon: ctx.flight.have ? ctx.flight.f.lon : (ctx.ref ? ctx.ref.lon : 0) });

  async function online(scr, ctx, what, fn) {
    scr.toast(`Downloading ${what}…`, 60000);
    try { scr.toast(`${what}: ${await fn()}`, 4000); }
    catch (e) { scr.toast(`${what}: ${e.message}`, 5000); }
  }

  /* ----------------------------------------------------------- dialog builders */
  const act = (label, text, run) => ({ type: 'action', label, text, wide: true, run });
  const info = (label, get) => ({ type: 'info', label, get, wide: true });

  function waypointsDialog(scr, ctx) {
    const nav = ctx.nav;
    return new FormView(scr, {
      title: 'Waypoints and Tasks',
      live: true,
      fields: [
        info('Active waypoint file', () => `${(nav.waypointFile || []).length || nav.waypoints.length} waypoints${nav.demo ? ' (demo set)' : ''}, ${nav.savedTasks.length} tasks`),
        act('Load', 'LOAD  .cup (SeeYou)', async () => { const f = await pickFile('.cup'); if (f) loadFile(scr, ctx, f); }),
        act('Save', 'SAVE as .cup', () => { download('waypoints.cup', Files.writeCUP(nav.waypoints.filter((w) => w.type !== 'mark' || true), nav.savedTasks), 'text/plain'); scr.toast('waypoints.cup downloaded', 2000); }),
        act('Clear', 'CLEAR all waypoints and tasks', async () => { nav.setWaypointFile([]); nav.savedTasks = []; await Files.clear('waypoints'); await Files.clear('tasks'); scr.toast('Waypoints cleared', 1500); }),
      ],
    });
  }

  function airspaceDialog(scr, ctx) {
    const nav = ctx.nav;
    return new FormView(scr, {
      title: 'Airspace',
      live: true,
      fields: [
        info('Active airspace', () => `${(nav.airspaces || []).length} zones${nav.demo ? ' (demo set)' : ''}`),
        act('Load', 'LOAD  OpenAir .txt / OpenAIP .json', async () => { const f = await pickFile('.txt,.air,.json,.geojson'); if (f) loadFile(scr, ctx, f); }),
        act('Online', 'DOWNLOAD from OpenAIP (100 km around the glider)', () => online(scr, ctx, 'OpenAIP airspace', () => Files.fetchOpenAIP(nav, 'airspaces', here(ctx), 100000, ctx.settings.get().openaipKey))),
        act('Key', 'OpenAIP API key: ' + (ctx.settings.get().openaipKey ? 'set' : 'not set'), (s, form) => {
          const k = global.prompt('OpenAIP API key (free account at openaip.net)', ctx.settings.get().openaipKey || '');
          if (k !== null) { ctx.settings.set({ openaipKey: k.trim() }); form.fields[3].text = 'OpenAIP API key: ' + (k.trim() ? 'set' : 'not set'); }
        }),
        act('Proxy', 'OpenAIP proxy: ' + (ctx.settings.get().openaipProxy || 'none (direct)'), (s, form) => {
          const u = global.prompt('URL of tools/openaip-proxy.js, e.g. http://localhost:5401\n(empty = connect directly; OpenAIP sends no CORS headers, so a browser needs the proxy)', ctx.settings.get().openaipProxy || '');
          if (u !== null) { ctx.settings.set({ openaipProxy: u.trim() }); form.fields[4].text = 'OpenAIP proxy: ' + (u.trim() || 'none (direct)'); }
        }),
        act('Sources', 'Free airspace websites (opens a tab: download, then LOAD)', () => {
          ['https://soaringweb.org/', 'https://asselect.uk/', 'https://www.openaip.net/'].forEach((u) => global.open(u, '_blank', 'noopener'));
        }),
        act('Clear', 'CLEAR', async () => { nav.airspaces = []; await Files.clear('airspaces'); scr.toast('Airspace cleared', 1500); }),
      ],
    });
  }

  function airportsDialog(scr, ctx) {
    const nav = ctx.nav;
    return new FormView(scr, {
      title: 'Airports',
      live: true,
      fields: [
        info('Airport database', () => `${(nav.airportDb || []).length} airports, ${nav.airports.length} landable places in use`),
        act('Load', 'LOAD  OurAirports .csv / OpenAIP .json', async () => { const f = await pickFile('.csv,.json,.geojson'); if (f) loadFile(scr, ctx, f); }),
        act('Online', 'DOWNLOAD OurAirports (400 km around the glider)', () => online(scr, ctx, 'OurAirports', () => Files.fetchOurAirports(nav, here(ctx), 400000))),
        act('OpenAIP', 'DOWNLOAD OpenAIP airports (needs the API key)', () => online(scr, ctx, 'OpenAIP airports', () => Files.fetchOpenAIP(nav, 'airports', here(ctx), 100000, ctx.settings.get().openaipKey))),
        act('Clear', 'CLEAR', async () => { nav.setAirports([]); await Files.clear('airports'); scr.toast('Airports cleared', 1500); }),
      ],
    });
  }

  function flightsDialog(scr, ctx) {
    return new FormView(scr, {
      title: 'Flights',
      live: true,
      fields: [
        info('Recorded flights', () => `${ctx.recorder ? ctx.recorder.count() : 0} in this browser`),
        act('Save', 'SAVE last / current flight as .igc', () => { if (ctx.recorder && ctx.recorder.downloadIGC()) scr.toast('IGC file downloaded', 2000); else scr.toast('Nothing recorded yet', 2000); }),
        { type: 'section', label: 'The IGC file is marked UNOFFICIAL: it is not a valid, signed flight recording.' },
      ],
    });
  }

  async function updateDatabases(scr, ctx) {
    const h = here(ctx);
    if (!ctx.flight.have) { scr.toast('No position yet: connect to FlightGear first', 2500); return; }
    await online(scr, ctx, 'Airport database', () => Files.fetchOurAirports(ctx.nav, h, 400000));
    if (ctx.settings.get().openaipKey) await online(scr, ctx, 'OpenAIP airspace', () => Files.fetchOpenAIP(ctx.nav, 'airspaces', h, 100000, ctx.settings.get().openaipKey));
  }

  function loadFromURL(scr, ctx) {
    const u = global.prompt('URL of a .cup, OpenAir .txt, OurAirports .csv or OpenAIP .json file\n(the server must allow cross-origin requests; otherwise download the file and drop it onto the page)', '');
    if (u) online(scr, ctx, 'Download', () => Files.loadURL(ctx.nav, u.trim()));
  }

  function filesRoot(scr, ctx) {
    return new MenuView(scr, [
      { label: 'Update Databases (download for this area)', color: '#29d35a', run: (s) => updateDatabases(s, ctx) },
      { label: 'Load from URL', color: '#29d35a', run: (s) => loadFromURL(s, ctx) },
      { label: 'Waypoints and Tasks', color: '#ffd400', run: (s) => s.open(waypointsDialog(s, ctx)) },
      { label: 'Airspace', color: '#ff5a4a', run: (s) => s.open(airspaceDialog(s, ctx)) },
      { label: 'Airports', color: '#5fd0ff', run: (s) => s.open(airportsDialog(s, ctx)) },
      { label: 'Flights', color: '#7ee07e', run: (s) => s.open(flightsDialog(s, ctx)) },
      { label: 'Maps (base map tiles: Setup > Graphics)', color: '#8a8f99', run: (s) => s.toast('Base map: Setup > Graphics > Base map', 2500) },
      { label: 'Flight Declaration', color: '#c8a0ff', run: (s) => s.open(LX.docsUI.declaration(s, ctx)) },
      { label: 'PDF Documents', color: '#c8a0ff', run: (s) => s.open(LX.docsUI.pdfDialog(s, ctx)) },
      { label: 'Checklists', color: '#c8a0ff', run: (s) => s.open(LX.docsUI.checklistsDialog(s, ctx)) },
    ], { title: 'Files and Transfer' });
  }


  /* --------------------------------------------------------- airport selection */
  const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  class AirportSelect extends LX.View {
    /** modeId 'apt' selects among airports, 'wpt' among waypoints. */
    constructor(scr, ctx, modeId) {
      super(scr);
      this.ctx = ctx; this.modeId = modeId;
      this.method = 'filter'; // filter | icao | list
      this.text = ''; this.cur = 0; // typed prefix + cursor position
      this.sel = 0; this.inList = false; this.sort = 'dist';
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar"></div><div class="as-head" style="position:absolute;left:0;right:0;top:24px;height:46px;padding:4px 10px;font-size:22px;letter-spacing:.1em"></div><div class="as-list" style="position:absolute;left:0;right:0;top:72px;bottom:26px;overflow:hidden"></div>';
      this.title = this.el.firstChild; this.head = this.el.children[1]; this.list = this.el.children[2];
    }
    source() { return this.modeId === 'wpt' ? this.ctx.nav.waypoints : this.ctx.nav.airports; }
    keyOf(w) { return (this.method === 'icao' ? (w.code || w.name) : w.name).toUpperCase(); }
    matches() {
      const f = this.ctx.flight.f;
      let m = this.source().map((w) => ({ w, d: LX.geo.dist(f.lat, f.lon, w.lat, w.lon), brg: LX.geo.bearing(f.lat, f.lon, w.lat, w.lon) }));
      if (this.method !== 'list') {
        const t = this.text.trim().toUpperCase();
        m = m.filter((x) => this.keyOf(x.w).startsWith(t));
        m.sort((a, b) => this.keyOf(a.w).localeCompare(this.keyOf(b.w)));
      } else m.sort(this.sort === 'bearing' ? (a, b) => a.brg - b.brg : (a, b) => a.d - b.d);
      return m;
    }
    show() { this.render(); }
    resize() { this.render(); }
    render() {
      const lab = { filter: 'Filter (name)', icao: 'ICAO', list: 'List' }[this.method];
      this.title.textContent = (this.modeId === 'wpt' ? 'Select waypoint' : 'Select airport') + ' - ' + lab;
      if (this.method === 'list') this.head.innerHTML = `<span style="font-size:14px;color:#8fb6ff">Sorted by ${this.sort === 'dist' ? 'distance' : 'bearing'}</span>`;
      else {
        const t = (this.text + ' '.repeat(Math.max(0, this.cur + 1 - this.text.length))).split('');
        this.head.innerHTML = t.map((ch, i) => `<span style="display:inline-block;min-width:16px;text-align:center;${i === this.cur && !this.inList ? 'background:#5b5f66;' : ''}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
      }
      const m = this.matches();
      this.sel = Math.max(0, Math.min(this.sel, m.length - 1));
      const rows = m.slice(Math.max(0, this.sel - 6), Math.max(0, this.sel - 6) + 12).map((x, i, arr) => {
        const idx = Math.max(0, this.sel - 6) + i;
        const hi = this.inList && idx === this.sel ? 'background:#5b5f66;' : (!this.inList && idx === 0 ? 'color:#fff;' : 'color:#c8ccd2;');
        return `<div style="${hi}display:flex;padding:3px 10px;font-size:16px"><span style="flex:1">${x.w.name}</span><span style="width:70px;color:#8fb6ff">${x.w.code || ''}</span><span style="width:50px">${Math.round(x.brg)}°</span><span style="width:90px;text-align:right">${LX.fmt.num(U().dist(x.d), 1)} ${U().label('dist')}</span></div>`;
      });
      this.list.innerHTML = rows.join('') || '<div style="padding:10px;color:#8a8f99">No match</div>';
      this.matchesNow = m;
    }
    softkeys() {
      return { labels: ['', '', '', '', 'CLOSE', 'METHOD', this.method === 'list' ? 'SORT' : 'CHAR>>', 'GOTO'], persist: true };
    }
    knob(name, dir) {
      if (name === 'page') {
        if (this.method === 'list' || this.inList) { this.sel = Math.max(0, Math.min((this.matchesNow || []).length - 1, this.sel + dir)); }
        else {
          const ch = (this.text[this.cur] || ' ').toUpperCase();
          const i = (CHARS.indexOf(ch) + dir + CHARS.length) % CHARS.length;
          this.text = this.text.slice(0, this.cur) + CHARS[i] + this.text.slice(this.cur + 1);
          this.text = this.text.padEnd(this.cur + 1, ' ');
        }
        this.render(); return true;
      }
      if (name === 'zoom') {
        if (!this.inList && this.method !== 'list') { this.cur = Math.max(0, this.cur + dir); this.text = this.text.slice(0, this.cur + 1); } // counter-clockwise = back to the previous letter
        else this.sel = Math.max(0, Math.min((this.matchesNow || []).length - 1, this.sel + dir * 5));
        this.render(); return true;
      }
      return false;
    }
    choose(w) {
      const ctx = this.ctx;
      ctx.nav.selected[this.modeId === 'wpt' ? 'wpt' : 'apt'] = w;
      this.scr.close();
      this.scr.toast(`Target: ${w.name}`, 1400);
    }
    button(i) {
      const l = this.softkeys().labels[i];
      if (l === 'CLOSE') { this.scr.close(); return true; }
      if (l === 'METHOD') { this.method = { filter: 'icao', icao: 'list', list: 'filter' }[this.method]; this.text = ''; this.cur = 0; this.inList = false; this.sel = 0; this.render(); return true; }
      if (l === 'CHAR>>') { this.cur++; this.text = this.text.padEnd(this.cur, ' '); this.render(); return true; }
      if (l === 'SORT') { this.sort = this.sort === 'dist' ? 'bearing' : 'dist'; this.render(); return true; }
      if (l === 'GOTO') {
        const m = this.matchesNow || [];
        if (this.method === 'list' || this.inList) { if (m[this.sel]) this.choose(m[this.sel].w); return true; }
        if (m.length === 1) { this.choose(m[0].w); return true; }
        if (m.length > 1) { this.inList = true; this.sel = 0; this.render(); }
        return true;
      }
      return false;
    }
  }

  LX.filesUI = { updateDatabases, filesRoot, enableDrop, loadFile, airportSelect: (scr, ctx, modeId) => new AirportSelect(scr, ctx, modeId), download, pickFile };
})(window);
