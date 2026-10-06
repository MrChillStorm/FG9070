/**
 * Information mode (7.2) and Near mode (7.3).
 *
 * Information: GPS status page and a position report to the selected target.
 * Near: list of landable places with bearing, distance and arrival height;
 * GOTO makes the highlighted one the airport-mode target and switches to it.
 * Not implemented: satellite sky view, FREQ (needs radio bridge).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const fm = LX.fm;
  const clamp = LX.util.clamp;

  class TextView extends LX.View {
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
    softkeys() { return { labels: this.labels, persist: true }; }
    button(i) { if (this.labels[i]) this.scr.toast(`${this.labels[i]}: not implemented in this build`, 1500); return true; }
  }

  const K = (s) => `<span class="k">${s}</span>`;

  function gpsPage(scr, ctx) {
    return new TextView(scr, ctx, 'Info', (c) => {
      const fl = c.flight, f = fl.f;
      if (!fl.have) return 'No position fix yet.\n\n' + c.statusText();
      const t = new Date();
      const flightLevel = Math.round((f.alt * 3.28084) / 100);
      return [
        `${K('FILE:')}   (not recording)         ${K('Link:')} ${c.statusText()}`,
        `${K('Position')}  ${f.lat.toFixed(5)}°   ${f.lon.toFixed(5)}°`,
        `${K('Altitude')}  ${fm.alt(f.alt)} ${LX.units.label('alt')}   ${K('FL')} ${String(flightLevel).padStart(3, '0')}`,
        `${K('Height')}    ${fm.alt(f.alt - c.groundElev(f))} ${LX.units.label('alt')}  (above terrain, demo model)`,
        `${K('Track')}     ${fm.hdg(f.track)}     ${K('GS')} ${fm.spd(f.gs)} ${LX.units.label('speed')}     ${K('IAS')} ${fm.spd(f.ias)} ${LX.units.label('speed')}`,
        `${K('Time')}      ${t.toTimeString().slice(0, 8)}   ${K('Date')} ${t.toISOString().slice(0, 10)}`,
        '',
        `${K('GPS')}       3D fix (simulated)   ${K('Sats')} 10`,
        '',
        (() => { const ss = LX.sun.times(f.lat, f.lon, t); return `${K('Sunrise')}   ${LX.sun.fmt(ss && ss.rise)}   ${K('Sunset')} ${LX.sun.fmt(ss && ss.set)}  (UTC)`; })(),
      ].join('\n');
    }, ['', '', '', '', '', '', 'REPORT', 'MORE']);
  }

  function reportPage(scr, ctx) {
    return new TextView(scr, ctx, 'Position report', (c) => {
      const fl = c.flight, f = fl.f;
      const tg = c.nav.target('apt') || c.nav.target('tsk');
      if (!fl.have || !tg) return 'No data / no target selected';
      const d = LX.geo.dist(tg.lat, tg.lon, f.lat, f.lon);
      const rad = LX.geo.bearing(tg.lat, tg.lon, f.lat, f.lon);
      return [
        `${K('FILE:')} (not recording)`,
        `${K('Position')}   ${fm.dist(d)} ${LX.units.label('dist')}  on radial ${String(Math.round(rad)).padStart(3, '0')}°`,
        `${K('from')}       ${tg.name}`,
        `${K('Altitude')}   ${fm.alt(f.alt)} ${LX.units.label('alt')}`,
        `${K('Glider')}     ${c.flight.getPolar().name}`,
      ].join('\n');
    }, ['', '', '', '', '', '', '', '']);
  }

  /* ----------------------------------------------------------------- Near */
  class NearView extends LX.View {
    constructor(scr, ctx) {
      super(scr);
      this.ctx = ctx; this.sel = 0; this.last = 0; this.list = [];
      this.el.style.background = '#000';
      this.el.innerHTML = '<div class="titlebar">Near</div><div style="position:absolute;left:0;right:0;top:26px;bottom:26px;overflow:hidden"><table class="list"><thead><tr><th>Name</th><th>Brg</th><th>Dis</th><th>Arrival</th></tr></thead><tbody></tbody></table></div>';
      this.body = this.el.querySelector('tbody');
    }
    update(dt, now) {
      if (now - this.last < 300) return;
      this.last = now;
      const c = this.ctx, f = c.flight.f;
      if (!c.flight.have) return;
      this.list = c.nav.nearest(f.lat, f.lon, 20);
      this.sel = clamp(this.sel, 0, Math.max(0, this.list.length - 1));
      this.body.innerHTML = '';
      this.list.forEach((x, i) => {
        const n = c.flight.navTo(x.w);
        const tr = document.createElement('tr');
        if (i === this.sel) tr.className = 'sel';
        const arr = n ? LX.fmt.signed(LX.units.alt(n.arrival), 0) + LX.units.label('alt') : '--';
        const col = n && n.arrival < 0 ? '#ff7a5c' : '#7ee07e';
        tr.innerHTML = `<td>${x.w.name}</td><td>${fm.hdg(x.brg)}</td><td>${fm.dist(x.d)} ${LX.units.label('dist')}</td><td style="color:${col}">${arr}</td>`;
        tr.addEventListener('pointerdown', () => { this.sel = i; this.last = 0; });
        this.body.appendChild(tr);
      });
    }
    softkeys() { return { labels: ['', '', '', '', '', 'FREQ', 'REPORT', 'GOTO'], persist: true }; }
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
      } else if (l === 'REPORT') this.ctx.goMode('info', 1);
      else if (l) this.scr.toast(`${l}: needs a radio bridge`, 1500);
      return true;
    }
  }

  LX.info = { gpsPage, reportPage };
  LX.NearView = NearView;
})(window);
