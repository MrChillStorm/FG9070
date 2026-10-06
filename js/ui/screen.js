/**
 * Screen manager.
 *
 * Modes (MODE knob, manual ch. 7): Airport, Waypoint, Task, Statistics, Setup,
 * Information, Near. Navigation modes and Statistics have several pages that
 * the PAGE knob scrolls through.
 *
 * Soft keys (manual 6.1.3 / 8.2): the eight push buttons have DYNAMIC
 * functions. The first press only shows what every button does (labels along
 * the top and bottom screen edge); pressing a button again executes it. The
 * labels vanish after 10 s. Menu/dialog screens show their (CLOSE / SELECT…)
 * labels permanently and buttons act immediately ("persist").
 *
 * Input also works by touch: swipe left/right = mode, swipe up/down = page
 * (manual 6.1.5), wheel = zoom, and the on-screen labels are tappable.
 *
 * A View implements:
 *   el                 root element (class "view")
 *   show() / hide()
 *   update(dt, now)    every frame while visible
 *   softkeys()         -> { labels: [8 x string|''], persist?: bool }
 *   button(i, long)    -> true | 'keep' (keep labels open) | false
 *   knob(name, dir)    -> true if consumed (else the screen does the default)
 *   resize()
 */
(function (global) {
  'use strict';
  const LX = global.LX;

  const SOFTKEY_TIMEOUT = 10000;

  class View {
    constructor(scr) {
      this.scr = scr;
      this.el = document.createElement('div');
      this.el.className = 'view hidden';
    }
    show() {}
    hide() {}
    update() {}
    resize() {}
    softkeys() { return { labels: ['', '', '', '', '', '', '', ''], persist: false }; }
    button() { return false; }
    knob() { return false; }
  }

  class Screen {
    /** modes: [{ id, name, pages: [View...] }] */
    constructor(lcd, ctx) {
      this.lcd = lcd;
      this.ctx = ctx;
      this.modes = [];
      this.modeIdx = 0;
      this.pageIdx = {};
      this.stack = []; // modal dialogs (View) above the current page
      this.skUntil = 0;
      this.off = false;
      this.toastEl = null;

      this.skTop = this._mkSoftkeys('top');
      this.skBottom = this._mkSoftkeys('bottom');
      lcd.appendChild(this.skTop);
      lcd.appendChild(this.skBottom);
      this._gestures();
    }

    addMode(m) {
      this.modes.push(m);
      this.pageIdx[m.id] = 0;
      m.pages.forEach((v) => this.lcd.insertBefore(v.el, this.skTop));
    }

    get mode() { return this.modes[this.modeIdx]; }
    get view() { return this.stack.length ? this.stack[this.stack.length - 1] : this.mode.pages[this.pageIdx[this.mode.id]]; }

    start() {
      this._showCurrent();
    }

    /* ------------------------------------------------------------ navigation */
    _showCurrent() {
      this.modes.forEach((m) => m.pages.forEach((v) => { if (!v.el.classList.contains('hidden')) { v.el.classList.add('hidden'); v.hide(); } }));
      const v = this.mode.pages[this.pageIdx[this.mode.id]];
      v.el.classList.remove('hidden');
      v.show();
      v.resize();
      this._refreshSoftkeys(true);
    }

    setMode(i) {
      if (this.stack.length) return;
      const n = this.modes.length;
      this.modeIdx = ((i % n) + n) % n;
      this._showCurrent();
      this.toast(this.mode.name, 700);
    }

    setPage(i) {
      const m = this.mode;
      const n = m.pages.length;
      if (n < 2) return;
      this.pageIdx[m.id] = ((i % n) + n) % n;
      this._showCurrent();
    }

    open(view) {
      this.lcd.insertBefore(view.el, this.skTop);
      view.el.classList.remove('hidden');
      view.el.style.zIndex = 5 + this.stack.length; // above the page's status bar / navbox row (z-index 3)
      this.stack.push(view);
      view.show();
      view.resize();
      this._refreshSoftkeys(true);
    }

    close() {
      const v = this.stack.pop();
      if (v) {
        v.hide();
        v.el.remove();
      }
      this._refreshSoftkeys(true);
    }

    /* ----------------------------------------------------------------- input */
    knob(name, dir) {
      if (this.off) return;
      if (name === 'vol') return this._volume(dir);
      const v = this.view;
      if (v.knob(name, dir)) return;
      if (name === 'mode') this.setMode(this.modeIdx + dir);
      else if (name === 'page' && !this.stack.length) this.setPage(this.pageIdx[this.mode.id] + dir);
    }

    button(i, long) {
      if (this.off) { this.powerOn(); return; }
      if (i === 0 && long) { this.powerOff(); return; }
      const v = this.view;
      const sk = v.softkeys();
      if (sk.persist) { v.button(i, long); this._refreshSoftkeys(); return; }
      // dynamic soft keys
      const now = performance.now();
      if (now > this.skUntil) { this.skUntil = now + SOFTKEY_TIMEOUT; this._refreshSoftkeys(); return; }
      if (!sk.labels[i]) return;
      const r = v.button(i, long);
      if (r === 'keep') this.skUntil = now + SOFTKEY_TIMEOUT;
      else this.skUntil = 0;
      this._refreshSoftkeys();
    }

    /** Volume knob changes the volume of what is currently being played. */
    _volume(dir) {
      const S = this.ctx.settings;
      const s = S.get();
      const f = this.ctx.flight.f;
      const key = f.mode === 'vario' ? 'volVario' : 'volSC';
      const v = Math.max(0, Math.min(100, s[key] + dir * 5));
      S.set({ [key]: v, mute: false });
      this.toast(`${f.mode === 'vario' ? 'Vario' : 'Speed to fly'} volume ${v}`, 900);
    }

    /* ------------------------------------------------------------- soft keys */
    _mkSoftkeys(where) {
      const el = document.createElement('div');
      el.className = 'softkeys ' + where;
      for (let i = 0; i < 4; i++) {
        const s = document.createElement('span');
        s.style.pointerEvents = 'auto';
        s.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          LX.device.press(i + (where === 'top' ? 0 : 4));
        });
        el.appendChild(s);
      }
      return el;
    }

    _refreshSoftkeys(reset) {
      if (reset) this.skUntil = 0;
      const sk = this.view.softkeys();
      const show = sk.persist || performance.now() < this.skUntil;
      const fill = (el, off) => {
        el.classList.toggle('persist', !!sk.persist);
        el.style.display = show ? 'flex' : 'none';
        [...el.children].forEach((s, i) => {
          const t = sk.labels[i + off] || '';
          s.textContent = t;
          s.classList.toggle('empty', !t);
        });
      };
      fill(this.skTop, 0);
      fill(this.skBottom, 4);
      // persistent labels sit above the menu content; dynamic ones float over the map
      this.skTop.style.display = show && sk.labels.slice(0, 4).some(Boolean) ? 'flex' : 'none';
    }

    /* ----------------------------------------------------------------- toast */
    toast(msg, ms) {
      if (!this.toastEl) {
        this.toastEl = document.createElement('div');
        this.toastEl.className = 'toast';
        this.lcd.appendChild(this.toastEl);
      }
      this.toastEl.textContent = msg;
      this.toastEl.style.display = 'block';
      clearTimeout(this._tt);
      this._tt = setTimeout(() => (this.toastEl.style.display = 'none'), ms || 1500);
    }

    /* ----------------------------------------------------------------- power */
    powerOff() {
      this.toast('FG9070 is switching off. Please wait.', 1500);
      setTimeout(() => { this.off = true; this.lcd.style.visibility = 'hidden'; }, 1500);
    }
    powerOn() {
      this.off = false;
      this.lcd.style.visibility = 'visible';
      this.toast('FG9070', 800);
      if (this.onPowerOn) this.onPowerOn();
    }

    /* ----------------------------------------------------------------- frame */
    frame(dt, now) {
      if (this.off) return;
      this.view.update(dt, now);
      // hide dynamic labels after the timeout
      if (this.skUntil && now > this.skUntil && !this.view.softkeys().persist) { this.skUntil = 0; this._refreshSoftkeys(); }
    }

    resize() {
      this.modes.forEach((m) => m.pages.forEach((v) => v.resize()));
      this.stack.forEach((v) => v.resize());
    }

    /* -------------------------------------------------------------- gestures */
    _gestures() {
      let start = null;
      this.lcd.addEventListener('pointerdown', (e) => {
        start = { x: e.clientX, y: e.clientY, t: performance.now() };
      });
      this.lcd.addEventListener('pointerup', (e) => {
        if (!start) return;
        const sc = LX.device.scale || 1;
        const dx = (e.clientX - start.x) / sc, dy = (e.clientY - start.y) / sc;
        const dt = performance.now() - start.t;
        start = null;
        if (dt > 800) return;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) LX.device.turn('mode', dx < 0 ? 1 : -1);
        else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.6) LX.device.turn('page', dy < 0 ? 1 : -1);
      });
      this.lcd.addEventListener('wheel', (e) => {
        e.preventDefault();
        LX.device.turn('zoom', e.deltaY > 0 ? -1 : 1);
      }, { passive: false });
    }
  }

  LX.View = View;
  LX.Screen = Screen;
})(window);
