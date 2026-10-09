/**
 * Files and Transfer extras: flight declaration (7.1.6.9), PDF documents (7.1.6.12), checklists (7.1.6.13)
 * and the meteogram (8.3.27).
 *
 *  - Declaration: pilot, glider, task; SAVE writes an IGC-style .hdr (header + C records), LOAD reads one and
 *    makes it the active task. (There is no flight recorder to upload it to.)
 *  - PDF reader: documents are kept in the browser (IndexedDB) and drawn with pdf.js, which is loaded from a CDN
 *    the first time (offline: the PDF opens in a browser tab instead). PAGE / NEXT / PREVIOUS turn pages, ZOOM
 *    zooms, MODE pans, GOTO jumps, BMARK1-4 jump to / (long press) set bookmarks.
 *  - Checklists: plain text files ("# title" starts a list, one action per line; the real unit's LX Styler
 *    .checklists format is not read). A checklist page is added at the end of the APT/WPT/TSK pages; CHECK ticks
 *    the action and moves on, NEXT / PREVIOUS move.
 *  - Meteogram: two-day forecast (clouds, rain, wind, temperature, boundary layer / CAPE) from Open-Meteo for the
 *    selected airport; needs internet.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const Files = LX.Files;
  const geo = LX.geo;
  const act = (label, text, run) => ({ type: 'action', label, text, wide: true, run });
  const info = (label, get) => ({ type: 'info', label, get, wide: true });
  const km = (m) => (m / 1000).toFixed(1) + ' km';

  const download = (name, text, mime) => LX.filesUI.download(name, text, mime);
  const pick = (accept) => LX.filesUI.pickFile(accept);

  /* ------------------------------------------------------------ declaration */
  function declaredPoints(ctx) { return ctx.nav.task.map((p) => ({ name: p.wp.name, lat: p.wp.lat, lon: p.wp.lon })); }

  function declaration(scr, ctx) {
    const S = ctx.settings;
    const total = () => { const t = ctx.nav.task; let d = 0; for (let i = 1; i < t.length; i++) d += geo.dist(t[i - 1].wp.lat, t[i - 1].wp.lon, t[i].wp.lat, t[i].wp.lon); return d; };
    const prompter = (label, key) => (s, form) => { const v = global.prompt(label, S.get()[key] || ''); if (v !== null) S.set({ [key]: v.trim() }); form.render && form.render(); };
    return new FormView(scr, {
      title: 'Flight Declaration',
      live: true,
      fields: [
        info('Pilot', () => S.get().pilot || '(not set: Setup > Profiles and Pilots)'),
        info('Glider', () => LX.polar.glider(S.get().glider).name),
        Object.assign(act('Registration', '', prompter('Glider registration', 'gliderReg')), { get text() { return S.get().gliderReg || '(not set)'; }, set text(v) { /* live */ } }),
        Object.assign(act('Competition ID', '', prompter('Competition ID', 'compId')), { get text() { return S.get().compId || '(not set)'; }, set text(v) { /* live */ } }),
        info('Task declared', () => (ctx.nav.task.length > 1 ? `${ctx.nav.options.name || 'TASK'}  ${ctx.nav.task.length} points  ${km(total())}` : 'no task')),
        act('Save', 'SAVE  declaration as .hdr', () => {
          if (ctx.nav.task.length < 2) { scr.toast('Declare a task first (TSK mode > EDIT)', 2500); return; }
          const st = S.get();
          download('declaration.hdr', Files.writeDeclaration({ pilot: st.pilot, glider: LX.polar.glider(st.glider).name, regId: st.gliderReg, compId: st.compId, name: ctx.nav.options.name, points: declaredPoints(ctx) }));
          scr.toast('declaration.hdr downloaded', 2000);
        }),
        act('Load', 'LOAD  declaration .hdr as the active task', async () => {
          const f = await pick('.hdr,.txt,.igc'); if (!f) return;
          const d = Files.parseDeclaration(await f.text());
          if (d.points.length < 2) { scr.toast('No task found in that file', 2500); return; }
          const nav = ctx.nav;
          const pts = d.points.map((p) => {
            let w = nav.waypoints.find((x) => x.name.toLowerCase() === p.name.toLowerCase() && geo.dist(x.lat, x.lon, p.lat, p.lon) < 1500);
            if (!w) { w = { name: p.name, code: p.name, lat: p.lat, lon: p.lon, elev: 0, type: 'tp' }; nav.waypoints.push(w); }
            return { wp: w, zone: LX.TaskTools.defaultZone('tp') };
          });
          nav.task = pts; nav.options = Object.assign({}, nav.options, { name: d.name || 'TASK' });
          LX.TaskTools.normalise(nav); ctx._demoManual = true; ctx.runner.reset();
          S.set(Object.assign({}, d.pilot ? { pilot: d.pilot } : {}, d.regId ? { gliderReg: d.regId } : {}, d.compId ? { compId: d.compId } : {}));
          scr.toast(`Declaration loaded: ${pts.length} points`, 2500);
        }),
        { type: 'section', label: 'There is no flight recorder to upload to (a Nano or FLARM on the real unit).' },
      ],
    });
  }

  /* ------------------------------------------------------------- checklists */
  const SAMPLE = '# Before take-off\nCanopy closed and locked\nStraps tight\nControls full and free\nAirbrakes closed and locked\nTrim set\nAltimeter / QNH set\nTow release checked\nWind and take-off plan\n\n# Before landing\nStraps tight\nTrim set\nAirbrakes checked\nUndercarriage down and locked\nAltimeter / QNH set\nAirfield and wind checked\n';

  function checklistsDialog(scr, ctx) {
    const S = ctx.settings;
    const apply = (lists) => { S.set({ checklists: lists }); ChecklistView.sync(scr, ctx); };
    return new FormView(scr, {
      title: 'Checklists',
      live: true,
      fields: [
        info('Active checklists', () => { const l = S.get().checklists || []; return l.length ? l.map((c) => `${c.title} (${c.items.length})`).join(', ') : 'none'; }),
        act('Load', 'LOAD  text file (# title, one action per line)', async () => {
          const f = await pick('.txt,.checklists,.lst'); if (!f) return;
          const l = Files.parseChecklists(await f.text());
          if (!l.length) { scr.toast('No checklist found in that file', 2500); return; }
          apply(l); scr.toast(`${l.length} checklists loaded - see the last page of APT/WPT/TSK`, 3000);
        }),
        act('Sample', 'LOAD  a generic glider sample (edit it before use!)', () => { apply(Files.parseChecklists(SAMPLE)); scr.toast('Sample checklists loaded', 2000); }),
        act('Save', 'SAVE  as .txt', () => { const l = S.get().checklists || []; if (l.length) download('checklists.txt', Files.writeChecklists(l)); else scr.toast('No checklists', 1500); }),
        act('Delete', 'DELETE all checklists', () => { apply([]); scr.toast('Checklists deleted', 1500); }),
        { type: 'section', label: 'Not the real LX Styler .checklists format.' },
      ],
    });
  }

  class ChecklistView extends LX.View {
    constructor(scr, ctx) {
      super(scr);
      this.ctx = ctx; this.kind = 'checklist'; this.modeId = 'apt';
      this.list = 0; this.cur = 0; this.checked = {};
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar"></div><div class="cl" style="position:absolute;left:0;right:0;top:26px;bottom:0;overflow:hidden;padding:4px 0"></div>';
      this.title = this.el.firstChild; this.body = this.el.lastChild;
      this.last = 0;
      this.body.addEventListener('click', (e) => { const r = e.target.closest('[data-i]'); if (r) { this.cur = +r.dataset.i; this.check(); } });
    }
    lists() { return this.ctx.settings.get().checklists || []; }
    show() { this.render(); }
    resize() { this.render(); }
    update(dt, now) { if (now - this.last > 500) { this.last = now; this.render(); } }
    render() {
      const L = this.lists()[this.list];
      if (!L) { this.title.textContent = 'Checklist'; this.body.innerHTML = '<div style="padding:10px;color:#8a8f99">No checklist loaded.</div>'; return; }
      this.cur = Math.max(0, Math.min(this.cur, L.items.length - 1));
      const done = L.items.filter((_, i) => this.checked[this.list + ':' + i]).length;
      this.title.textContent = `${L.title}   ${done}/${L.items.length}`;
      this.body.innerHTML = L.items.map((t, i) => {
        const on = this.checked[this.list + ':' + i];
        return `<div data-i="${i}" style="padding:5px 12px;font-size:20px;${i === this.cur ? 'background:#5b5f66;' : ''}${on ? 'color:#7ee07e' : ''}">${on ? '☑' : '☐'}  ${t.replace(/</g, '&lt;')}</div>`;
      }).join('');
    }
    check() {
      const L = this.lists()[this.list]; if (!L) return;
      const k = this.list + ':' + this.cur;
      this.checked[k] = !this.checked[k];
      if (this.checked[k] && this.cur < L.items.length - 1) this.cur++;
      this.render();
    }
    softkeys() { return { labels: ['CHECK', 'NEXT', 'PREVIOUS', 'LIST', 'RESET', '', '', ''], persist: false }; }
    button(i) {
      const L = this.lists();
      switch (i) {
        case 0: this.check(); return 'keep';
        case 1: this.cur++; this.render(); return 'keep';
        case 2: this.cur = Math.max(0, this.cur - 1); this.render(); return 'keep';
        case 3: if (L.length) { this.list = (this.list + 1) % L.length; this.cur = 0; this.render(); } return 'keep';
        case 4: this.checked = {}; this.cur = 0; this.render(); return 'keep';
        default: return false;
      }
    }
    /** Add / remove the checklist page at the end of the APT, WPT and TSK modes. */
    static sync(scr, ctx) {
      const want = (ctx.settings.get().checklists || []).length > 0;
      ['apt', 'wpt', 'tsk'].forEach((id) => {
        const mode = scr.modes.find((m) => m.id === id); if (!mode) return;
        const have = mode.pages.find((p) => p.kind === 'checklist');
        if (want && !have) { const v = new ChecklistView(scr, ctx); v.modeId = id; mode.pages.push(v); scr.lcd.insertBefore(v.el, scr.skTop); }
        else if (!want && have) { mode.pages.splice(mode.pages.indexOf(have), 1); have.el.remove(); scr.pageIdx[id] = Math.min(scr.pageIdx[id], mode.pages.length - 1); }
      });
      scr._showCurrent();
    }
  }

  /* ----------------------------------------------------------------- PDFs */
  let pdfLib = null;
  async function loadPdfjs() {
    if (pdfLib) return pdfLib;
    const base = LX.SOURCES.pdfjs;
    const lib = await import(base + 'pdf.min.mjs');
    const w = await (await fetch(base + 'pdf.worker.min.mjs')).text();
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' }));
    return (pdfLib = lib);
  }
  const pdfStore = {
    async list() { return (await Files.Store.get('pdfs')) || []; },
    async put(name, data) { const l = (await pdfStore.list()).filter((d) => d.name !== name); l.push({ name, data, marks: {} }); await Files.Store.set('pdfs', l); },
    async del(name) { await Files.Store.set('pdfs', (await pdfStore.list()).filter((d) => d.name !== name)); },
    async marks(name, m) { const l = await pdfStore.list(); const d = l.find((x) => x.name === name); if (d) { d.marks = m; await Files.Store.set('pdfs', l); } },
  };

  class PdfView extends LX.View {
    constructor(scr, ctx, doc) {
      super(scr);
      this.doc = doc; this.page = 1; this.zoom = 1; this.px = 0; this.py = 0; this.pdf = null; this.busy = false; this.dirty = true;
      this.marks = Object.assign({}, doc.marks || {});
      this.el.style.background = '#222';
      this.cv = document.createElement('canvas'); this.cv.className = 'layer';
      this.el.appendChild(this.cv);
      this.msg = document.createElement('div');
      this.msg.className = 'titlebar'; this.msg.textContent = doc.name + ' - loading...';
      this.el.appendChild(this.msg);
      this.off = document.createElement('canvas');
    }
    async show() {
      this.resize();
      try {
        const lib = await loadPdfjs();
        this.pdf = await lib.getDocument({ data: this.doc.data.slice(0) }).promise;
        this.dirty = true;
      } catch (e) { // no library (offline): hand the file to the browser's own viewer
        const url = URL.createObjectURL(new Blob([this.doc.data], { type: 'application/pdf' }));
        global.open(url, '_blank');
        this.msg.textContent = 'PDF library not available (offline?) - opened in a browser tab';
      }
    }
    resize() {
      const d = LX.device;
      this.cv.width = d.w; this.cv.height = d.h; this.cv.style.width = d.w + 'px'; this.cv.style.height = d.h + 'px';
      this.W = d.w; this.H = d.h; this.dirty = true;
    }
    async render() {
      if (!this.pdf || this.busy) return;
      this.busy = true; this.dirty = false;
      try {
        const pg = await this.pdf.getPage(this.page);
        const v1 = pg.getViewport({ scale: 1 });
        const fit = (this.W - 4) / v1.width, scale = fit * this.zoom * Math.min(2, global.devicePixelRatio || 1);
        const vp = pg.getViewport({ scale });
        this.off.width = vp.width; this.off.height = vp.height;
        await pg.render({ canvasContext: this.off.getContext('2d'), viewport: vp }).promise;
        this.drawn = { w: vp.width, h: vp.height, k: Math.min(2, global.devicePixelRatio || 1) };
        this.paint();
      } catch (e) { this.msg.textContent = 'Cannot display this PDF: ' + e.message; }
      this.busy = false;
    }
    paint() {
      const g = this.cv.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, this.W, this.H);
      if (!this.drawn) return;
      const w = this.drawn.w / this.drawn.k, h = this.drawn.h / this.drawn.k;
      this.px = Math.max(Math.min(0, this.W - w), Math.min(Math.max(0, this.W - w) / 2 * 0 + 0, this.px));
      this.py = Math.max(Math.min(0, this.H - 26 - h), Math.min(0, this.py));
      g.drawImage(this.off, this.px + Math.max(0, (this.W - w) / 2), 26 + this.py, w, h);
      this.msg.textContent = `${this.doc.name}   page ${this.page}/${this.pdf.numPages}   ${Math.round(this.zoom * 100)}%`;
    }
    update() { if (this.dirty) this.render(); }
    go(p) { if (!this.pdf) return; this.page = Math.max(1, Math.min(this.pdf.numPages, p)); this.px = 0; this.py = 0; this.dirty = true; }
    softkeys() { return { labels: ['PREVIOUS', 'NEXT', 'GOTO', 'BMARK1', 'BMARK2', 'BMARK3', 'BMARK4', 'CLOSE'], persist: true }; }
    button(i, long) {
      if (i === 0) this.go(this.page - 1);
      else if (i === 1) this.go(this.page + 1);
      else if (i === 2) { const v = global.prompt(`Go to page (1-${this.pdf ? this.pdf.numPages : 1})`, String(this.page)); if (v) this.go(parseInt(v, 10) || this.page); }
      else if (i >= 3 && i <= 6) {
        const k = 'b' + (i - 2);
        if (long || !this.marks[k]) { this.marks[k] = this.page; pdfStore.marks(this.doc.name, this.marks); this.scr.toast(`Bookmark ${i - 2} set: page ${this.page}`, 1500); }
        else this.go(this.marks[k]);
      } else if (i === 7) this.scr.close();
      return true;
    }
    drag(dx, dy) { this.px += dx; this.py += dy; this.paint(); return true; }
    knob(name, dir) {
      if (name === 'page') { this.py += dir < 0 ? 60 : -60; if (this.drawn && this.py < -(this.drawn.h / this.drawn.k - this.H + 26)) { this.go(this.page + 1); } else if (this.py > 0 && dir < 0) { if (this.page > 1) { this.go(this.page - 1); this.py = -99999; } else this.py = 0; } this.paint(); return true; }
      if (name === 'zoom') { this.zoom = Math.max(1, Math.min(4, this.zoom + dir * 0.25)); this.dirty = true; return true; }
      if (name === 'mode') { this.px += dir * -40; this.paint(); return true; }
      return false;
    }
  }

  function pdfDialog(scr, ctx) {
    const build = async () => {
      const docs = await pdfStore.list();
      return docs.length ? docs.map((d) => ({ label: d.name, color: '#5fd0ff', value: () => (d.data.byteLength / 1024 | 0) + ' kB', run: (s) => s.open(new PdfView(s, ctx, d)), doc: d })) : [{ label: '(no documents - press LOAD)', color: '#8a8f99', run: () => {} }];
    };
    const view = new MenuView(scr, [{ label: 'Loading...', run: () => {} }], { title: 'PDF Documents' });
    const refresh = async () => { view.items = await build(); view.sel = Math.min(view.sel || 0, view.items.length - 1); view.render(); };
    refresh();
    view.softkeys = () => ({ labels: ['LOAD', 'DELETE', '', '', '', '', 'SELECT', 'CLOSE'], persist: true });
    const baseButton = view.button.bind(view);
    view.button = (i) => {
      if (i === 0) { pick('.pdf').then(async (f) => { if (f) { await pdfStore.put(f.name, await f.arrayBuffer()); await refresh(); scr.toast('Document stored in this browser', 1800); } }); return true; }
      if (i === 1) { const it = view.items[view.sel]; if (it && it.doc) pdfStore.del(it.doc.name).then(refresh); return true; }
      if (i === 6) { const it = view.items[view.sel]; if (it && it.run) it.run(scr); return true; }
      if (i === 7) { scr.close(); return true; }
      return baseButton(i);
    };
    return view;
  }

  /* ------------------------------------------------------------- meteogram */
  const meteo = {
    cache: {},
    /** Forecast for a place: { t:[ISO...], temp, cloud, rain, wind, dir, cape, blh } or null while loading / failed. */
    get(lat, lon) {
      const key = lat.toFixed(2) + ',' + lon.toFixed(2), c = this.cache[key];
      if (c && Date.now() - c.at < 1800000) return c.data;
      if (c && c.loading) return null;
      this.cache[key] = Object.assign(c || {}, { loading: true, at: c ? c.at : 0 });
      fetch(LX.SOURCES.meteo.replace('{lat}', lat.toFixed(3)).replace('{lon}', lon.toFixed(3)), { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((j) => { const h = j.hourly; this.cache[key] = { at: Date.now(), data: { t: h.time, temp: h.temperature_2m, cloud: h.cloud_cover, rain: h.precipitation, wind: h.wind_speed_10m, dir: h.wind_direction_10m, cape: h.cape, blh: h.boundary_layer_height } }; })
        .catch((e) => { this.cache[key] = { at: Date.now() - 1500000, data: null, err: e.message }; });
      return null;
    },
    err(lat, lon) { const c = this.cache[lat.toFixed(2) + ',' + lon.toFixed(2)]; return c && c.err; },
  };

  /** Draw the meteogram into rect {x,y,w,h}: cloud bars, rain, wind arrows, temperature line, BL height. */
  function drawMeteogram(c, r, place, label) {
    const sym = LX.symbols;
    c.fillStyle = '#000'; c.fillRect(r.x, r.y, r.w, r.h);
    const d = meteo.get(place.lat, place.lon);
    sym.otext(c, label || place.name || 'Meteogram', r.x + 8, r.y + 14, 14, { weight: 'normal', color: '#8fb6ff' });
    if (!d) { sym.otext(c, meteo.err(place.lat, place.lon) ? 'Forecast unavailable: ' + meteo.err(place.lat, place.lon) : 'Loading forecast...', r.x + r.w / 2, r.y + r.h / 2, 16, { align: 'center', weight: 'normal' }); return; }
    const now = Date.now(); let i0 = d.t.findIndex((s) => Date.parse(s + 'Z') >= now - 1800000); if (i0 < 0) i0 = 0;
    const n = Math.min(36, d.t.length - i0), L = r.x + 34, W = r.w - 44, bw = W / n;
    const top = r.y + 26, rows = { cloud: [top, 46], wind: [top + 52, 46], temp: [top + 104, r.h - 104 - 66], };
    c.font = '10px Verdana'; c.textAlign = 'center';
    for (let k = 0; k < n; k++) {
      const i = i0 + k, x = L + k * bw, hr = new Date(d.t[i] + 'Z');
      if (hr.getUTCHours() % 3 === 0) { c.fillStyle = '#9aa0aa'; c.fillText(String(hr.getHours()).padStart(2, '0'), x + bw / 2, r.y + r.h - 6); c.strokeStyle = '#333'; c.beginPath(); c.moveTo(x, top); c.lineTo(x, r.y + r.h - 16); c.stroke(); }
      // clouds
      const cl = d.cloud[i] / 100; c.fillStyle = `rgba(200,205,215,${0.25 + 0.7 * cl})`; c.fillRect(x + 1, rows.cloud[0] + 46 * (1 - cl), bw - 2, 46 * cl);
      if (d.rain[i] > 0.05) { c.fillStyle = '#3b8bff'; c.fillRect(x + 1, rows.cloud[0] + 42, bw - 2, Math.min(4, 1 + d.rain[i] * 2)); }
      // wind arrow (points where the wind blows to)
      const ws = d.wind[i], a = (d.dir[i] + 180) * Math.PI / 180, cx = x + bw / 2, cy = rows.wind[0] + 23, len = Math.min(bw * 0.9, 6 + ws * 1.4);
      c.strokeStyle = ws > 8 ? '#ffb000' : '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx - Math.sin(a) * len / 2, cy + Math.cos(a) * len / 2); c.lineTo(cx + Math.sin(a) * len / 2, cy - Math.cos(a) * len / 2); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(cx + Math.sin(a) * len / 2, cy - Math.cos(a) * len / 2, 2, 0, 7); c.fill();
    }
    // temperature line + boundary layer height as bars behind (thermal depth)
    const [ty, th] = rows.temp, blhMax = Math.max(1500, ...d.blh.slice(i0, i0 + n).map((v) => v || 0));
    for (let k = 0; k < n; k++) { const v = (d.blh[i0 + k] || 0) / blhMax; c.fillStyle = 'rgba(60,160,90,.55)'; c.fillRect(L + k * bw + 1, ty + th * (1 - v), bw - 2, th * v); }
    const tmin = Math.min(...d.temp.slice(i0, i0 + n)), tmax = Math.max(...d.temp.slice(i0, i0 + n)), span = Math.max(4, tmax - tmin);
    c.strokeStyle = '#ff5a4a'; c.lineWidth = 2; c.beginPath();
    for (let k = 0; k < n; k++) { const x = L + k * bw + bw / 2, y = ty + th - ((d.temp[i0 + k] - tmin) / span) * th * 0.9 - 4; k ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    c.font = '10px Verdana'; c.textAlign = 'right'; c.fillStyle = '#ff9a8a'; c.fillText(Math.round(tmax) + '°', L - 3, ty + 10); c.fillText(Math.round(tmin) + '°', L - 3, ty + th - 2);
    c.fillStyle = '#c8ccd2'; c.textAlign = 'left'; c.font = '11px Verdana';
    c.fillText('cloud / rain', r.x + 2, rows.cloud[0] + 10); c.fillText('wind', r.x + 2, rows.wind[0] + 10); c.fillText('green: boundary layer height (' + Math.round(LX.units.alt(blhMax)) + ' ' + LX.units.label('alt') + ')   red: temperature', L, ty + th + 12);
    const hi = Math.max(...d.cape.slice(i0, i0 + n).map((v) => v || 0));
    c.font = '11px Verdana'; c.textAlign = 'right'; c.fillStyle = '#c8ccd2'; c.fillText('max CAPE ' + Math.round(hi) + ' J/kg', r.x + r.w - 6, r.y + 14);
  }
  LX.meteogram = { draw: drawMeteogram, meteo };

  LX.docsUI = { declaration, checklistsDialog, pdfDialog, ChecklistView, parseOnly: null };
})(window);
