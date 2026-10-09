/**
 * Device frame: fits the unit to the window, handles orientation, and turns
 * knob / button / keyboard / wheel input into events.
 *
 * Events (subscribe with LX.device.on):
 *   'knob'   { name: 'vol'|'mode'|'zoom'|'page', dir: +1|-1 }   one detent
 *   'button' { index: 0..7, long: bool }  0-3 top row, 4-7 bottom row
 *   'resize' { portrait: bool, w, h }     LCD logical size changed
 *   'gesture'{ kind: 'swipe', dir: 'left'|'right'|'up'|'down' }
 *
 * Keyboard (also shown in the README):
 *   ← →  MODE      ↑ ↓  PAGE      + −  ZOOM      [ ]  VOLUME
 *   1…8  buttons (1-4 top row, 5-8 bottom row)
 *   Enter = lower-right button (SELECT)   Esc = lower-left button (CLOSE/BACK)
 *   N night   O orientation   M mute
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const $ = (s, r) => (r || document).querySelector(s);

  const handlers = {};
  const on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  const emit = (ev, d) => (handlers[ev] || []).forEach((fn) => fn(d));

  const dev = (LX.device = { on, emit, portrait: false, w: 800, h: 480 });

  const deviceEl = $('#device');
  const detentDeg = 22; // degrees of drag per detent

  /* ------------------------------------------------------------ orientation */
  function wantPortrait() {
    const o = LX.settings.get().orientation;
    if (o === 'portrait') return true;
    if (o === 'landscape') return false;
    return window.innerHeight > window.innerWidth * 1.05;
  }

  function layout() {
    const portrait = wantPortrait();
    const changed = portrait !== dev.portrait || !dev.w;
    dev.portrait = portrait;
    deviceEl.classList.toggle('portrait', portrait);
    deviceEl.classList.toggle('landscape', !portrait);
    dev.w = portrait ? 480 : 800;
    dev.h = portrait ? 800 : 480;
    const W = dev.w + 48, H = dev.h + 144;
    const s = Math.min((window.innerWidth - 12) / W, (window.innerHeight - 12) / H, 1.8);
    deviceEl.style.transform = `translate(-50%, -50%) scale(${s})`;
    dev.scale = s;
    if (changed || dev._forced) emit('resize', { portrait, w: dev.w, h: dev.h });
    dev._forced = false;
  }
  dev.relayout = () => { dev._forced = true; layout(); };
  /** Toggle portrait/landscape (button, `O` key). From 'auto' it switches to the opposite of what is shown. */
  dev.rotate = () => LX.settings.set({ orientation: dev.portrait ? 'landscape' : 'portrait' });
  const rotBtn = document.getElementById('rot');
  if (rotBtn) rotBtn.addEventListener('click', dev.rotate);
  window.addEventListener('resize', layout);

  /* ------------------------------------------------------------------ knobs */
  const angles = { vol: 0, mode: 0, zoom: 0, page: 0 };

  function turn(name, dir) {
    angles[name] += dir * detentDeg;
    const el = $(`[data-knob="${name}"]`);
    if (el) el.style.setProperty('--a', angles[name] + 'deg');
    emit('knob', { name, dir });
  }
  dev.turn = turn;

  document.querySelectorAll('.knob').forEach((el) => {
    const name = el.dataset.knob;
    let drag = null;
    const angleAt = (e) => {
      const r = el.getBoundingClientRect();
      return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      drag = { a: angleAt(e), acc: 0 };
      LX.device.unlockAudio && LX.device.unlockAudio();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = angleAt(e);
      let d = a - drag.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      drag.a = a;
      drag.acc += d;
      while (Math.abs(drag.acc) >= detentDeg) {
        const dir = drag.acc > 0 ? 1 : -1;
        drag.acc -= dir * detentDeg;
        turn(name, dir);
      }
    });
    const end = () => { drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); const st = dev.wheelStep(e); if (st) turn(name, st); }, { passive: false });
  });

  /* ---------------------------------------------------------------- buttons */
  document.querySelectorAll('.pbtn').forEach((el) => {
    const index = parseInt(el.dataset.btn, 10);
    let timer = null, long = false;
    el.addEventListener('pointerdown', () => {
      long = false;
      el.classList.add('down');
      LX.device.unlockAudio && LX.device.unlockAudio();
      timer = setTimeout(() => { long = true; emit('button', { index, long: true }); }, 1200);
    });
    const up = () => {
      el.classList.remove('down');
      if (timer) { clearTimeout(timer); timer = null; if (!long) emit('button', { index, long: false }); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', () => { el.classList.remove('down'); clearTimeout(timer); timer = null; });
  });

  /* --------------------------------------------------------------- keyboard */
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    LX.device.unlockAudio && LX.device.unlockAudio();
    const k = e.key;
    let used = true;
    if (k === 'ArrowRight') turn('mode', 1);
    else if (k === 'ArrowLeft') turn('mode', -1);
    else if (k === 'ArrowDown') turn('page', 1);
    else if (k === 'ArrowUp') turn('page', -1);
    else if (k === '+' || k === '=') turn('zoom', 1);
    else if (k === '-' || k === '_') turn('zoom', -1);
    else if (k === ']') turn('vol', 1);
    else if (k === '[') turn('vol', -1);
    else if (/^[1-8]$/.test(k)) pulse(parseInt(k, 10) - 1);
    else if (k === 'Enter') pulse(7);
    else if (k === 'Escape') pulse(4);
    else if (k === 'n' || k === 'N') LX.settings.set({ night: !LX.settings.get().night });
    else if (k === 'o' || k === 'O') dev.rotate();
    else if (k === 'm' || k === 'M') LX.settings.set({ mute: !LX.settings.get().mute });
    else if (k === '?') { const h = document.getElementById('help'); h.hidden = !h.hidden; }
    else used = false;
    if (used) e.preventDefault();
  });

  /**
   * Wheel / trackpad input -> detent steps. A mouse wheel click is about 100 px; a trackpad swipe is a burst of many
   * small events (plus inertia), so movement is accumulated and turned into at most one step per 180 ms.
   * Returns -1, 0 or +1 (sign of the scroll direction).
   */
  let wheelAcc = 0, wheelLast = 0, wheelStepAt = 0;
  dev.wheelStep = (e) => {
    const now = performance.now();
    if (now - wheelLast > 300) wheelAcc = 0; // a new gesture
    wheelLast = now;
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheelAcc) < 60 || now - wheelStepAt < 180) return 0;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0; wheelStepAt = now;
    return dir;
  };

  function pulse(index) {
    const el = $(`[data-btn="${index}"]`);
    if (el) { el.classList.add('down'); setTimeout(() => el.classList.remove('down'), 120); }
    emit('button', { index, long: false });
  }
  dev.press = pulse;

  LX.settings.onChange((s, changed) => {
    if (changed.indexOf('night') >= 0) deviceEl.classList.toggle('night', s.night);
    if (LX.setup2 && ['night', 'autoBright', 'brightness', 'nightBright'].some((k) => changed.indexOf(k) >= 0)) LX.setup2.brightness();
    if (changed.indexOf('orientation') >= 0) layout();
  });

  /** Called once settings are loaded. */
  dev.init = () => {
    deviceEl.classList.toggle('night', LX.settings.get().night);
    layout();
    if (LX.setup2) LX.setup2.brightness();
  };
})(window);
