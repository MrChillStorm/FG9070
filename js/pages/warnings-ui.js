/**
 * Warning dialogs (shown in every mode, like the real unit) and Setup >
 * Warnings. The decision logic is in nav/warnings.js.
 *
 * Airspace warning buttons (manual 7.1.10.1): QUIT hides the message, the
 * lower-middle button shows the dismiss time in minutes (PAGE knob changes it),
 * DISMISS and that button both silence this zone for that long. An alarmed zone stays drawn with a
 * thick outline and its distance on the map.
 *
 * Not simulated: gear warning (no retractable gear on the gliders here).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const { FormView, MenuView, Popup } = LX.forms;
  const U = () => LX.units;
  const num = (v, d) => LX.fmt.num(v, d);

  /** Generic warning popup that refreshes itself and closes when `still()` goes false. */
  class WarningView extends LX.View {
    constructor(scr, ctx, o) {
      super(scr);
      this.ctx = ctx; this.o = o;
      this.el.className = 'view hidden dlg-overlay over';
      this.el.innerHTML = '<div class="popup"><div class="title"></div><div class="body" style="white-space:pre;line-height:24px"></div><canvas width="120" height="120" style="display:none;margin:4px auto"></canvas></div>';
      this.pop = this.el.firstChild;
      this.pop.style.borderColor = o.level === 'red' ? '#ff3b30' : '#ff9a1f';
      this.pop.firstChild.style.background = o.level === 'red' ? '#7a1610' : '#7a4a10';
      this.pop.firstChild.textContent = o.title;
      this.body = this.pop.children[1];
      this.gc = this.pop.children[2];
      if (o.graphic) this.gc.style.display = 'block';
      this.minutes = ctx.settings.get().warnDismissMin;
      this.last = 0;
    }
    update(dt, now) {
      if (now - this.last < 250) return;
      this.last = now;
      const st = this.o.state(); // { text, level } or null when cleared
      if (!st) { this.scr.close(); return; }
      this.body.textContent = st.text;
      if (this.o.graphic && st.target) this.drawGraphic(st.target);
      this.pop.style.borderColor = st.level === 'red' ? '#ff3b30' : '#ff9a1f';
    }
    /** Mini radar: own glider in the centre (nose up) and the threatening target with its track. */
    drawGraphic(t) {
      const g = this.gc.getContext('2d'), w = 120, cx = 60, cy = 60;
      g.clearRect(0, 0, w, w); g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
      g.strokeStyle = '#2d7a3f'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 56, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, 28, 0, 7); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8); g.moveTo(cx - 10, cy); g.lineTo(cx + 10, cy); g.stroke();
      const range = Math.max(1000, Math.ceil(t.dist / 1000) * 1000);
      const x = cx + (t.e / range) * 56, y = cy - (t.n / range) * 56;
      g.save(); g.translate(x, y); g.rotate((t.track - (this.ctx.flight.f.track || 0)) * Math.PI / 180);
      g.fillStyle = '#ff3b30'; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    softkeys() {
      const l = ['', '', '', '', 'QUIT', '', '', ''];
      const b = this.o.buttons(this);
      Object.keys(b).forEach((k) => (l[k] = b[k].label));
      return { labels: l, persist: true };
    }
    knob(name, dir) {
      if (this.o.dismissable && name === 'page') { this.minutes = Math.max(1, Math.min(1440, this.minutes + dir)); this.scr._refreshSoftkeys(); return true; }
      return true; // swallow other knobs while a warning is up (except volume, handled by Screen)
    }
    button(i) {
      if (i === 4) { this.o.quit && this.o.quit(); this.scr.close(); return true; }
      const b = this.o.buttons(this)[i];
      if (b) { b.run(); return true; }
      return false;
    }
  }

  /** FLARM warning text and spoken message from the "Warning includes" settings (manual 7.1.10.3). */
  function flarmText(cur, ctx) {
    const st = ctx.settings.get(), t = cur.target, f = ctx.flight.f;
    const relDeg = (Math.atan2(t.e, t.n) * 180 / Math.PI + 360) % 360; // bearing from the nose
    const trueDeg = (relDeg + (f.track || 0)) % 360;
    const useRel = st.flarmBearing === 'relative' || (st.flarmBearing === 'both' && !f.circling);
    const where = useRel ? `${cur.clock} o'clock` : `from ${String(Math.round(trueDeg)).padStart(3, '0')}°`;
    const hz = `${num(U().dist(t.dist), 1)} ${U().label('dist')}`;
    const vt = `${LX.fmt.signed(U().alt(t.dh), 0)} ${U().label('alt')}`;
    const lines = [`${t.id}  ${where}`];
    const parts = [];
    if (st.flarmVoiceH) parts.push(hz);
    if (st.flarmVoiceV) parts.push(vt);
    lines.push(parts.join('   ') || '');
    const high = Math.abs(t.dh) < 30 ? 'level' : t.dh > 0 ? 'high' : 'low';
    const speech = `Traffic ${useRel ? cur.clock + " o'clock" : 'from ' + Math.round(trueDeg) + ' degrees'}` +
      (st.flarmVoiceV ? `, ${high}` : '') + (st.flarmVoiceH ? `, ${Math.round(t.dist / 100) * 100} meters` : '');
    return { text: lines.join('\n'), speech };
  }

  /* ------------------------------------------------------------ engine glue */
  function install(scr, ctx) {
    const W = ctx.warnings;
    let open = null; // key of the warning view currently shown
    const isOpen = () => scr.stack.some((v) => v instanceof WarningView);
    let lastTick = 0;
    const flarmMute = { until: 0 };

    ctx.warnTick = function (now) {
      if (now - lastTick < 1000) return;
      lastTick = now;
      const f = ctx.flight.f;
      if (!ctx.flight.have || scr.off) return;
      const settings = ctx.settings.get();

      // mark alarmed zones for the map (also while dismissed)
      const all = W.airspace(f, now);
      (ctx.nav.airspaces || []).forEach((z) => { delete z.alarm; });
      all.forEach((w) => { if (w.level) w.zone.alarm = { level: w.level, dist: w.dist }; });

      const active = W.activeAirspace(f, now);
      let alarm = active.length ? active[0].level : null;

      if (!isOpen() && active.length) {
        const z = active[0].zone;
        const stateOf = () => {
          const cur = W.airspace(ctx.flight.f, performance.now()).find((x) => x.zone === z);
          if (!cur || !cur.level) return null;
          const sg = (m) => `${num(U().alt(m), 0)} ${U().label('alt')}`;
          return {
            level: cur.level,
            text: `${cur.inside ? 'Inside' : 'Projected crossing'}  •  ${cur.inside ? '0' : num(U().dist(cur.dist), 1)} ${U().label('dist')}\n${sg(z.lower)} - ${sg(z.upper)}   Class ${z.cls}`,
          };
        };
        scr.open(new WarningView(scr, ctx, {
          level: active[0].level, title: `AIRSPACE  ${z.name}`, dismissable: true, state: stateOf,
          quit: () => W.quit(z, performance.now(), active[0].level),
          buttons: (v) => {
            // the minutes button and DISMISS both silence this zone for v.minutes (PAGE knob changes the minutes)
            const dismiss = () => {
              const go = () => { W.dismiss(z, v.minutes, performance.now(), active[0].level); scr.close(); };
              if (settings.warnConfirm) scr.open(new Popup(scr, 'Dismiss', `Dismiss ${z.name} for ${v.minutes} min?`, { 4: { label: 'NO', run: (s) => s.close() }, 7: { label: 'YES', run: (s) => { s.close(); go(); } } }));
              else go();
            };
            return { 6: { label: `${v.minutes} min`, run: dismiss }, 7: { label: 'DISMISS', run: dismiss } };
          },
        }));
      }

      // altitude warning
      if (!isOpen()) {
        const a = W.altitude(f, now);
        if (a) {
          scr.open(new WarningView(scr, ctx, {
            level: 'orange', title: 'ALTITUDE', state: () => ({ level: 'orange', text: `Approaching ${num(U().alt(a.alt), 0)} ${U().label('alt')} from ${a.dir === 'above' ? 'below' : 'above'}` }),
            buttons: () => ({
              5: { label: '1 min', run: () => { W.dismissAltitude(1, performance.now()); scr.close(); } },
              6: { label: '5 min', run: () => { W.dismissAltitude(5, performance.now()); scr.close(); } },
              7: { label: 'DISABLE', run: () => { ctx.settings.set({ warnAlt: false }); scr.close(); } },
            }),
            quit: () => W.dismissAltitude(0.25, performance.now()),
          }));
        }
      } else if (W.altitude(f, now) === null && false) { /* altitude view closes via its own state */ }

      // time alarms + waypoint
      W.timeAlarms(f.flightTime || 0).forEach((i) => { scr.toast(`Time alarm ${i + 1}`, 4000); alarm = alarm || 'orange'; });
      if (ctx.settings.get().sunsetAlarm && ctx.ref) {
        const ss = LX.sun.times(f.lat, f.lon, new Date());
        const left = ss ? (ss.set - Date.now()) / 60000 : 1e9;
        if (left < 60 && left > 0 && !W.sunsetWarned) { W.sunsetWarned = true; scr.toast('Sunset in less than 1 hour', 5000); alarm = alarm || 'orange'; }
        if (left > 70) W.sunsetWarned = false;
      }
      const wp = W.waypoint(ctx.navFor('tsk', f));
      if (wp) scr.toast(`Waypoint ${wp}`, 3000);

      // FLARM
      if (!isOpen() && now > flarmMute.until) {
        const fl = W.flarm(ctx.traffic.relative(f, 0));
        if (fl) {
          const stateOf = () => {
            const cur = W.flarm(ctx.traffic.relative(ctx.flight.f, 0));
            if (!cur) return null;
            return { level: cur.level >= 3 ? 'red' : 'orange', text: flarmText(cur, ctx).text, target: cur.target };
          };
          const first = flarmText(fl, ctx);
          if (ctx.settings.get().flarmVoice && first.speech) LX.speech.say(first.speech, true);
          scr.open(new WarningView(scr, ctx, {
            level: fl.level >= 3 ? 'red' : 'orange', title: 'FLARM', state: stateOf, graphic: ctx.settings.get().flarmGraphic,
            quit: () => { flarmMute.until = performance.now() + 15000; },
            buttons: () => ({
              6: { label: 'CIRC.OFF', run: () => { flarmMute.until = performance.now() + 120000; scr.close(); } },
              7: { label: '1 min', run: () => { flarmMute.until = performance.now() + 60000; scr.close(); } },
            }),
          }));
          alarm = fl.level >= 3 ? 'red' : (alarm || 'orange');
        }
      }
      ctx.audio.setAlarm(isOpen() ? alarm || 'orange' : null);
    };
  }

  /* ------------------------------------------------------------ Setup dialogs */
  const bind = (key) => ({ get: () => LX.settings.get()[key], set: (v) => LX.settings.set({ [key]: v }) });
  const spin = (label, key, min, max, step, fmt, extra) => Object.assign({ type: 'spin', label, min, max, step, fmt }, bind(key), extra || {});
  const check = (text, key) => Object.assign({ type: 'check', label: '', text }, bind(key));

  function warningsMenu(scr, ctx) {
    const dist = (v) => num(U().dist(v), 1) + ' ' + U().label('dist');
    const alt = (v) => num(U().alt(v), 0) + ' ' + U().label('alt');
    const form = (title, fields) => (s) => s.open(new FormView(s, { title, fields }));
    return new MenuView(scr, [
      { label: 'Airspace Warnings', color: '#ff5a4a', run: form('Airspace Warnings', [
        check('Airspace warnings', 'warnAirspace'),
        spin('Time', 'warnTime', 5, 300, 5, (v) => v + ' s', { coarse: 6 }),
        spin('Horz.buffer', 'warnHorz', 0, 10000, 100, dist, { coarse: 5 }),
        spin('Vert.buffer', 'warnVert', 0, 1000, 10, alt, { coarse: 5 }),
        spin('Dismiss for', 'warnDismissMin', 1, 1440, 1, (v) => v + ' min', { coarse: 10 }),
        check('Confirm dismiss', 'warnConfirm'),
      ]) },
      { label: 'Altitude Warning', color: '#ffb000', run: form('Altitude Warning', [
        check('Altitude warning', 'warnAlt'),
        spin('Altitude (MSL)', 'warnAltValue', 0, 8000, 10, alt, { coarse: 10 }),
        spin('Time', 'warnAltTime', 5, 120, 5, (v) => v + ' s'),
        Object.assign({ type: 'select', label: 'Approaching', options: ['above', 'below'], show: (v) => (v === 'above' ? 'from below (climbing into it)' : 'from above (sinking into it)') }, bind('warnAltDir')),
      ]) },
      { label: 'FLARM Warnings', color: '#5fd0ff', run: form('FLARM Warnings', [
        Object.assign({ type: 'select', label: 'Alarm level', options: ['No alarm', 'Low', 'Medium', 'High'] }, bind('flarmWarn')),
        { type: 'section', label: 'Warning includes' },
        check('Horizontal distance', 'flarmVoiceH'),
        check('Vertical distance', 'flarmVoiceV'),
        Object.assign({ type: 'select', label: 'Direction', options: ['relative', 'true', 'both'], show: (v) => ({ relative: 'Relative bearing (o\'clock)', true: 'True bearing', both: 'Relative, true when circling' }[v]) }, bind('flarmBearing')),
        check('Graphical presentation', 'flarmGraphic'),
        check('Voice message (needs browser speech)', 'flarmVoice'),
        { type: 'section', label: 'Traffic comes from FlightGear AI/multiplayer models when connected (Setup > Hardware), else it is simulated.' },
      ]) },
      { label: 'Time Alarm', color: '#ffd400', run: form('Time Alarm', [
        spin('Alarm 1', 'timeAlarm1', 0, 600, 5, (v) => (v ? `every ${v} min` : 'off')),
        spin('Alarm 2', 'timeAlarm2', 0, 600, 5, (v) => (v ? `every ${v} min` : 'off')),
        spin('Alarm 3', 'timeAlarm3', 0, 600, 5, (v) => (v ? `every ${v} min` : 'off')),
        Object.assign({ type: 'check', label: 'Sunset', text: 'Alarm 1 h before sunset' }, bind('sunsetAlarm')),
      ]) },
      { label: 'Gear Warning', color: '#8a8f99', run: (s) => s.open(new Popup(s, 'Gear Warning', 'Not simulated (no retractable gear).', { 7: { label: 'OK', run: (x) => x.close() } })) },
      { label: 'Waypoint Warning', color: '#7ee07e', run: form('Waypoint Warning', [spin('Distance', 'warnWpt', 0, 20000, 100, (v) => (v ? dist(v) : 'off'), { coarse: 10 })]) },
    ], { title: 'Warnings' });
  }

  LX.warningsUI = { install, warningsMenu, WarningView, flarmText };
})(window);
