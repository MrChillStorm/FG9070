/**
 * Menu list + form dialogs, following the unit's input model (manual 6.3, 7.1):
 *   PAGE knob  move between entries / controls (clockwise = next)
 *   ZOOM knob  move faster (menu) / larger steps (editing)
 *   SELECT     (lower-right button) enter the highlighted menu entry
 *   EDIT       (lower-right button in forms) start / finish editing a control;
 *              while editing the PAGE knob changes the value
 *   CLOSE      (lower-left button) leave the dialog
 * Menu and form screens show their button labels permanently.
 *
 * A form field is
 *   { type:'select', label, options:[...] | () => [...], get, set }
 *   { type:'spin',   label, min, max, step, fmt?, get, set }
 *   { type:'check',  label, get, set }
 *   { type:'info',   label, get }           read-only
 *   { type:'action', label, run }           button-like entry
 *   { type:'section', label }               heading (not selectable)
 * Optional: wide:true (full row).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const clamp = LX.util.clamp;

  /* ---------------------------------------------------------------- MenuView */
  class MenuView extends LX.View {
    /** items: [{ label, color?, value?: ()=>string, run(scr) }]; opts: { title, grid, cols, root } */
    constructor(scr, items, opts) {
      super(scr);
      this.items = items;
      this.opts = opts || {};
      this.sel = 0;
      this.el.innerHTML = `<div class="titlebar"></div><div class="menu${this.opts.grid ? ' grid' : ''}"></div>`;
      this.titleEl = this.el.firstChild;
      this.listEl = this.el.lastChild;
      this.titleEl.textContent = this.opts.title || '';
      if (this.opts.cols) this.listEl.style.setProperty('--cols', this.opts.cols);
      this.el.style.background = '#000';
      this.render();
    }
    render() {
      this.listEl.innerHTML = '';
      this.items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'row' + (i === this.sel ? ' sel' : '');
        row.innerHTML = `<span class="ic" style="background:${it.color || '#8fb6ff'}"></span><span class="lbl"></span><span class="val"></span>`;
        row.querySelector('.lbl').textContent = it.label;
        if (it.value) row.querySelector('.val').textContent = it.value();
        row.addEventListener('pointerdown', () => { this.sel = i; this.render(); });
        row.addEventListener('dblclick', () => this.select());
        this.listEl.appendChild(row);
      });
      const cur = this.listEl.children[this.sel];
      if (cur && cur.scrollIntoView) {
        // keep the selected row visible (manual scroll: container has overflow hidden)
        const top = cur.offsetTop, bottom = top + cur.offsetHeight;
        const L = this.listEl;
        if (top < L.scrollTop) L.scrollTop = top;
        else if (bottom > L.scrollTop + L.clientHeight) L.scrollTop = bottom - L.clientHeight;
      }
    }
    show() { this.render(); }
    resize() { if (this.opts.grid) this.listEl.style.setProperty('--cols', LX.device.portrait ? (this.opts.colsPortrait || 3) : (this.opts.cols || 4)); this.render(); }
    softkeys() {
      const l = ['', '', '', '', this.opts.root ? '' : 'CLOSE', '', '', 'SELECT'];
      if (this.opts.extra) Object.keys(this.opts.extra).forEach((k) => (l[k] = this.opts.extra[k].label));
      return { labels: l, persist: true };
    }
    knob(name, dir) {
      if (name === 'page') { this.sel = clamp(this.sel + dir, 0, this.items.length - 1); this.render(); return true; }
      if (name === 'zoom') {
        const cols = this.opts.grid ? (LX.device.portrait ? (this.opts.colsPortrait || 3) : (this.opts.cols || 4)) : 5;
        this.sel = clamp(this.sel + dir * cols, 0, this.items.length - 1); this.render(); return true;
      }
      return false;
    }
    select() { const it = this.items[this.sel]; if (it && it.run) it.run(this.scr); }
    button(i) {
      if (i === 7) { this.select(); return true; }
      if (i === 4 && !this.opts.root) { this.scr.close(); return true; }
      if (this.opts.extra && this.opts.extra[i]) { this.opts.extra[i].run(this.scr, this); return true; }
      return false;
    }
  }

  /* ---------------------------------------------------------------- FormView */
  class FormView extends LX.View {
    /** opts: { title, fields, buttons: { index: {label, run} }, onClose } */
    constructor(scr, opts) {
      super(scr);
      this.opts = opts;
      this.fields = opts.fields;
      this.sel = this.fields.findIndex((f) => f.type !== 'section');
      this.editing = false;
      this.touched = performance.now();
      this.el.innerHTML = '<div class="titlebar"></div><div class="form"></div>';
      this.el.firstChild.textContent = opts.title;
      this.formEl = this.el.lastChild;
      this.el.style.background = '#000';
      this.render();
    }
    fieldText(f) {
      if (f.type === 'check') return (f.get() ? '☑ ' : '☐ ') + (f.text || '');
      if (f.type === 'action') return f.text || '';
      const v = f.get ? f.get() : '';
      if (f.show) return f.show(v);
      if (f.type === 'spin') return f.fmt ? f.fmt(v) : String(v);
      return String(v);
    }
    render() {
      const keep = this.formEl.scrollTop; // clearing the form would reset the scroll position
      this.formEl.innerHTML = '';
      let selEl = null;
      this.fields.forEach((f, i) => {
        const d = document.createElement('div');
        if (f.type === 'section') { d.className = 'field sect'; d.innerHTML = '<div class="lab"></div>'; d.firstChild.textContent = f.label; this.formEl.appendChild(d); return; }
        d.className = 'field' + (f.wide ? ' wide' : '') + (i === this.sel ? ' sel' : '') + (i === this.sel && this.editing ? ' edit' : '');
        d.innerHTML = '<div class="lab"></div><div class="val"></div>';
        d.firstChild.textContent = f.label || '';
        d.lastChild.textContent = this.fieldText(f);
        d.addEventListener('pointerdown', () => { this.sel = i; this.editing = false; this.render(); this.scr._refreshSoftkeys(); });
        d.addEventListener('dblclick', () => this.toggleEdit());
        this.formEl.appendChild(d);
        if (i === this.sel) selEl = d;
      });
      // keep the selected field visible (forms can be longer than the screen)
      const L = this.formEl;
      L.scrollTop = keep;
      if (selEl) {
        const top = selEl.offsetTop, bottom = top + selEl.offsetHeight;
        const first = this.fields.findIndex((q) => q.type !== 'section') === this.sel;
        if (first) L.scrollTop = 0;
        else if (top < L.scrollTop + 4) L.scrollTop = Math.max(0, top - 4);
        else if (bottom > L.scrollTop + L.clientHeight - 4) L.scrollTop = bottom - L.clientHeight + 4;
      }
    }
    show() { this.render(); }
    resize() { this.render(); }
    cur() { return this.fields[this.sel]; }
    softkeys() {
      const l = ['', '', '', '', 'CLOSE', '', '', this.editing ? 'OK' : 'EDIT'];
      const b = this.opts.buttons || {};
      Object.keys(b).forEach((k) => (l[k] = typeof b[k].label === 'function' ? b[k].label() : b[k].label));
      return { labels: l, persist: true };
    }
    move(dir) {
      let i = this.sel;
      do { i += dir; } while (this.fields[i] && this.fields[i].type === 'section');
      if (this.fields[i]) this.sel = i;
    }
    change(dir, coarse) {
      const f = this.cur();
      if (f.type === 'spin') {
        const step = (f.step || 1) * (coarse ? (f.coarse || 10) : 1);
        const base = f.step || 1;
        let v = Math.round((f.get() + dir * step) / base) * base; // snap to the step grid
        v = clamp(v, f.min, f.max);
        f.set(Math.round(v * 1e6) / 1e6); // trim float noise (0.1 steps)
      } else if (f.type === 'select') {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        const idx = Math.max(0, opts.findIndex((o) => (o.v !== undefined ? o.v : o) === f.get()));
        const n = opts.length;
        const o = opts[((idx + dir) % n + n) % n];
        f.set(o.v !== undefined ? o.v : o);
      }
    }
    knob(name, dir) {
      this.touched = performance.now();
      if (name === 'page') {
        if (this.editing) this.change(dir, false); else this.move(dir);
        this.render(); return true;
      }
      if (name === 'zoom') {
        if (this.editing) this.change(dir, true); else { this.move(dir); this.move(dir); }
        this.render(); return true;
      }
      return false;
    }
    toggleEdit() {
      const f = this.cur();
      if (f.type === 'check') { f.set(!f.get()); }
      else if (f.type === 'action') { f.run && f.run(this.scr, this); }
      else if (f.type === 'info') { /* nothing */ }
      else this.editing = !this.editing;
      this.render();
      this.scr._refreshSoftkeys();
    }
    button(i) {
      this.touched = performance.now();
      if (i === 7) { this.toggleEdit(); return true; }
      if (i === 4) { if (this.opts.onClose) this.opts.onClose(); this.scr.close(); return true; }
      const b = this.opts.buttons && this.opts.buttons[i];
      if (b) { b.run(this.scr, this); this.render(); return true; }
      return false;
    }
    update(dt, now) {
      // keep live (read-only) values fresh
      if (this.opts.live) this.render();
      // some dialogs (MC/BAL) close themselves after 10 s without input (manual 8.2.1.1)
      if (this.opts.autoClose && (now || performance.now()) - this.touched > this.opts.autoClose) { if (this.opts.onClose) this.opts.onClose(); this.scr.close(); }
    }
  }

  /** Small confirmation / message popup: scr.open(new Popup(scr, 'Title', 'text', {...})). */
  class Popup extends LX.View {
    constructor(scr, title, text, buttons) {
      super(scr);
      this.buttons = buttons || { 7: { label: 'OK', run: (s) => s.close() } };
      this.el.className = 'view hidden dlg-overlay over';
      this.el.innerHTML = '<div class="popup"><div class="title"></div><div class="body"></div></div>';
      this.el.querySelector('.title').textContent = title;
      this.el.querySelector('.body').textContent = text;
    }
    softkeys() {
      const l = ['', '', '', '', '', '', '', ''];
      Object.keys(this.buttons).forEach((k) => (l[k] = this.buttons[k].label));
      return { labels: l, persist: true };
    }
    button(i) { const b = this.buttons[i]; if (b) { b.run(this.scr); return true; } return false; }
  }

  LX.forms = { MenuView, FormView, Popup };
})(window);
