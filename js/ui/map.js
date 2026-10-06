/**
 * Moving-map renderer (Canvas 2D).
 *
 * Draws, in order: terrain-style backdrop, range rings, airspace, waypoints /
 * airfields, task (lines + zones), flown track, thermal markers, the grey
 * ground-track line and magenta goal line with glide-position rectangles,
 * and the glider symbol. North-up or track-up.
 *
 * The backdrop is PROCEDURAL (value noise in world coordinates, so it scrolls
 * and rotates consistently). It stands in for the real unit's terrain maps
 * until OpenTopoMap/MapLibre tiles are wired in (see README roadmap).
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const D2R = Math.PI / 180;

  /** Map scale: kilometres represented by the ~100 px zoom bar. */
  const ZOOMS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];

  /* ----------------------------------------------------------------- noise */
  function hash(ix, iy) {
    let h = ix * 374761393 + iy * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function terrain(e, n) {
    // e, n in metres; ~ 40 km wavelength main relief + finer detail
    return 0.55 * vnoise(e / 22000, n / 22000) + 0.3 * vnoise(e / 7000 + 31, n / 7000 + 17) + 0.15 * vnoise(e / 2200 + 5, n / 2200 + 9);
  }
  const RAMP = [
    [0.0, [86, 128, 64]], [0.30, [118, 156, 74]], [0.48, [178, 192, 100]],
    [0.62, [196, 176, 118]], [0.78, [172, 150, 122]], [1.0, [226, 224, 218]],
  ];
  function ramp(t) {
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }


  /* ------------------------------------------------------------- raster tiles */
  const TILE_STYLES = {
    opentopomap: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subs: ['a', 'b', 'c'], max: 16, attr: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' },
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subs: [''], max: 18, attr: '© OpenStreetMap contributors' },
  };
  const tileCache = new Map();
  let tileLoads = 0;

  function tileImage(style, z, x, y) {
    const key = `${style}/${z}/${x}/${y}`;
    let t = tileCache.get(key);
    if (t) return t.ok ? t.img : null;
    if (tileLoads >= 8) return null; // limit concurrent requests
    const st = TILE_STYLES[style];
    const img = new Image();
    const tpl = LX.SOURCES && LX.SOURCES.tiles ? LX.SOURCES.tiles : st.url;
    t = { img, ok: false };
    tileCache.set(key, t);
    tileLoads++;
    img.onload = () => { t.ok = true; tileLoads--; };
    img.onerror = () => { tileLoads--; setTimeout(() => tileCache.delete(key), 30000); }; // retry later
    img.src = tpl.replace('{s}', st.subs[(x + y) % st.subs.length]).replace('{z}', z).replace('{x}', x).replace('{y}', y);
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
    return null;
  }

  const tileX = (lon, n) => ((lon + 180) / 360) * n;
  const tileY = (lat, n) => ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n;
  const tileLon = (x, n) => (x / n) * 360 - 180;
  const tileLat = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D2R;

  /** Zoom whose resolution best matches `mpp` (metres per CSS pixel) at `lat`. */
  function tileZoom(lat, mpp, max) {
    const z = Math.round(Math.log2((156543.03392 * Math.cos(lat * D2R)) / mpp));
    return Math.max(3, Math.min(max, z));
  }

  class MapRenderer {
    constructor() {
      this.bg = document.createElement('canvas');
      this.bg.width = 100; this.bg.height = 60;
      this.bgc = this.bg.getContext('2d');
      this.img = this.bgc.createImageData(100, 60);
    }

    /**
     * draw(c, vp, data)
     * vp:   { lat, lon, track, mpp, scaleKm, rect:{x,y,w,h}, cx, cy, up:'track'|'north',
     *         night, originE, originN }   (origin* = world offset for the procedural terrain)
     * data: { nav, f, history, thermals, airspaces, mc, safety }
     */
    draw(c, vp, data) {
      const R = vp.rect;
      c.save();
      c.beginPath(); c.rect(R.x, R.y, R.w, R.h); c.clip();

      const rot = vp.up === 'track' ? vp.track * D2R : 0; // screen is world rotated by -track
      const cs = Math.cos(rot), sn = Math.sin(rot);
      // world (east e, north n, metres from centre) -> screen px
      const toXY = (e, n) => {
        // rotate by -rot so that `track` points up
        const x = e * cs - n * sn;
        const y = e * sn + n * cs;
        return [vp.cx + x / vp.mpp, vp.cy - y / vp.mpp];
      };
      const toScreen = (lat, lon) => {
        const o = geo.enu(vp.lat, vp.lon, lat, lon);
        return toXY(o.e, o.n);
      };
      this._toScreen = toScreen;
      const own = vp.own ? toScreen(vp.own.lat, vp.own.lon) : [vp.cx, vp.cy];
      vp.ox = own[0]; vp.oy = own[1];

      this.drawBackdrop(c, vp, rot);
      if (vp.tiles && vp.tiles !== 'off') this.drawTiles(c, vp, toScreen);
      this.drawRings(c, vp);
      if (data.airspaces) this.drawAirspace(c, data.airspaces, toScreen, vp);
      if (data.nav) {
        this.drawWaypoints(c, data.nav, toScreen, vp);
        this.drawTask(c, data.nav, toScreen, vp);
      }
      if (data.fai) this.drawFai(c, data.fai, toScreen, vp);
      if (data.history) this.drawTrack(c, data.history, toScreen);
      if (data.opt && data.opt.length > 1) {
        c.strokeStyle = '#ffd400'; c.lineWidth = 3; c.setLineDash([8, 5]); c.beginPath();
        data.opt.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
      }
      if (data.thermals) this.drawThermals(c, data.thermals, toScreen, vp, data.mc);
      this.drawGoal(c, vp, data, toScreen);
      if (data.paths) this.drawPaths(c, data.paths, toScreen);
      if (data.traffic) this.drawTraffic(c, data.traffic, toScreen, vp);
      if (data.pcas && data.pcas.length) this.drawPcas(c, data.pcas, vp);
      this.drawGlider(c, vp);
      c.restore();
    }

    /**
     * Terrain shading. Elevation comes from the DEM where its tiles are loaded and from the procedural
     * noise elsewhere; colour by height, hillshade lit from the north-west in WORLD coordinates (so the
     * relief does not spin with the track-up rotation).
     */
    drawBackdrop(c, vp, rot) {
      const W = 140, H = 84, R = vp.rect;
      if (this.bg.width !== W) { this.bg.width = W; this.bg.height = H; this.img = this.bgc.createImageData(W, H); }
      const d = this.img.data;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const dark = vp.night ? 0.8 : 1;
      const cellX = (R.w / W) * vp.mpp, cellY = (R.h / H) * vp.mpp; // metres per backdrop cell
      const dem = vp.dem && vp.dem.enabled() ? vp.dem : null;
      const cosLat = Math.cos(vp.lat * Math.PI / 180);
      const z = new Float32Array(W * H);
      let demCells = 0;
      for (let j = 0, i = 0; j < H; j++) {
        for (let k = 0; k < W; k++, i++) {
          const x = (R.x + (k + 0.5) * (R.w / W) - vp.cx) * vp.mpp, y = -(R.y + (j + 0.5) * (R.h / H) - vp.cy) * vp.mpp;
          const e = x * cs + y * sn, n = -x * sn + y * cs; // world metres from the view centre
          let h;
          if (dem) {
            h = dem.elevation(vp.lat + n / 111320, vp.lon + e / (111320 * cosLat), Math.max(cellX, cellY));
            if (h !== undefined) demCells++;
          }
          if (h === undefined) h = 150 + 1700 * terrain(e + vp.originE, n + vp.originN);
          z[i] = h;
        }
      }
      let p = 0;
      const cell = Math.max(1, (cellX + cellY) / 2);
      for (let j = 0; j < H; j++) {
        for (let k = 0; k < W; k++) {
          const i = j * W + k;
          const t = Math.min(1, Math.max(0, z[i] / 3200));
          const col = ramp(t);
          const zl = z[j * W + Math.max(0, k - 1)], zr = z[j * W + Math.min(W - 1, k + 1)];
          const zu = z[Math.max(0, j - 1) * W + k], zd = z[Math.min(H - 1, j + 1) * W + k];
          const gx = (zr - zl) / (2 * cell), gy = (zu - zd) / (2 * cell); // slope: right and up on the screen
          const ge = gx * cs + gy * sn, gn = -gx * sn + gy * cs; // slope in world east / north
          const sh = Math.max(-0.6, Math.min(0.6, (ge - gn) * 0.7071 * 1.6)); // light from the NW
          d[p++] = Math.max(0, Math.min(255, (col[0] + sh * 110) * dark));
          d[p++] = Math.max(0, Math.min(255, (col[1] + sh * 110) * dark));
          d[p++] = Math.max(0, Math.min(255, (col[2] + sh * 100) * dark));
          d[p++] = 255;
        }
      }
      this.demCells = demCells / (W * H);
      this.bgc.putImageData(this.img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.bg, R.x, R.y, R.w, R.h);
    }

    /** Raster tiles drawn under the overlays; each tile is mapped with an affine transform so
        track-up rotation works. Only tiles that are already loaded are drawn. */
    drawTiles(c, vp, toScreen) {
      const st = TILE_STYLES[vp.tiles];
      if (!st) return;
      const z = tileZoom(vp.lat, vp.mpp, st.max), n = Math.pow(2, z);
      const cx = Math.floor(tileX(vp.lon, n)), cy = Math.floor(tileY(vp.lat, n));
      const tileM = (40075016.686 * Math.cos(vp.lat * D2R)) / n;
      const R = Math.min(6, Math.ceil((Math.hypot(vp.rect.w, vp.rect.h) * vp.mpp) / 2 / tileM) + 1);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, y = cy + dy;
          if (y < 0 || y >= n) continue;
          const img = tileImage(vp.tiles, z, ((x % n) + n) % n, y);
          if (!img) continue;
          const tl = toScreen(tileLat(y, n), tileLon(x, n));
          const tr = toScreen(tileLat(y, n), tileLon(x + 1, n));
          const bl = toScreen(tileLat(y + 1, n), tileLon(x, n));
          c.save();
          c.transform((tr[0] - tl[0]) / 256, (tr[1] - tl[1]) / 256, (bl[0] - tl[0]) / 256, (bl[1] - tl[1]) / 256, tl[0], tl[1]);
          c.drawImage(img, 0, 0, 256.6, 256.6);
          c.restore();
        }
      }
      c.font = '10px Verdana, sans-serif';
      c.textAlign = 'right';
      c.fillStyle = 'rgba(0,0,0,.65)';
      c.fillText(st.attr, vp.rect.x + vp.rect.w - 4, vp.rect.y + vp.rect.h - 40);
      c.textAlign = 'left';
    }

    drawRings(c, vp) {
      // rings at multiples of the zoom-bar distance, dark thin lines with labels
      const step = vp.scaleKm * 1000 * 1.0; // metres per ring
      c.strokeStyle = 'rgba(0,0,0,.55)';
      c.lineWidth = 1;
      c.fillStyle = 'rgba(0,0,0,.8)';
      c.font = '11px Verdana, sans-serif';
      const maxR = Math.hypot(vp.rect.w, vp.rect.h) * vp.mpp;
      for (let k = 1; k * step < maxR; k++) {
        const r = (k * step) / vp.mpp;
        if (r < 12) continue;
        c.beginPath(); c.arc(vp.ox, vp.oy, r, 0, Math.PI * 2); c.stroke();
        const txt = LX.fmt.num(LX.units.dist(k * step), k * step < 2000 ? 1 : 0) + LX.units.label('dist');
        c.fillText(txt, vp.ox + 4, vp.oy - r + 12);
      }
    }

    drawAirspace(c, list, toScreen, vp) {
      for (const a of list) {
        c.beginPath();
        if (a.circle) {
          const [x, y] = toScreen(a.circle.lat, a.circle.lon);
          c.arc(x, y, a.circle.r / vp.mpp, 0, Math.PI * 2);
        } else {
          a.poly.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
          c.closePath();
        }
        c.fillStyle = a.alarm ? 'rgba(255,40,30,.42)' : (a.fill || 'rgba(220,40,30,.22)');
        c.fill();
        c.strokeStyle = a.stroke || '#d6342a';
        c.lineWidth = a.alarm ? 5 : 2;
        c.stroke();
        if (a.alarm) { // alarmed zone: thick outline + distance to the nearest point (manual 7.1.10.1)
          const [lx, ly] = a.circle ? toScreen(a.circle.lat, a.circle.lon) : toScreen(a.poly[0][0], a.poly[0][1]);
          c.font = 'bold 13px Verdana, sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'center';
          c.strokeStyle = '#000'; c.lineWidth = 3;
          const txt = `${a.name}  ${LX.fmt.num(LX.units.dist(a.alarm.dist), 1)}${LX.units.label('dist')}`;
          c.strokeText(txt, lx, ly); c.fillText(txt, lx, ly); c.textAlign = 'left';
        }
      }
    }

    drawWaypoints(c, nav, toScreen, vp) {
      c.font = '12px Verdana, sans-serif';
      c.textBaseline = 'middle';
      for (const w of nav.waypoints) {
        const [x, y] = toScreen(w.lat, w.lon);
        if (x < vp.rect.x - 40 || x > vp.rect.x + vp.rect.w + 40 || y < vp.rect.y - 20 || y > vp.rect.y + vp.rect.h + 20) continue;
        const landable = w.type === 'airport' || w.type === 'glider' || w.type === 'field';
        c.lineWidth = 2;
        if (landable) {
          c.strokeStyle = '#1b4fd6';
          c.fillStyle = '#fff';
          c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); c.stroke();
          c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); c.stroke();
        } else {
          c.strokeStyle = '#000'; c.fillStyle = '#ffe14a';
          c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y + 5); c.lineTo(x - 6, y + 5); c.closePath(); c.fill(); c.stroke();
        }
        c.fillStyle = '#10223a';
        c.strokeStyle = 'rgba(255,255,255,.8)';
        c.lineWidth = 3;
        c.strokeText(w.name, x + 9, y); c.fillText(w.name, x + 9, y);
      }
    }

    drawTask(c, nav, toScreen, vp) {
      if (!nav.task.length) return;
      c.lineWidth = 3;
      c.strokeStyle = '#ff2fd5';
      c.beginPath();
      nav.task.forEach((p, i) => { const [x, y] = toScreen(p.wp.lat, p.wp.lon); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.lineWidth = 2;
      nav.task.forEach((p, i) => {
        const [x, y] = toScreen(p.wp.lat, p.wp.lon);
        c.strokeStyle = i === nav.active ? '#ffffff' : '#ff2fd5';
        c.beginPath(); c.arc(x, y, Math.max(4, p.radius / vp.mpp), 0, Math.PI * 2); c.stroke();
      });
    }

    /**
     * FAI triangle assistant (manual 7.1.7.7): with the flight start S and the glider P as two corners, shade where the
     * third corner may be so that S-P-C is a valid FAI triangle (shortest side >= fai.min of the perimeter). `side`
     * picks the side of the S-P line (ROT.FAI flips it, 0 = both). Optional lines mark the finished triangle's
     * perimeter in km (ellipses with S and P as foci).
     */
    drawFai(c, fai, toScreen, vp) {
      const a = geo.dist(fai.S.lat, fai.S.lon, fai.P.lat, fai.P.lon);
      if (a < 3000) return;
      const o = geo.enu(fai.S.lat, fai.S.lon, fai.P.lat, fai.P.lon); // P relative to S
      const valid = (e, n) => {
        const b = Math.hypot(e - o.e, n - o.n), cc = Math.hypot(e, n), per = a + b + cc;
        if (Math.min(a, b, cc) / per < (per > 750000 ? Math.min(fai.min, 0.25) : fai.min)) return false;
        const cr = o.e * n - o.n * e; // > 0: C is left of S->P
        return fai.side === 0 || (fai.side > 0 ? cr > 0 : cr < 0);
      };
      const s0 = geo.enu(vp.lat, vp.lon, fai.S.lat, fai.S.lon); // S relative to the view centre
      const rot = vp.up === 'track' ? vp.track * D2R : 0, cs = Math.cos(rot), sn = Math.sin(rot);
      const px = (e, n) => { const E = e + s0.e, N = n + s0.n; return [vp.cx + (E * cs - N * sn) / vp.mpp, vp.cy - (E * sn + N * cs) / vp.mpp]; };
      // inverse: screen -> world (relative to S)
      const inv = (x, y) => { const X = (x - vp.cx) * vp.mpp, Y = -(y - vp.cy) * vp.mpp; return [X * cs + Y * sn - s0.e, -X * sn + Y * cs - s0.n]; };
      const R = vp.rect, st = 8;
      c.fillStyle = fai.color; c.globalAlpha = fai.alpha;
      for (let y = R.y; y < R.y + R.h; y += st) for (let x = R.x; x < R.x + R.w; x += st) {
        const [e, n] = inv(x + st / 2, y + st / 2);
        if (valid(e, n)) c.fillRect(x, y, st, st);
      }
      c.globalAlpha = 1;
      if (fai.km) {
        c.strokeStyle = fai.color; c.lineWidth = 1; c.fillStyle = '#fff'; c.font = '11px Verdana'; c.textAlign = 'left';
        [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000].forEach((K) => {
          const L = K * 1000 - a; if (L <= a) return;
          const A = L / 2, f2 = a / 2, B = Math.sqrt(A * A - f2 * f2);
          const th = Math.atan2(o.n, o.e), mx = o.e / 2, my = o.n / 2;
          let drawing = false, labelled = false;
          c.beginPath();
          for (let t = 0; t <= 360; t += 2) {
            const u = t * D2R, ex = A * Math.cos(u), ey = B * Math.sin(u);
            const e = mx + ex * Math.cos(th) - ey * Math.sin(th), n = my + ex * Math.sin(th) + ey * Math.cos(th);
            if (valid(e, n)) {
              const [x, y] = px(e, n);
              if (!drawing) { c.moveTo(x, y); drawing = true; if (!labelled && x > R.x && x < R.x + R.w && y > R.y && y < R.y + R.h) { c.fillText(K + 'km', x + 3, y); labelled = true; } } else c.lineTo(x, y);
            } else drawing = false;
          }
          c.stroke();
        });
      }
    }

    drawTrack(c, hist, toScreen) {
      if (hist.length < 2) return;
      c.lineWidth = 2;
      c.strokeStyle = '#1a3cff';
      c.beginPath();
      hist.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }

    drawThermals(c, list, toScreen, vp, mc) {
      c.font = 'bold 12px Verdana, sans-serif';
      for (const t of list) {
        const [x, y] = toScreen(t.lat, t.lon);
        const col = t.avg > mc + 0.5 ? '#ff3b30' : t.avg < mc - 0.5 ? '#2f7bff' : '#ffd400';
        c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = '#000'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(LX.fmt.num(LX.units.vario(t.avg), 1), x, y + 0.5);
      }
      c.textAlign = 'left';
    }

    /** Grey ground track line + magenta goal line with glide rectangles. */
    drawPaths(c, paths, toScreen) {
      c.lineWidth = 2; c.strokeStyle = 'rgba(120,200,255,.8)';
      Object.keys(paths).forEach((k) => {
        const a = paths[k]; if (a.length < 2) return;
        c.beginPath(); a.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      });
    }
    /** PCAS (non-directional) traffic: dotted circle at the received distance around the glider. */
    drawPcas(c, list, vp) {
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([3, 6]);
      list.forEach((p) => {
        const r = p.dist / vp.mpp; if (r < 6 || r > 1200) return;
        c.beginPath(); c.arc(vp.ox, vp.oy, r, 0, Math.PI * 2); c.stroke();
        LX.symbols.otext(c, (p.dh >= 0 ? '+' : '−') + Math.round(Math.abs(LX.units.alt(p.dh)) / 10) * 10, vp.ox + r * 0.7071 + 4, vp.oy - r * 0.7071, 11);
      });
      c.setLineDash([]);
    }

    /** FLARM targets on the map: arrow along their track, colour by alarm level, relative altitude. */
    drawTraffic(c, list, toScreen, vp) {
      const rot = vp.up === 'track' ? vp.track * D2R : 0;
      list.forEach((t) => {
        if (t.lat === undefined) return;
        const [x, y] = toScreen(t.lat, t.lon);
        if (x < vp.rect.x - 20 || x > vp.rect.x + vp.rect.w + 20 || y < vp.rect.y - 20 || y > vp.rect.y + vp.rect.h + 20) return;
        c.save(); c.translate(x, y); LX.symbols.flarmSymbol(c, t, 10, rot); c.restore();
        const dh = Math.round(Math.abs(LX.units.alt(t.dh)) / 10) * 10;
        LX.symbols.otext(c, `${t.dh >= 0 ? '+' : '−'}${dh}${t.vs > 0.5 ? '↑' : t.vs < -0.5 ? '↓' : ''}`, x + 11, y + 4, 12, { weight: 'normal' });
      });
    }

    drawGoal(c, vp, d, toScreen) {
      // ground track: straight ahead (up when track-up)
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(70,70,70,.9)';
      const up = vp.up === 'track';
      const [tx, ty] = up ? [vp.ox, vp.oy - 4000] : (() => {
        const p = geo.dest(vp.own ? vp.own.lat : vp.lat, vp.own ? vp.own.lon : vp.lon, vp.track, 60000);
        return toScreen(p.lat, p.lon);
      })();
      c.beginPath(); c.moveTo(vp.ox, vp.oy); c.lineTo(tx, ty); c.stroke();

      const nav = d.f && d.f.nav;
      if (!nav) return;
      const [gx, gy] = toScreen(nav.target.lat, nav.target.lon);
      c.strokeStyle = '#ff2fd5';
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(vp.ox, vp.oy); c.lineTo(gx, gy); c.stroke();
      // glide rectangles: where final glide (Mc) / (Mc 0) is reached on the goal line
      const f = d.f;
      const usable = f.alt - (nav.target.elev || 0) - d.safety;
      const mark = (ratio, color) => {
        if (!(usable > 0) || !isFinite(ratio) || ratio <= 0) return;
        const dd = ratio * usable;
        if (dd >= nav.dist) return; // already on final glide: no marker
        const u = dd / nav.dist;
        const x = vp.ox + (gx - vp.ox) * u, y = vp.oy + (gy - vp.oy) * u;
        c.fillStyle = color; c.strokeStyle = '#000'; c.lineWidth = 1;
        c.fillRect(x - 6, y - 6, 12, 12); c.strokeRect(x - 6, y - 6, 12, 12);
      };
      if (d.collision) { // terrain collision on the glide (manual 8.3.4): red rectangle on the magenta line
        const [cx2, cy2] = toScreen(d.collision.lat, d.collision.lon);
        c.fillStyle = '#ff3b30'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.fillRect(cx2 - 7, cy2 - 7, 14, 14); c.strokeRect(cx2 - 7, cy2 - 7, 14, 14);
      }
      mark(nav.Emc, '#29d35a');
      mark(nav.Emc0, '#ffd400');
    }

    drawGlider(c, vp) {
      c.save();
      c.translate(vp.ox, vp.oy);
      if (vp.up !== 'track') c.rotate(vp.track * D2R);
      c.fillStyle = '#000';
      c.strokeStyle = '#fff';
      c.lineWidth = 1;
      // simple plane symbol: long wings + fuselage + tail
      c.beginPath();
      c.moveTo(0, -14); c.lineTo(2, -4); c.lineTo(20, -2); c.lineTo(20, 2); c.lineTo(2, 3);
      c.lineTo(2, 11); c.lineTo(7, 14); c.lineTo(7, 16); c.lineTo(0, 15); c.lineTo(-7, 16);
      c.lineTo(-7, 14); c.lineTo(-2, 11); c.lineTo(-2, 3); c.lineTo(-20, 2); c.lineTo(-20, -2);
      c.lineTo(-2, -4); c.closePath();
      c.fill(); c.stroke();
      c.restore();
    }
  }

  LX.Map = { Renderer: MapRenderer, ZOOMS, terrain, ramp, tileMath: { tileX, tileY, tileLon, tileLat, tileZoom }, TILE_STYLES };
})(window);
