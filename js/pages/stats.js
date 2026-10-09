/**
 * Statistics mode (manual 7.4). Three pages (PAGE knob):
 *   general  in flight: the last four thermals as coloured columns (red >= Mc+0.5,
 *            orange about Mc, blue <= Mc-0.5) + flight statistics;
 *            on the ground: the logbook (VIEW replays a flight, SAVE exports IGC,
 *            DELETE removes it)
 *   task     detailed task statistics: legs with distance, time and speed
 *   olc      optimised distance (free / FAI triangle) from the recorded path
 *
 * Replay (VIEW): map with the flown path coloured by altitude / ground speed /
 * climb, a barogram, and four sub-views (map, statistics, optimisation, task).
 * Not implemented: SaveToSD/Connect, OLC points scoring.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const sym = LX.symbols;
  const fm = LX.fm;
  const clamp = LX.util.clamp;

  const sizeCanvas = (v) => {
    const d = LX.device;
    const r = Math.max(1, Math.ceil((d.scale || 1) * (window.devicePixelRatio || 1)));
    v.cv.width = d.w * r; v.cv.height = d.h * r;
    v.cv.style.width = d.w + 'px'; v.cv.style.height = d.h + 'px';
    v.c.setTransform(r, 0, 0, r, 0, 0);
    v.W = d.w; v.H = d.h; v.last = 0;
  };

  const optimise = (fixes, S) => {
    if (!fixes || fixes.length < 5) return null;
    const s = S.get();
    const free = LX.Optimizer.free(fixes, s.optPoints === 5 ? 3 : 1);
    const tri = LX.Optimizer.triangle(fixes);
    return { free, tri: tri && Math.min(...tri.legs) / tri.dist >= s.optFaiMin ? tri : null };
  };

  /* ------------------------------------------------------------ stats pages */
  class StatsView extends LX.View {
    constructor(scr, ctx, kind) {
      super(scr);
      this.ctx = ctx; this.kind = kind;
      this.cv = document.createElement('canvas');
      this.cv.className = 'layer';
      this.el.appendChild(this.cv);
      this.c = this.cv.getContext('2d');
      this.logSel = 0; this.last = 0;
      this.opt = null; this.optT = 0;
    }
    show() { this.resize(); }
    resize() { sizeCanvas(this); }

    update(dt, now) {
      if (now - this.last < 200) return;
      this.last = now;
      const fl = this.ctx.flight;
      const c = this.c;
      c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H);
      c.fillStyle = '#4a4d53'; c.fillRect(0, 0, this.W, 24);
      const title = { general: fl.flying ? 'Statistics' : 'Logbook', task: 'Statistics - Task', olc: 'Statistics - OLC' }[this.kind];
      sym.otext(c, title, this.W / 2, 18, 15, { align: 'center', weight: 'normal', halo: 'transparent' });
      if (this.kind === 'general') { if (fl.flying) this.drawFlight(fl); else this.drawLogbook(); }
      else if (this.kind === 'task') this.drawTask();
      else this.drawOlc(now);
    }

    /* ---- in-flight general statistics */
    drawFlight(fl) {
      const c = this.c, W = this.W, H = this.H, mc = this.ctx.settings.get().mc;
      const showTh = this.showThermals !== false; // THERMALS soft key (manual 7.4.2)
      const chartH = showTh ? Math.round(H * 0.4) : 0;
      const x0 = 56, y0 = 36, cw = W - x0 - 100, ch = chartH - 28;
      if (showTh) {
        const nTh = this.ctx.settings.get().thermalsCount || 4;
        const ths = fl.thermals.slice(-nTh);
        const amin = Math.min(...ths.map((t) => t.alt0), fl.f.alt) - 100;
        const amax = Math.max(...ths.map((t) => t.alt1), fl.f.alt) + 100;
        c.strokeStyle = '#3a3d44'; c.lineWidth = 1; c.strokeRect(x0, y0, cw, ch);
        c.font = '11px Verdana'; c.fillStyle = '#9aa0aa'; c.textAlign = 'right';
        for (let i = 0; i <= 3; i++) {
          const a = amin + ((amax - amin) * i) / 3, y = y0 + ch - (ch * i) / 3;
          c.fillText(Math.round(LX.units.alt(a)) + '', x0 - 4, y + 4);
          c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + cw, y); c.stroke();
        }
        if (!ths.length) sym.otext(c, 'No thermals yet', x0 + cw / 2, y0 + ch / 2, 16, { align: 'center', weight: 'normal' });
        ths.forEach((t, i) => {
          const colw = cw / nTh, x = x0 + colw * i + colw * 0.2, w = colw * 0.6;
          const yTop = y0 + ch - ((t.alt1 - amin) / (amax - amin)) * ch, yBot = y0 + ch - ((t.alt0 - amin) / (amax - amin)) * ch;
          c.fillStyle = t.avg >= mc + 0.5 ? '#ff3b30' : t.avg <= mc - 0.5 ? '#2f7bff' : '#ff9a1f';
          c.fillRect(x, yTop, w, yBot - yTop);
          c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = '13px Verdana';
          c.fillText(fm.vario(t.avg), x + w / 2, y0 + ch + 16);
          // between thermals: average efficiency of the glide (manual 7.4.2)
          if (i > 0) { const p = ths[i - 1]; const d = geo.dist(p.lat, p.lon, t.lat, t.lon); const lost = p.alt1 - t.alt0; c.fillStyle = '#8fb6ff'; c.font = '11px Verdana'; c.fillText(lost > 20 ? `E ${Math.round(d / lost)}` : '', x0 + colw * i, y0 + 12); }
        });
        const avg4 = fl.lastThermalsAvg(4);
        sym.otext(c, avg4 === null ? '---' : fm.vario(avg4), W - 14, y0 + 40, 30, { align: 'right', color: '#ff7a5c' });
        sym.otext(c, LX.units.label('vario'), W - 14, y0 + 62, 13, { align: 'right', weight: 'normal' });
      }
      const f = fl.f;
      const circPct = fl.thermals.length ? Math.round((fl.thermals.reduce((a, t) => a + t.dur, 0) / Math.max(1, f.flightTime)) * 100) : 0;
      const rows = [
        ['Avg. vario', fm.vario(f.avgV) + ' ' + LX.units.label('vario')],
        ['Ground speed', fm.spd(f.gs) + ' ' + LX.units.label('speed')],
        ['Dist. flown', fm.dist(this.ctx.flownDist) + ' ' + LX.units.label('dist')],
        ['Circling', circPct + '%'],
        ['Thermals', String(fl.thermals.length)],
        ['Duration', fm.hms(f.flightTime)],
        ['Max altitude', fm.alt(fl.maxAlt || f.alt) + ' ' + LX.units.label('alt')],
      ];
      rows.forEach((r, i) => {
        const col = LX.device.portrait ? 0 : i % 2, row = LX.device.portrait ? i : Math.floor(i / 2);
        const x = 14 + col * (W / 2), y = chartH + 60 + row * 30;
        sym.otext(c, r[0], x, y, 14, { weight: 'normal', color: '#8fb6ff', align: 'left', halo: 'transparent' });
        sym.otext(c, r[1], x + 130, y, 17, { align: 'left', halo: 'transparent' });
      });
    }

    /* ---- logbook */
    flights() { return this.ctx.recorder ? this.ctx.recorder.flights : []; }
    drawLogbook() {
      const c = this.c, W = this.W, flights = this.flights();
      c.font = '12px Verdana'; c.fillStyle = '#8fb6ff'; c.textAlign = 'left';
      const cols = [10, 60, 170, 260, 370, 480];
      ['No.', 'Date', 'Start', 'Duration', 'Max alt', 'Task'].forEach((h, i) => c.fillText(h, cols[i], 44));
      if (!flights.length) sym.otext(c, 'No flights recorded yet', W / 2, 120, 16, { align: 'center', weight: 'normal' });
      flights.slice(0, 14).forEach((f, i) => {
        const y = 66 + i * 24;
        if (i === this.logSel) { c.fillStyle = '#5b5f66'; c.fillRect(4, y - 16, W - 8, 22); }
        c.fillStyle = '#fff'; c.font = '14px Verdana';
        [String(i + 1), f.date, f.start, fm.hms(f.dur), fm.alt(f.maxAlt) + ' ' + LX.units.label('alt'), f.task || ''].forEach((t, k) => c.fillText(t, cols[k], y));
      });
      this.nFlights = flights.length;
    }

    /* ---- detailed task statistics */
    drawTask() {
      const c = this.c, W = this.W, n = this.ctx.nav, r = this.ctx.runner, f = this.ctx.flight.f;
      c.textAlign = 'left';
      if (!n.task.length) { sym.otext(c, 'No task', W / 2, 120, 16, { align: 'center', weight: 'normal' }); return; }
      sym.otext(c, `${n.options.name || 'TASK'}   ${fm.dist(LX.TaskTools.distance(n))} ${LX.units.label('dist')}${n.options.aatTime ? '   AAT ' + n.options.aatTime + ' min' : ''}`, 10, 46, 14, { weight: 'normal', color: '#8fb6ff', halo: 'transparent' });
      const cols = [10, 250, 380, 520];
      c.font = '12px Verdana'; c.fillStyle = '#8fb6ff';
      ['Name', 'Dist', 'Time', 'Speed'].forEach((h, i) => c.fillText(h, cols[i], 68));
      c.font = '15px Verdana';
      n.task.forEach((p, i) => {
        const y = 92 + i * 26;
        const leg = r.legs.find((l, k) => k === i);
        c.fillStyle = i === n.active && n.started && !n.finished ? '#ffd400' : '#fff';
        const nm = i === 0 ? 'START' : i === n.task.length - 1 ? 'FINISH' : `${i}. POINT`;
        c.fillText(`${nm}  ${p.wp.name}`, cols[0], y);
        if (leg && i > 0) {
          const prev = r.legs[i - 1];
          const dt = (leg.t - prev.t) / 1000;
          c.fillText(`${fm.dist(leg.dist)} ${LX.units.label('dist')}`, cols[1], y);
          c.fillText(fm.hms(dt), cols[2], y);
          c.fillText(`${fm.spd(leg.dist / Math.max(1, dt))} ${LX.units.label('speed')}`, cols[3], y);
        } else if (i === 0 && leg) c.fillText(new Date(Date.now() - (f.t - leg.t)).toTimeString().slice(0, 8), cols[2], y);
        else if (i > 0) { c.fillStyle = '#6a6e76'; c.fillText('---', cols[1], y); }
      });
      const y = 92 + n.task.length * 26 + 14;
      c.fillStyle = '#8fb6ff'; c.font = '14px Verdana';
      c.fillText('TOTAL', cols[0], y);
      c.fillStyle = '#fff';
      if (n.started) {
        const el = ((n.finished ? n.finishTime : f.t) - n.startTime) / 1000;
        c.fillText(`${fm.dist(Math.max(0, LX.TaskTools.distance(n) - LX.TaskTools.remaining(n, f)))} ${LX.units.label('dist')}`, cols[1], y);
        c.fillText(fm.hms(el), cols[2], y);
        c.fillText(`${fm.spd(r.taskSpeed(f, f.t))} ${LX.units.label('speed')}`, cols[3], y);
      } else c.fillText('not started', cols[1], y);
    }

    /* ---- OLC / FAI optimisation */
    drawOlc(now) {
      const c = this.c, W = this.W, rec = this.ctx.recorder;
      const src = rec && (rec.cur && rec.cur.fixes.length > 5 ? rec.cur : rec.flights[0]);
      if (now - this.optT > 8000) { this.optT = now; this.opt = src ? optimise(src.fixes, this.ctx.settings) : null; }
      c.textAlign = 'left';
      if (!this.opt) { sym.otext(c, 'No flight to optimise yet', W / 2, 120, 16, { align: 'center', weight: 'normal' }); return; }
      const s = this.ctx.settings.get();
      const row = (y, label, res, color) => {
        sym.otext(c, label, 10, y, 14, { weight: 'normal', color: '#8fb6ff', halo: 'transparent' });
        if (!res) { sym.otext(c, '---', 250, y, 17, { halo: 'transparent' }); return; }
        sym.otext(c, `${fm.dist(res.dist)} ${LX.units.label('dist')}`, 250, y, 20, { halo: 'transparent', color });
        sym.otext(c, `${fm.spd(LX.Optimizer.speed(res))} ${LX.units.label('speed')}`, 420, y, 17, { halo: 'transparent' });
        sym.otext(c, res.legs.map((l) => fm.dist(l)).join(' / ') + ' ' + LX.units.label('dist'), 10, y + 22, 13, { weight: 'normal', halo: 'transparent', color: '#c8ccd2' });
      };
      sym.otext(c, `Optimization: ${s.optPoints} points`, 10, 46, 13, { weight: 'normal', color: '#8fb6ff', halo: 'transparent' });
      row(84, s.optPoints === 5 ? 'Free distance (OLC, 3 TP)' : 'Free distance (1 TP)', this.opt.free, '#7ee07e');
      row(160, 'FAI triangle (simplified)', this.opt.tri, '#ffd400');
      sym.otext(c, 'Distance only; not an official score. Source: ' + (src === (rec && rec.cur) ? 'current flight' : 'last flight'), 10, this.H - 30, 12, { weight: 'normal', color: '#8a8f99', halo: 'transparent' });
    }

    softkeys() {
      const fl = this.ctx.flight;
      if (this.kind === 'general') return { labels: fl.flying ? ['', '', '', '', '', '', 'THERMALS', ''] : ['', '', '', '', '', 'VIEW', 'SAVE', 'DELETE'], persist: true };
      return { labels: ['', '', '', '', '', '', '', ''], persist: true };
    }
    button(i) {
      const l = this.softkeys().labels[i];
      const rec = this.ctx.recorder;
      if (l === 'THERMALS') { this.showThermals = this.showThermals === false; }
      else if (l === 'VIEW' && rec && rec.flights[this.logSel]) this.scr.open(LX.replay.view(this.scr, this.ctx, this.logSel));
      else if (l === 'SAVE') { if (rec && rec.flights[this.logSel] && rec.downloadIGC(this.logSel)) this.scr.toast('IGC file downloaded (unofficial)', 2500); else this.scr.toast('No flight selected', 1500); }
      else if (l === 'DELETE' && rec && rec.flights[this.logSel]) this.scr.open(new LX.forms.Popup(this.scr, 'Delete flight', 'Delete this flight from the logbook?', { 4: { label: 'NO', run: (s) => s.close() }, 7: { label: 'YES', run: (s) => { rec.remove(this.logSel); this.logSel = 0; s.close(); } } }));
      return true;
    }
    knob(name, dir) {
      if (name === 'page' && this.kind === 'general' && !this.ctx.flight.flying) { this.logSel = clamp(this.logSel + dir, 0, Math.max(0, (this.nFlights || 1) - 1)); return true; }
      return false;
    }
  }

  /* ---------------------------------------------------------------- replay */
  const METRICS = ['altitude', 'ground speed', 'climb'];

  class ReplayView extends LX.View {
    constructor(scr, ctx, index) {
      super(scr);
      this.ctx = ctx;
      this.rec = ctx.recorder.get(index);
      this.fixes = this.rec.fixes;
      this.sub = 0; // 0 map, 1 statistics, 2 optimisation, 3 task
      this.metric = 0;
      this.cursor = 0;
      this.zoom = 1;
      this.cv = document.createElement('canvas'); this.cv.className = 'layer'; this.el.appendChild(this.cv);
      this.c = this.cv.getContext('2d');
      this.st = LX.flightStats(this.fixes);
      this.opt = optimise(this.fixes, ctx.settings);
      this.climb = this.fixes.map((f, i) => (i ? (f[3] - this.fixes[i - 1][3]) / Math.max(1, f[0] - this.fixes[i - 1][0]) : 0));
    }
    show() { this.resize(); }
    resize() { sizeCanvas(this); }
    softkeys() { return { labels: ['', '', '', '', 'CLOSE', 'VIEW', this.sub === 0 ? 'COLOR' : '', ''], persist: true }; }
    button(i) {
      const l = this.softkeys().labels[i];
      if (l === 'CLOSE') this.scr.close();
      else if (l === 'VIEW') this.sub = (this.sub + 1) % 4;
      else if (l === 'COLOR') this.metric = (this.metric + 1) % METRICS.length;
      this.last = 0;
      return true;
    }
    knob(name, dir) {
      if (name === 'page') this.cursor = clamp(this.cursor + dir * Math.max(1, Math.round(this.fixes.length / 80)), 0, this.fixes.length - 1);
      else if (name === 'zoom') this.zoom = clamp(this.zoom * (dir > 0 ? 1.5 : 1 / 1.5), 1, 30);
      this.last = 0;
      return true;
    }
    update(dt, now) {
      if (now - this.last < 100) return;
      this.last = now;
      const c = this.c, W = this.W, H = this.H;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#4a4d53'; c.fillRect(0, 0, W, 24);
      sym.otext(c, `Flight ${this.rec.date} ${this.rec.start}  -  ${['Map', 'Statistics', 'Optimization', 'Task'][this.sub]}`, W / 2, 18, 14, { align: 'center', weight: 'normal', halo: 'transparent' });
      if (this.sub === 0) this.drawMap(c, W, H);
      else if (this.sub === 1) this.drawStats(c);
      else if (this.sub === 2) this.drawOpt(c);
      else this.drawTaskInfo(c);
    }
    drawMap(c, W, H) {
      const f = this.fixes;
      const mapH = Math.round(H * 0.68), top = 26;
      const lats = f.map((x) => x[1]), lons = f.map((x) => x[2]);
      let la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
      const cur = f[this.cursor];
      const cLat = this.zoom > 1 ? cur[1] : (la0 + la1) / 2, cLon = this.zoom > 1 ? cur[2] : (lo0 + lo1) / 2;
      const spanM = Math.max(1000, geo.dist(la0, lo0, la1, lo0), geo.dist(la0, lo0, la0, lo1)) * 1.2 / this.zoom;
      const mpp = spanM / Math.min(W, mapH);
      const P = (lat, lon) => { const o = geo.enu(cLat, cLon, lat, lon); return [W / 2 + o.e / mpp, top + mapH / 2 - o.n / mpp]; };
      c.save(); c.beginPath(); c.rect(0, top, W, mapH); c.clip();
      c.fillStyle = '#1b2a1b'; c.fillRect(0, top, W, mapH);
      const metricVal = (i) => (this.metric === 0 ? f[i][3] : this.metric === 1 ? f[i][4] : this.climb[i]);
      const vs = f.map((_, i) => metricVal(i));
      const lo = Math.min(...vs), hi = Math.max(...vs, lo + 1e-6);
      c.lineWidth = 3; c.lineCap = 'round';
      for (let i = 1; i < f.length; i++) {
        const t = (vs[i] - lo) / (hi - lo);
        const hue = this.metric === 2 ? (t > 0.5 ? 0 : 220) : 240 - t * 240;
        c.strokeStyle = `hsl(${hue},90%,55%)`;
        const a = P(f[i - 1][1], f[i - 1][2]), b = P(f[i][1], f[i][2]);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      const tp = P(cur[1], cur[2]);
      c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.beginPath(); c.arc(tp[0], tp[1], 6, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
      sym.otext(c, `Colour: ${METRICS[this.metric]}`, 8, top + 16, 12, { weight: 'normal' });
      // barogram
      const by = top + mapH + 6, bh = H - by - 30, bx = 40, bw = W - bx - 10;
      c.strokeStyle = '#3a3d44'; c.lineWidth = 1; c.strokeRect(bx, by, bw, bh);
      const a0 = Math.min(...f.map((x) => x[3])), a1 = Math.max(...f.map((x) => x[3]), a0 + 1);
      c.strokeStyle = '#4aa3ff'; c.lineWidth = 2; c.beginPath();
      f.forEach((x, i) => { const px = bx + (i / (f.length - 1)) * bw, py = by + bh - ((x[3] - a0) / (a1 - a0)) * bh; i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
      const cx = bx + (this.cursor / (f.length - 1)) * bw;
      c.strokeStyle = '#ffd400'; c.beginPath(); c.moveTo(cx, by); c.lineTo(cx, by + bh); c.stroke();
      c.font = '10px Verdana'; c.fillStyle = '#9aa0aa'; c.textAlign = 'right';
      c.fillText(Math.round(LX.units.alt(a1)) + '', bx - 3, by + 9); c.fillText(Math.round(LX.units.alt(a0)) + '', bx - 3, by + bh);
      const t = new Date((cur[0]) * 1000).toISOString().slice(11, 19);
      sym.otext(c, `${t} UTC   ${fm.alt(cur[3])} ${LX.units.label('alt')}   ${fm.spd(cur[4])} ${LX.units.label('speed')}   ${fm.vario(this.climb[this.cursor])} ${LX.units.label('vario')}`, W / 2, H - 12, 13, { align: 'center', weight: 'normal' });
    }
    kv(c, rows) {
      rows.forEach(([k, v], i) => { sym.otext(c, k, 14, 62 + i * 30, 14, { weight: 'normal', color: '#8fb6ff', halo: 'transparent' }); sym.otext(c, v, 200, 62 + i * 30, 17, { halo: 'transparent' }); });
    }
    drawStats(c) {
      const s = this.st, u = LX.units;
      if (!s) return;
      this.kv(c, [
        ['Date / start', `${this.rec.date}  ${this.rec.start}`], ['Duration', fm.hms(s.dur)],
        ['Distance flown', `${fm.dist(s.dist)} ${u.label('dist')}`], ['Avg. speed', `${fm.spd(s.avgSpeed)} ${u.label('speed')}`],
        ['Max speed', `${fm.spd(s.maxGs)} ${u.label('speed')}`], ['Avg. vario', `${fm.vario(s.avgV)} ${u.label('vario')}`],
        ['Min / max vario', `${fm.vario(s.minV)} / ${fm.vario(s.maxV)} ${u.label('vario')}`],
        ['Altitude', `${fm.alt(s.minAlt)} - ${fm.alt(s.maxAlt)} ${u.label('alt')}`], ['Glider', this.rec.glider],
      ]);
    }
    drawOpt(c) {
      const o = this.opt;
      if (!o) return;
      this.kv(c, [
        ['Free (OLC)', `${fm.dist(o.free.dist)} ${LX.units.label('dist')}   ${fm.spd(LX.Optimizer.speed(o.free))} ${LX.units.label('speed')}`],
        ['Legs', o.free.legs.map((l) => fm.dist(l)).join(' / ')],
        ['FAI triangle', o.tri ? `${fm.dist(o.tri.dist)} ${LX.units.label('dist')}` : '---'],
      ]);
    }
    drawTaskInfo(c) {
      this.kv(c, [['Task', this.rec.task || '(none)'], ['Note', 'Per-leg task data is shown live in Statistics > Task.']]);
    }
  }

  LX.StatsView = StatsView;
  LX.replay = { view: (scr, ctx, i) => new ReplayView(scr, ctx, i) };
})(window);
