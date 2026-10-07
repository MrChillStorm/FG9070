/**
 * Navigational page layout (manual chapter 8): custom pages made of symbols placed freely on the screen.
 *
 * LAYOUT button -> EDIT, DELETE, ADD ABOVE/BELOW, COPY ABOVE/BELOW, SETTINGS (+ NAVBOXES quick editor).
 * Edit mode: MODE knob selects a symbol, PAGE moves it left/right, ZOOM up/down; speed buttons NEW,
 * DELETE, EDIT, RESIZE/MOVE, CLOSE (asks to save). Positions and sizes are fractions of the screen, so a
 * layout works in landscape and portrait. Built-in map pages are converted into an editable symbol list on
 * EDIT; the other built-in page types (FLARM radar, instruments, 3D ...) cannot be edited, but you can build
 * your own page from the symbols. Not implemented: the Windows "LX Styler" program, fonts per symbol.
 *
 * Symbols: map, navbox, final glide, wind + thermal assistant, zoom scale, north arrow, vario dial,
 * vario tape, side view, FLARM radar, text label.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const clamp = LX.util.clamp;
  const S = () => LX.settings;

  const TYPES = {
    map:     { name: 'Map', w: 1, h: 0.89, desc: 'Moving map' },
    navbox:  { name: 'Navbox', w: 0.2, h: 0.11, desc: 'Data field' },
    fg:      { name: 'Final glide', w: 0.1, h: 0.28, desc: 'Final glide symbol' },
    wind:    { name: 'Wind / thermal', w: 0.2, h: 0.26, desc: 'Wind arrow and thermal assistant' },
    scale:   { name: 'Zoom scale', w: 0.12, h: 0.05, desc: 'Map scale bar' },
    north:   { name: 'North arrow', w: 0.06, h: 0.1, desc: 'North arrow' },
    vario:   { name: 'Vario dial', w: 0.4, h: 0.65, desc: 'Vario indicator' },
    tape:    { name: 'Vario tape', w: 0.07, h: 0.6, desc: 'Vario tape' },
    side:    { name: 'Side view', w: 1, h: 0.34, desc: 'Terrain / glide profile' },
    radar:   { name: 'FLARM radar', w: 0.4, h: 0.65, desc: 'FLARM radar' },
    meteo:   { name: 'Meteogram', w: 1, h: 0.6, desc: 'Forecast for the selected airport' },
    label:   { name: 'Text', w: 0.25, h: 0.07, desc: 'Fixed text' },
  };

  /* ------------------------------------------------------------------ persistence */
  const customPages = () => S().get().customPages || {};
  const pageSets = () => S().get().pageSets || {};
  function saveEls(id, els, extra) {
    const c = Object.assign({}, customPages());
    c[id] = Object.assign({}, c[id] || {}, { els: JSON.parse(JSON.stringify(els)) }, extra || {});
    S().set({ customPages: c });
  }
  function saveRefs(scr, modeId) {
    const mode = scr.modes.find((m) => m.id === modeId);
    const refs = mode.pages.filter((v) => v.kind !== 'checklist').map((v) => (v.kind === 'custom' ? { kind: 'custom', id: v.cid } : { kind: v.kind }));
    const P = Object.assign({}, pageSets()); P[modeId] = refs;
    S().set({ pageSets: P });
  }
  const newId = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 100);

  /** The editable equivalent of a built-in map-style page. */
  function defaultElements(view) {
    const ids = LX.navboxes.layoutFor(view.modeId, view.kind);
    const rowH = LX.device.portrait ? 0.09 : 0.11, n = Math.max(1, ids.length);
    const els = [{ t: 'map', x: 0, y: 0, w: 1, h: 1 - rowH }];
    if (view.kind === 'side') { els[0].h = 1 - rowH - 0.34; els.push({ t: 'side', x: 0, y: 1 - rowH - 0.34, w: 1, h: 0.34 }); }
    els.push({ t: 'north', x: 0.02, y: 0.09, w: 0.06, h: 0.1 });
    els.push({ t: 'fg', x: 0.9, y: 0.25, w: 0.1, h: 0.28 });
    els.push({ t: 'wind', x: 0.01, y: 1 - rowH - (view.kind === 'side' ? 0.34 : 0) - 0.25, w: 0.2, h: 0.24 });
    els.push({ t: 'scale', x: 0.88, y: 1 - rowH - (view.kind === 'side' ? 0.34 : 0) - 0.06, w: 0.12, h: 0.05 });
    ids.forEach((id, i) => els.push({ t: 'navbox', x: i / n, y: 1 - rowH, w: 1 / n, h: rowH, id }));
    return els;
  }
  const convertible = (kind) => ['map', 'map2', 'tmap2', 'ttime', 'side', 'custom'].indexOf(kind) >= 0;

  /* ------------------------------------------------------------------ drawing */
  const rectOf = (e, W, H) => ({ x: e.x * W, y: e.y * H, w: e.w * W, h: e.h * H });

  function buildBoxes(view) {
    view.row.innerHTML = '';
    view.boxes = [];
    view.row.style.cssText = 'position:absolute;inset:0;display:block;background:none;pointer-events:none;z-index:3';
    (view.els || []).forEach((e) => {
      if (e.t !== 'navbox') return;
      const d = document.createElement('div');
      d.className = 'navbox';
      d.style.cssText = 'position:absolute;background:rgba(0,0,0,.86);overflow:hidden;box-sizing:border-box';
      d.innerHTML = '<div class="t"></div><div class="v"></div>';
      d.firstChild.textContent = LX.navboxes.title(e.id);
      view.row.appendChild(d);
      view.boxes.push({ el: d, v: d.lastChild, e, fn: () => LX.navboxes.get(e.id, view.helper()), last: '', sig: '' });
    });
  }
  function placeBoxes(view) {
    const W = view.W, H = view.H, fs = (view.fontScale || 100) / 100;
    view.boxes.forEach((b) => {
      const r = rectOf(b.e, W, H), sig = [r.x, r.y, r.w, r.h, fs].join(',');
      if (sig === b.sig) return;
      b.sig = sig;
      const st = b.el.style;
      st.left = r.x + 'px'; st.top = r.y + 'px'; st.width = r.w + 'px'; st.height = r.h + 'px';
      b.v.style.fontSize = clamp(r.h * 0.5 * fs, 10, 60) + 'px'; b.v.style.lineHeight = clamp(r.h * 0.58 * fs, 12, 70) + 'px';
      b.el.firstChild.style.fontSize = clamp(r.h * 0.2 * fs, 8, 16) + 'px';
    });
  }

  /** Called from NavView.update for kind 'custom'. */
  function draw(view, f) {
    const c = view.c, W = view.W, H = view.H, ctx = view.ctx, s = ctx.settings.get(), sym = LX.symbols;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    // buildBoxes() must follow the element list when it changed
    const n = (view.els || []).filter((e) => e.t === 'navbox').length;
    if (view.boxes.length !== n || view.boxes.some((b, i) => !(view.els || []).includes(b.e))) buildBoxes(view);
    placeBoxes(view);
    let core = null;
    const els = view.els || [];
    const mapEl = els.find((e) => e.t === 'map');
    if (mapEl) { const r = rectOf(mapEl, W, H); core = view.mapCore(f, r); }
    const nav = core ? core.nav : ctx.navFor(view.modeId, f);
    const up = core ? core.up : (s.mapUp || 'track');
    const scaleKm = core ? core.scaleKm : LX.Map.ZOOMS[clamp(s.mapZoom, 0, LX.Map.ZOOMS.length - 1)];
    const mpp = core ? core.mpp : scaleKm * 10;
    els.forEach((e) => {
      const r = rectOf(e, W, H);
      switch (e.t) {
        case 'north': sym.northArrow(c, r.x + r.w / 2, r.y + r.h / 2, up === 'track' ? f.track : 0); break;
        case 'fg': sym.finalGlide(c, r.x, r.y, nav, s.mc, view.modeId === 'tsk' ? ctx.runner.prefix() : '', core && core.tclear ? core.tclear.climb : 0); break;
        case 'wind': { const rad = Math.min(r.w, r.h) / 2; sym.windThermal(c, r.x + r.w / 2, r.y + r.h / 2, rad, f, ctx.flight.bins, s.mc, up === 'track' ? f.track : 0); break; }
        case 'scale': sym.zoomScale(c, r.x + r.w, r.y + r.h, scaleKm, mpp); break;
        case 'vario': { const rad = Math.min(r.w, r.h) / 2; sym.varioIndicator(c, r.x + r.w / 2, r.y + r.h / 2, rad, f, { range: s.varioRange, value: f.te, mc: s.mc, avg: f.avgV, thermalAvg: ctx.flight.lastThermalAvg() }); break; }
        case 'tape': sym.varioTape(c, r.x, r.y, r.w, r.h, f.te, s.varioRange); break;
        case 'side': {
          const geo = LX.geo, brg = nav ? nav.bearing : f.track;
          const tf = (d) => { const p = geo.dest(f.lat, f.lon, brg, d); const h = ctx.dem.elevation(p.lat, p.lon, 300); if (h !== undefined) return h; const o = geo.enu(ctx.ref.lat, ctx.ref.lon, p.lat, p.lon); return 150 + 1700 * LX.Map.terrain(o.e, o.n); };
          sym.sideView(c, r.x, r.y, r.w, r.h, f, nav, tf, s.safetyAlt); break;
        }
        case 'radar': {
          const rad = Math.min(r.w, r.h) / 2, tg = ctx.traffic.relative(f, 0);
          sym.flarmRadar(c, r.x + r.w / 2, r.y + r.h / 2, rad, f, tg, 'track', 5000, { pcas: ctx.traffic.pcas() }); break;
        }
        case 'meteo': { const tg = ctx.nav.target(view.modeId === 'tsk' ? 'apt' : view.modeId) || ctx.nav.target('apt'); if (tg) LX.meteogram.draw(c, r, tg, tg.name + (tg.code ? ' ' + tg.code : '')); break; }
        case 'label': sym.otext(c, e.text || 'Text', r.x + r.w / 2, r.y + r.h / 2, clamp(r.h * 0.6, 10, 40), { align: 'center' }); break;
        default: break;
      }
    });
    if (view.editing) drawEdit(view, c, W, H);
  }

  function drawEdit(view, c, W, H) {
    const e = view.els[view.sel];
    if (!e) { LX.symbols.otext(c, 'Empty page - press NEW', 10, 50, 15); return; }
    const r = rectOf(e, W, H);
    c.fillStyle = 'rgba(80,170,255,.30)'; c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = '#5fd0ff'; c.lineWidth = 2; c.strokeRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath();
    const mx = r.x + r.w / 2, my = r.y + r.h / 2;
    if (view.resizing) { // arrows on the right and bottom edges
      c.moveTo(r.x + r.w - 14, my); c.lineTo(r.x + r.w - 2, my); c.moveTo(r.x + r.w - 8, my - 5); c.lineTo(r.x + r.w - 2, my); c.lineTo(r.x + r.w - 8, my + 5);
      c.moveTo(mx, r.y + r.h - 14); c.lineTo(mx, r.y + r.h - 2); c.moveTo(mx - 5, r.y + r.h - 8); c.lineTo(mx, r.y + r.h - 2); c.lineTo(mx + 5, r.y + r.h - 8);
    } else { // cross with arrows: move mode
      c.moveTo(mx - 12, my); c.lineTo(mx + 12, my); c.moveTo(mx, my - 12); c.lineTo(mx, my + 12);
    }
    c.stroke();
    const t = TYPES[e.t].name + (e.t === 'navbox' ? ' ' + e.id : '');
    const info = view.resizing ? `${t}   ${Math.round(e.w * 100)}% x ${Math.round(e.h * 100)}%   (resize)` : `${t}   x ${Math.round(e.x * 100)}%  y ${Math.round(e.y * 100)}%   (move)`;
    c.fillStyle = 'rgba(0,0,0,.85)'; c.fillRect(0, 26, Math.min(W, 420), 22);
    LX.symbols.otext(c, info, 6, 38, 13, { weight: 'normal' });
  }

  /* ------------------------------------------------------------------ edit mode */
  function startEdit(view) {
    if (view.kind !== 'custom') {
      if (!convertible(view.kind)) { view.scr.toast('This page type is fixed - ADD a new page and build your own', 2800); return; }
      toCustom(view);
    }
    view.editing = true; view.resizing = false; view.sel = 0; view.backup = JSON.parse(JSON.stringify(view.els));
    view.skSet = 0; view.scr.toast('Layout edit: MODE selects, PAGE moves left/right, ZOOM up/down', 3000);
  }
  function toCustom(view) {
    const id = newId();
    view.els = defaultElements(view);
    view.kind = 'custom'; view.cid = id;
    saveEls(id, view.els);
    saveRefs(view.scr, view.modeId);
    buildBoxes(view);
  }
  function editSoftkeys(view) {
    return { labels: ['NEW', 'DELETE', 'EDIT', view.resizing ? 'MOVE' : 'RESIZE', '', '', '', 'CLOSE'], persist: true };
  }
  function editButton(view, i) {
    const scr = view.scr, e = view.els[view.sel];
    switch (i) {
      case 0: scr.open(new LX.forms.MenuView(scr, Object.keys(TYPES).map((k) => ({ label: TYPES[k].name, color: '#5fd0ff', value: () => '', run: (s) => {
        s.close();
        const t = TYPES[k], el = { t: k, x: clamp(0.5 - t.w / 2, 0, 1 - t.w), y: clamp(0.5 - t.h / 2, 0, 1 - t.h), w: t.w, h: t.h };
        if (k === 'navbox') el.id = 'Alt';
        if (k === 'label') el.text = 'Text';
        view.els.push(el); view.sel = view.els.length - 1; view.resizing = false;
        if (k === 'navbox') editElement(view);
      } })), { title: 'New symbol' })); return true;
      case 1:
        if (!e) return true;
        scr.open(new LX.forms.Popup(scr, 'Delete symbol', `Delete ${TYPES[e.t].name}?`, {
          4: { label: 'NO', run: (s) => s.close() },
          7: { label: 'YES', run: (s) => { view.els.splice(view.sel, 1); view.sel = Math.max(0, view.sel - 1); s.close(); } },
        })); return true;
      case 2: editElement(view); return true;
      case 3: view.resizing = !view.resizing; return true;
      case 7:
        scr.open(new LX.forms.Popup(scr, 'Layout', 'Save the changes to this page?', {
          3: { label: 'CANCEL', run: (s) => s.close() },
          4: { label: 'NO', run: (s) => { s.close(); view.els = view.backup; view.editing = false; buildBoxes(view); } },
          7: { label: 'YES', run: (s) => { s.close(); saveEls(view.cid, view.els, { fontScale: view.fontScale }); view.editing = false; scr.toast('Page saved', 1200); } },
        })); return true;
      default: return false;
    }
  }
  function editKnob(view, name, dir) {
    const e = view.els[view.sel];
    if (name === 'mode') { if (view.els.length) view.sel = (view.sel + dir + view.els.length) % view.els.length; return true; }
    if (!e) return true;
    const k = 0.01 * dir;
    if (!view.resizing) {
      if (name === 'page') e.x = clamp(e.x + k, 0, 1 - e.w); else if (name === 'zoom') e.y = clamp(e.y - k, 0, 1 - e.h);
    } else if (name === 'page') e.w = clamp(e.w + k, 0.03, 1 - e.x); else if (name === 'zoom') e.h = clamp(e.h - k, 0.03, 1 - e.y);
    return true;
  }
  function editElement(view) {
    const e = view.els[view.sel]; if (!e) return;
    const scr = view.scr, pct = (key) => ({ type: 'spin', label: key.toUpperCase() + ' (%)', min: 0, max: 100, step: 1, coarse: 5, get: () => Math.round(e[key] * 100), set: (v) => { e[key] = v / 100; }, fmt: (v) => v + '%' });
    const fields = [];
    if (e.t === 'navbox') {
      const ids = LX.navboxes.ids().sort((a, b) => a.localeCompare(b));
      fields.push({ type: 'select', label: 'Data', options: ids, wide: true, get: () => e.id, set: (v) => { e.id = v; buildBoxes(view); }, show: (v) => (LX.navboxes.defs[v] ? `${v} - ${LX.navboxes.defs[v].desc}`.slice(0, 44) : v) });
    }
    if (e.t === 'label') fields.push({ type: 'action', label: 'Text', text: e.text || '', wide: true, run: (s2, form) => { const v = global.prompt('Text', e.text || ''); if (v !== null) { e.text = v; form.render && form.render(); } } });
    fields.push(pct('x'), pct('y'), pct('w'), pct('h'));
    scr.open(new LX.forms.FormView(scr, { title: TYPES[e.t].name, fields, live: true }));
  }

  /* ------------------------------------------------------------------ page management */
  function addPage(view, where, copy) {
    const scr = view.scr, mode = scr.modes.find((m) => m.id === view.modeId);
    let els = [];
    if (copy) {
      if (view.kind === 'custom') els = JSON.parse(JSON.stringify(view.els));
      else if (convertible(view.kind)) els = defaultElements(view);
      else scr.toast('This page type cannot be copied - starting an empty page', 2500);
    }
    const id = newId();
    saveEls(id, els);
    const nv = new LX.NavView(scr, view.ctx, view.modeId, 'custom', id);
    const idx = mode.pages.indexOf(view) + (where === 'below' ? 1 : 0);
    mode.pages.splice(idx, 0, nv);
    scr.lcd.insertBefore(nv.el, scr.skTop);
    saveRefs(scr, view.modeId);
    scr.pageIdx[mode.id] = idx; scr._showCurrent();
    nv.resize();
    startEdit(nv);
  }
  function deletePage(view) {
    const scr = view.scr, mode = scr.modes.find((m) => m.id === view.modeId);
    if (mode.pages.length < 2) { scr.toast('The last page cannot be deleted', 2000); return; }
    scr.open(new LX.forms.Popup(scr, 'Delete page', 'Delete this page?', {
      4: { label: 'NO', run: (s) => s.close() },
      7: { label: 'YES', run: (s) => {
        s.close();
        const idx = mode.pages.indexOf(view);
        mode.pages.splice(idx, 1);
        view.el.remove();
        if (view.cid) { const c = Object.assign({}, customPages()); delete c[view.cid]; S().set({ customPages: c }); }
        saveRefs(scr, view.modeId);
        scr.pageIdx[mode.id] = Math.min(idx, mode.pages.length - 1); scr._showCurrent();
      } },
    }));
  }

  function menu(scr, ctx, view) {
    const items = [
      { label: 'EDIT', color: '#5fd0ff', value: () => (convertible(view.kind) ? '' : 'fixed page'), run: (s) => { s.close(); startEdit(view); } },
      { label: 'DELETE', color: '#ff5a4a', value: () => '', run: (s) => { s.close(); deletePage(view); } },
      { label: 'ADD ABOVE', color: '#7ee07e', value: () => '', run: (s) => { s.close(); addPage(view, 'above', false); } },
      { label: 'ADD BELOW', color: '#7ee07e', value: () => '', run: (s) => { s.close(); addPage(view, 'below', false); } },
      { label: 'COPY ABOVE', color: '#ffd400', value: () => '', run: (s) => { s.close(); addPage(view, 'above', true); } },
      { label: 'COPY BELOW', color: '#ffd400', value: () => '', run: (s) => { s.close(); addPage(view, 'below', true); } },
      { label: 'SETTINGS', color: '#c8a0ff', value: () => '', run: (s) => {
        s.open(new LX.forms.FormView(s, { title: 'Page settings', live: true, fields: [{ type: 'spin', label: 'Navbox font', min: 60, max: 160, step: 5, coarse: 10, get: () => view.fontScale || 100, set: (v) => { view.fontScale = v; if (view.cid) saveEls(view.cid, view.els, { fontScale: v }); }, fmt: (v) => v + '%' }] }));
      } },
      { label: 'NAVBOXES', color: '#8a8f99', value: () => 'quick editor', run: (s) => { s.close(); s.open(LX.setup.layoutDialog(s, ctx, view)); } },
      { label: 'RESET PAGES', color: '#ff9a1f', value: () => 'this mode', run: (s) => {
        s.close();
        const P = Object.assign({}, pageSets()); delete P[view.modeId]; S().set({ pageSets: P });
        s.toast('Default pages restored - reloading...', 1500); setTimeout(() => global.location.reload(), 900);
      } },
    ];
    return new LX.forms.MenuView(scr, items, { title: 'Layout' });
  }

  LX.layout = { TYPES, draw, buildBoxes, startEdit, editSoftkeys, editButton, editKnob, menu, convertible, defaultElements };
})(window);
