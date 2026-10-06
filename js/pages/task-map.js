/**
 * Task map edit mode (manual 7.7.6.2): build and change a task on the map. A grey cross is moved with
 * the MODE knob (left/right) and the PAGE knob (up/down), ZOOM zooms; the cross landing on a task point
 * selects it, and the point can be carried along (GRAB) and dropped. A cross on a task leg inserts a point.
 * Touch / mouse: tap places the cross, dragging a task point moves it.
 *
 * Dropped points snap to a database waypoint within a few pixels; otherwise a new user waypoint is created.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const ZOOMS = LX.Map.ZOOMS;
  const STEPS = [4, 12, 32];

  class TaskMapView extends LX.View {
    /** editor: the TaskEditView whose `pts` this edits. */
    constructor(scr, ctx, editor) {
      super(scr);
      this.ctx = ctx; this.ed = editor;
      this.mapR = new LX.Map.Renderer();
      this.cv = document.createElement('canvas');
      this.cv.className = 'layer';
      this.el.appendChild(this.cv);
      this.c = this.cv.getContext('2d');
      this.bar = document.createElement('div');
      this.bar.className = 'titlebar';
      this.el.appendChild(this.bar);
      this.step = 1;
      this.sel = -1; this.carry = false;
      this.zi = 3;
      // start on the task (or the glider) and pick a zoom that shows all of it
      const f = ctx.flight.f;
      const pts = editor.pts.filter((p) => p.wp);
      let lat = f.lat, lon = f.lon;
      if (pts.length) {
        const la = pts.map((p) => p.wp.lat), lo = pts.map((p) => p.wp.lon);
        lat = (Math.min(...la) + Math.max(...la)) / 2; lon = (Math.min(...lo) + Math.max(...lo)) / 2;
        const span = Math.max(geo.dist(Math.min(...la), lon, Math.max(...la), lon), geo.dist(lat, Math.min(...lo), lat, Math.max(...lo)), 2000);
        this.zi = ZOOMS.findIndex((z) => z * 5000 >= span * 1.3); // ~500 px for the task
        if (this.zi < 0) this.zi = ZOOMS.length - 1;
      }
      this.cLat = lat; this.cLon = lon; // map centre
      this.cross = { x: 0, y: 0 }; // cross offset from the centre, px
      this._pointer();
    }

    get mpp() { return (ZOOMS[this.zi] * 1000) / 100; }
    show() { this.resize(); }
    resize() {
      const d = LX.device;
      const r = Math.max(1, Math.ceil((d.scale || 1) * (window.devicePixelRatio || 1)));
      this.cv.width = d.w * r; this.cv.height = d.h * r;
      this.cv.style.width = d.w + 'px'; this.cv.style.height = d.h + 'px';
      this.c.setTransform(r, 0, 0, r, 0, 0);
      this.W = d.w; this.H = d.h;
    }

    /* screen px (relative to the view centre) <-> geography */
    toLL(px, py) {
      const e = px * this.mpp, n = -py * this.mpp;
      const d = Math.hypot(e, n);
      return d < 0.01 ? { lat: this.cLat, lon: this.cLon } : geo.dest(this.cLat, this.cLon, (Math.atan2(e, n) * 180 / Math.PI + 360) % 360, d);
    }
    toPx(lat, lon) { const o = geo.enu(this.cLat, this.cLon, lat, lon); return { x: o.e / this.mpp, y: -o.n / this.mpp }; }
    crossLL() { return this.toLL(this.cross.x, this.cross.y); }

    /** Index of the task point under the cross (within 14 px), else -1. */
    pick() {
      let best = -1, bd = 14;
      this.ed.pts.forEach((p, i) => {
        if (!p.wp) return;
        const q = this.toPx(p.wp.lat, p.wp.lon), d = Math.hypot(q.x - this.cross.x, q.y - this.cross.y);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    /** Task leg under the cross: index i of the leg i -> i+1, else -1. */
    legAt() {
      const pts = this.ed.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (!pts[i].wp || !pts[i + 1].wp) continue;
        const a = this.toPx(pts[i].wp.lat, pts[i].wp.lon), b = this.toPx(pts[i + 1].wp.lat, pts[i + 1].wp.lon);
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((this.cross.x - a.x) * dx + (this.cross.y - a.y) * dy) / l2));
        if (Math.hypot(a.x + dx * t - this.cross.x, a.y + dy * t - this.cross.y) < 12) return i;
      }
      return -1;
    }
    /** A database waypoint within `px` pixels of the cross (not already used), else null. */
    snap(px) {
      let best = null, bd = px;
      for (const w of this.ctx.nav.waypoints) {
        const q = this.toPx(w.lat, w.lon), d = Math.hypot(q.x - this.cross.x, q.y - this.cross.y);
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }
    newWaypoint() {
      const ll = this.crossLL(), nav = this.ctx.nav;
      let n = 1; while (nav.waypoints.some((w) => w.name === 'TP' + n)) n++;
      const w = { name: 'TP' + n, code: 'TP' + n, lat: ll.lat, lon: ll.lon, elev: this.ctx.groundElev ? this.ctx.groundElev({ lat: ll.lat, lon: ll.lon, alt: 0 }) || 0 : 0, type: 'tp' };
      nav.waypoints.push(w);
      return w;
    }

    /* ------------------------------------------------------------ editing */
    grabOrDrop() {
      const pts = this.ed.pts;
      if (this.carry) { // drop: snap to a waypoint or make a new one
        const wp = this.snap(14) || this.newWaypoint();
        pts[this.sel].wp = wp;
        this.carry = false;
        this.scr.toast(`${wp.name} placed`, 1000);
        return;
      }
      const i = this.pick();
      if (i < 0) { this.scr.toast('Move the cross onto a task point first', 1500); return; }
      this.sel = i; this.carry = true;
    }
    insert() {
      const pts = this.ed.pts, i = this.legAt();
      const wp = this.snap(14) || this.newWaypoint();
      const pt = { wp, zone: LX.TaskTools.defaultZone('tp') };
      if (i >= 0) pts.splice(i + 1, 0, pt); else pts.push(pt);
      this.sel = i >= 0 ? i + 1 : pts.length - 1;
      this.scr.toast(i >= 0 ? 'Point inserted into the leg' : 'Point added at the end', 1200);
    }
    remove() {
      const i = this.sel >= 0 && this.sel < this.ed.pts.length ? this.sel : this.pick();
      if (i < 0) return;
      this.ed.pts.splice(i, 1); this.sel = -1; this.carry = false;
    }

    softkeys() {
      return { labels: [this.carry ? 'DROP' : 'GRAB', 'INSERT', 'DELETE', 'ZONE', 'SNAP', 'STEP ' + STEPS[this.step], '', 'CLOSE'], persist: true };
    }
    button(i) {
      switch (i) {
        case 0: this.grabOrDrop(); break;
        case 1: this.insert(); break;
        case 2: this.remove(); break;
        case 3: { const k = this.sel >= 0 ? this.sel : this.pick(); if (k >= 0 && this.ed.pts[k]) LX.taskEdit.zoneDialog(this.scr, this.ctx, this.ed.pts[k], () => {}); break; }
        case 4: { if (this.sel >= 0 && this.ed.pts[this.sel]) { const w = this.snap(40); if (w) { this.ed.pts[this.sel].wp = w; this.carry = false; } else this.scr.toast('No waypoint near the cross', 1200); } break; }
        case 5: this.step = (this.step + 1) % STEPS.length; break;
        case 7: this.ed.render(); this.scr.close(); break;
        default: return false;
      }
      return true;
    }
    knob(name, dir) {
      if (name === 'zoom') {
        const ll = this.crossLL();
        this.zi = Math.max(0, Math.min(ZOOMS.length - 1, this.zi + dir));
        const q = this.toPx(ll.lat, ll.lon); this.cross.x = q.x; this.cross.y = q.y; // keep the cross on the same spot
        return true;
      }
      const s = STEPS[this.step];
      if (name === 'mode') this.cross.x += dir * s; else if (name === 'page') this.cross.y -= dir * s; else return false;
      this.afterMove();
      return true;
    }
    afterMove() {
      const hw = this.W / 2 - 24, hh = this.H / 2 - 50;
      let dx = 0, dy = 0;
      if (this.cross.x > hw) dx = this.cross.x - hw; else if (this.cross.x < -hw) dx = this.cross.x + hw;
      if (this.cross.y > hh) dy = this.cross.y - hh; else if (this.cross.y < -hh) dy = this.cross.y + hh;
      if (dx || dy) { const c = this.toLL(dx, dy); this.cLat = c.lat; this.cLon = c.lon; this.cross.x -= dx; this.cross.y -= dy; }
      if (this.carry && this.sel >= 0) { // the carried point follows the cross
        const ll = this.crossLL();
        this.ed.pts[this.sel].wp = { name: this.ed.pts[this.sel].wp.name, lat: ll.lat, lon: ll.lon, elev: this.ed.pts[this.sel].wp.elev || 0, type: 'tp', temp: true };
      } else this.sel = this.pick();
    }

    /* touch / mouse */
    _pointer() {
      let drag = false;
      const pos = (e) => { const r = this.cv.getBoundingClientRect(), sc = LX.device.scale || 1; return { x: (e.clientX - r.left) / sc - this.W / 2, y: (e.clientY - r.top) / sc - this.H / 2 }; };
      this.cv.addEventListener('pointerdown', (e) => {
        const p = pos(e); this.cross.x = p.x; this.cross.y = p.y;
        const i = this.pick();
        if (i >= 0) { this.sel = i; this.carry = true; drag = true; this.cv.setPointerCapture(e.pointerId); }
        else { this.carry = false; this.sel = -1; }
        e.stopPropagation();
      });
      this.cv.addEventListener('pointermove', (e) => { if (!drag) return; const p = pos(e); this.cross.x = p.x; this.cross.y = p.y; this.afterMove(); });
      this.cv.addEventListener('pointerup', (e) => { if (drag) { drag = false; this.grabOrDrop(); } e.stopPropagation(); });
    }

    update() {
      const c = this.c, W = this.W, H = this.H, s = this.ctx.settings.get(), f = this.ctx.flight.f;
      const pts = this.ed.pts.filter((p) => p.wp);
      const task = pts.map((p) => ({ wp: p.wp, zone: p.zone, radius: p.zone.r1 }));
      const nav = { waypoints: this.ctx.nav.waypoints, task, active: -1, options: this.ed.opts };
      const rect = { x: 0, y: 26, w: W, h: H - 26 };
      const org = geo.enu(this.ctx.ref.lat, this.ctx.ref.lon, this.cLat, this.cLon);
      const vp = { lat: this.cLat, lon: this.cLon, own: { lat: f.lat, lon: f.lon }, track: f.track, mpp: this.mpp, scaleKm: ZOOMS[this.zi], rect,
        tiles: s.tiles, dem: this.ctx.dem, cx: W / 2, cy: H / 2 + 13, up: 'north', night: s.night, originE: org.e, originN: org.n };
      this.mapR.draw(c, vp, { nav, history: null, thermals: null, airspaces: s.showAirspace !== false ? this.ctx.nav.airspaces : null, mc: s.mc });
      // task point numbers, selection highlight
      c.font = 'bold 13px Verdana'; c.textAlign = 'center'; c.textBaseline = 'middle';
      this.ed.pts.forEach((p, i) => {
        if (!p.wp) return;
        const q = this.toPx(p.wp.lat, p.wp.lon), x = W / 2 + q.x, y = H / 2 + 13 + q.y;
        if (i === this.sel) { c.strokeStyle = this.carry ? '#ffd400' : '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.stroke(); }
        c.fillStyle = '#ff2fd5'; c.strokeStyle = '#000'; c.lineWidth = 3;
        c.strokeText(String(i + 1), x, y - 17); c.fillText(String(i + 1), x, y - 17);
      });
      // the cross
      const x = W / 2 + this.cross.x, y = H / 2 + 13 + this.cross.y;
      c.strokeStyle = '#9aa0aa'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke();
      c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke();
      const km = (m) => (m / 1000).toFixed(1) + ' km';
      let tot = 0; for (let i = 1; i < pts.length; i++) tot += geo.dist(pts[i - 1].wp.lat, pts[i - 1].wp.lon, pts[i].wp.lat, pts[i].wp.lon);
      const near = this.sel >= 0 ? (this.carry ? 'carrying ' : 'point ') + (this.sel + 1) : this.legAt() >= 0 ? 'on leg ' + (this.legAt() + 1) : '';
      this.bar.textContent = `Task map  ${km(tot)}   ${near}`;
    }
  }

  LX.TaskMapView = TaskMapView;
})(window);
