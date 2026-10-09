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
  const clamp = LX.util.clamp;
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
  /**
   * Terrain colour schemes (manual 7.1.7.1). `z` is the ground elevation in m (after the user offset), `alt` the glider's
   * MSL altitude (for "Relative"). The default Mountain scheme is the original green-to-white ramp.
   */
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const bands = (z, table) => { for (const [lim, col] of table) if (z < lim) return col; return table[table.length - 1][1]; };
  const SCHEMES = {
    mountain: (z) => ramp(Math.min(1, Math.max(0, z / 3200))),
    flatland: (z) => ramp(Math.min(1, Math.max(0, z / 1000))),
    flatland2: (z) => (z < 150 ? [240, 240, 236] : ramp(Math.min(1, Math.max(0, z / 3200)))),
    lowcontrast: (z) => mix(ramp(Math.min(1, Math.max(0, z / 3200))), [168, 168, 156], 0.5),
    highcontrast: (z) => (z < 100 ? [250, 250, 250] : mix(ramp(Math.min(1, Math.max(0, z / 3200))), [90, 90, 90], -0.25).map((v) => Math.max(0, Math.min(255, v)))),
    zebra: (z) => { const c = ramp(Math.min(1, Math.max(0, z / 3200))); return Math.floor(z / 250) % 2 ? c.map((v) => v * 0.6) : c; },
    zebra2: (z) => { const c = ramp(Math.min(1, Math.max(0, z / 3200))); return Math.floor(z / 250) % 2 ? c.map((v) => v * 0.85) : c; },
    icao: (z) => bands(z, [[200, [200, 230, 180]], [500, [225, 238, 170]], [1000, [245, 225, 160]], [1500, [235, 200, 140]], [2000, [215, 170, 120]], [3000, [190, 140, 110]], [1e9, [235, 235, 235]]]),
    cliffs: (z) => mix([120, 150, 110], [215, 205, 190], Math.min(1, Math.max(0, z / 3000))),
    atlas: (z) => bands(z, [[100, [150, 200, 140]], [300, [190, 215, 150]], [700, [232, 226, 160]], [1200, [226, 196, 140]], [2000, [200, 160, 120]], [3000, [176, 140, 130]], [1e9, [230, 220, 225]]]),
    grayscale: (z) => { const g = 60 + 190 * Math.min(1, Math.max(0, z / 3200)); return [g, g, g]; },
    osm: () => [236, 232, 218],
    himalaya: (z) => ramp(Math.min(1, Math.max(0, z / 8000))),
    relative: (z, alt) => (z >= alt ? mix([255, 170, 60], [220, 40, 30], Math.min(1, (z - alt) / 600)) : [246, 246, 246]),
  };
  const SCHEME_NAMES = { mountain: 'Mountain', flatland: 'Flatland', flatland2: 'Flatland 2', lowcontrast: 'Low contrast', highcontrast: 'High contrast', zebra: 'Zebra', zebra2: 'Zebra 2', icao: 'ICAO', cliffs: 'Cliffs', atlas: 'Atlas', grayscale: 'Grayscale', osm: 'OSM', himalaya: 'Himalaya', relative: 'Relative (to altitude)' };
  const QUALITY = { low: [70, 42], medium: [100, 60], high: [140, 84] };

  const AIRSPACE_TYPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'CTR', 'TMA', 'R', 'P', 'Q', 'DNG', 'TMZ', 'RMZ', 'W', 'GSEC']; // + 'other'
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
    opentopomap: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subs: ['a', 'b', 'c'], max: 16, attr: '© OpenStreetMap, SRTM, OpenTopoMap (CC-BY-SA)' },
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subs: [''], max: 18, attr: '© OpenStreetMap' },
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

  /** Cache for the weather overlay tiles (own concurrency limit; entries are keyed by layer + z/x/y). */
  const rasterCache = new Map();
  let rasterLoads = 0;
  function rasterImage(L, z, x, y) {
    const key = `${L.key}/${z}/${x}/${y}`;
    let t = rasterCache.get(key);
    if (t) return t.ok ? t.img : null;
    if (rasterLoads >= 10) return null;
    t = { img: new Image(), ok: false };
    rasterCache.set(key, t);
    rasterLoads++;
    t.img.onload = () => { t.ok = true; rasterLoads--; };
    t.img.onerror = () => { rasterLoads--; setTimeout(() => rasterCache.delete(key), 60000); };
    t.img.src = L.urlFor(z, x, y);
    if (rasterCache.size > 1500) rasterCache.delete(rasterCache.keys().next().value);
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

      const st = data.style || {};
      c.fillStyle = st.mapBackground || '#000000'; c.fillRect(R.x, R.y, R.w, R.h);
      if (st.showMap !== false) {
        this.drawBackdrop(c, vp, rot, st, data.f);
        if (vp.tiles && vp.tiles !== 'off') this.drawTiles(c, vp, toScreen);
      }
      if (data.weather) this.drawWeather(c, vp, toScreen, data.weather);
      if (st.showWindLines && data.f) this.drawWindLines(c, vp, data.f);
      if (st.showRangeCircles !== false) this.drawRings(c, vp, st);
      if (data.range && st.showGlideArea) this.drawGlideArea(c, data.range, toScreen, vp, st);
      if (data.airspaces) this.drawAirspace(c, data.airspaces, toScreen, vp, st);
      if (data.nav) {
        if (st.showWaypoints !== false) this.drawWaypoints(c, data.nav, toScreen, vp, st, data.wptInfo);
        this.drawTask(c, data.nav, toScreen, vp, st);
      }
      if (data.fai) this.drawFai(c, data.fai, toScreen, vp);
      if (data.history) this.drawTrack(c, data.history, toScreen, st, data.mc);
      [data.opt, data.optTri].forEach((line) => {
        if (!line || line.length < 2) return;
        c.strokeStyle = st.optColor || '#ffd400'; c.lineWidth = st.optWidth || 3; c.setLineDash([8, 5]); c.beginPath();
        line.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
      });
      if (data.thermals) this.drawThermals(c, data.thermals, toScreen, vp, data.mc);
      this.drawGoal(c, vp, data, toScreen, st);
      if (data.paths) this.drawPaths(c, data.paths, toScreen);
      if (data.traffic && st.showFlarm !== false) this.drawTraffic(c, data.traffic, toScreen, vp, st);
      if (data.pcas && data.pcas.length) this.drawPcas(c, data.pcas, vp);
      this.drawGlider(c, vp);
      c.restore();
    }

    /**
     * Terrain shading. Elevation comes from the DEM where its tiles are loaded and from the procedural
     * noise elsewhere; colour by height, hillshade lit from the north-west in WORLD coordinates (so the
     * relief does not spin with the track-up rotation).
     */
    drawBackdrop(c, vp, rot, st, fl) {
      st = st || {};
      if (st.terrainQuality === 'off') return; // only the background colour (and tiles) remain
      const [W, H] = QUALITY[st.terrainQuality] || QUALITY.high, R = vp.rect;
      const scheme = SCHEMES[st.terrainScheme] || SCHEMES.mountain, off = st.terrainOffset || 0, shadows = st.shadows !== false;
      const alt = fl ? fl.alt : 0;
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
          const col = scheme(z[i] + off, alt);
          const zl = z[j * W + Math.max(0, k - 1)], zr = z[j * W + Math.min(W - 1, k + 1)];
          const zu = z[Math.max(0, j - 1) * W + k], zd = z[Math.min(H - 1, j + 1) * W + k];
          const gx = (zr - zl) / (2 * cell), gy = (zu - zd) / (2 * cell); // slope: right and up on the screen
          const ge = gx * cs + gy * sn, gn = -gx * sn + gy * cs; // slope in world east / north
          const sh = shadows ? Math.max(-0.6, Math.min(0.6, (ge - gn) * 0.7071 * 1.6 * (st.terrainScheme === 'cliffs' ? 2 : 1))) : 0; // light from the NW
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

    /** Weather overlays (7.1.7.2): raster layers (radar, satellite), forecast blobs, credits. */
    drawWeather(c, vp, toScreen, wx) {
      const R = vp.rect;
      c.save();
      (wx.rasters || []).forEach((L) => {
        const z = tileZoom(vp.lat, vp.mpp, L.maxZoom), n = Math.pow(2, z);
        const cx = Math.floor(tileX(vp.lon, n)), cy = Math.floor(tileY(vp.lat, n));
        const tileM = (40075016.686 * Math.cos(vp.lat * D2R)) / n;
        const span = Math.min(5, Math.ceil((Math.hypot(R.w, R.h) * vp.mpp) / 2 / tileM) + 1);
        c.globalAlpha = L.alpha;
        const order = [];
        for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) order.push([dx, dy]);
        order.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]); // tiles near the centre load first
        for (const [dx, dy] of order) {
          const x = cx + dx, y = cy + dy;
          if (y < 0 || y >= n) continue;
          const img = rasterImage(L, z, ((x % n) + n) % n, y);
          if (!img) continue;
          const tl = toScreen(tileLat(y, n), tileLon(x, n)), tr = toScreen(tileLat(y, n), tileLon(x + 1, n)), bl = toScreen(tileLat(y + 1, n), tileLon(x, n));
          c.save();
          c.transform((tr[0] - tl[0]) / 256, (tr[1] - tl[1]) / 256, (bl[0] - tl[0]) / 256, (bl[1] - tl[1]) / 256, tl[0], tl[1]);
          c.drawImage(img, 0, 0, 256.6, 256.6);
          c.restore();
        }
      });
      if (wx.blobs && wx.blobs.length) {
        // soft blobs, one per forecast grid point, as wide as the grid spacing
        const spacing = Math.max(60, Math.hypot(R.w / 8, R.h / 6) * 0.9);
        wx.blobs.forEach((b) => {
          const [x, y] = toScreen(b.lat, b.lon), col = b.color;
          if (col[3] <= 0.01) return;
          const g = c.createRadialGradient(x, y, 0, x, y, spacing);
          g.addColorStop(0, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${col[3] * wx.blobAlpha})`);
          g.addColorStop(1, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},0)`);
          c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x - spacing, y - spacing, spacing * 2, spacing * 2);
        });
      }
      c.restore();
      c.font = '8px Verdana, sans-serif'; c.textAlign = 'right'; c.fillStyle = 'rgba(0,0,0,.55)';
      (wx.attr || []).forEach((t, i) => c.fillText(t, R.x + R.w - 3, R.y + R.h - 13 - i * 10));
      c.textAlign = 'left';
    }

    /** Wind direction lines (manual 7.1.7.1): short strokes along the wind, longer for stronger wind. */
    drawWindLines(c, vp, fl) {
      if (!(fl.windSpd > 0.3)) return;
      const R = vp.rect, rel = (fl.windDir + 180 - (vp.up === 'track' ? vp.track : 0)) * D2R; // flow direction on the screen
      const len = Math.min(34, 8 + fl.windSpd * 2.5), dx = Math.sin(rel) * len / 2, dy = -Math.cos(rel) * len / 2, step = 110;
      c.save(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.lineCap = 'round';
      for (let y = R.y + step / 2; y < R.y + R.h; y += step) for (let x = R.x + step / 2 + ((Math.round((y - R.y) / step) % 2) * step) / 2; x < R.x + R.w; x += step) {
        c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy);
        c.moveTo(x + dx, y + dy); c.lineTo(x + dx - Math.sin(rel - 0.5) * 7, y + dy + Math.cos(rel - 0.5) * 7);
        c.moveTo(x + dx, y + dy); c.lineTo(x + dx - Math.sin(rel + 0.5) * 7, y + dy + Math.cos(rel + 0.5) * 7);
        c.stroke();
      }
      c.restore();
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
      c.font = '8px Verdana, sans-serif'; // attribution is a licence requirement: keep it, but small and in the corner
      c.textAlign = 'right';
      c.fillStyle = 'rgba(0,0,0,.5)';
      c.fillText(st.attr, vp.rect.x + vp.rect.w - 3, vp.rect.y + vp.rect.h - 3);
      c.textAlign = 'left';
    }

    drawRings(c, vp, st) {
      // rings at multiples of the zoom-bar distance, with labels (Setup > Graphics > Glider and Track: range circles)
      const step = vp.scaleKm * 1000 * 1.0; // metres per ring
      c.strokeStyle = st && st.rangeColor && st.rangeColor !== '#000000' ? st.rangeColor : 'rgba(0,0,0,.55)';
      c.lineWidth = (st && st.rangeWidth) || 1;
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

    /** Style key of a zone for Setup > Graphics > Airspace. */
    static airspaceType(a) { const k = String(a.cls || '').toUpperCase(); return AIRSPACE_TYPES.indexOf(k) >= 0 ? k : 'other'; }

    drawAirspace(c, list, toScreen, vp, st) {
      st = st || {};
      const widthKm = (vp.rect.w * vp.mpp) / 1000;
      for (const a of list) {
        const sty = st.airspaceStyle && st.airspaceStyle[MapRenderer.airspaceType(a)];
        if (sty && sty.zoom && widthKm > sty.zoom) continue;                    // type visible up to this zoom (screen width, km)
        if (st.airspaceBelow > 0 && a.lower > st.airspaceBelow) continue;       // "show only airspace below"
        c.beginPath();
        if (a.circle) {
          const [x, y] = toScreen(a.circle.lat, a.circle.lon);
          c.arc(x, y, a.circle.r / vp.mpp, 0, Math.PI * 2);
        } else {
          a.poly.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
          c.closePath();
        }
        const rgba = (hex, al) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${al})`; };
        c.fillStyle = a.alarm ? 'rgba(255,40,30,.42)' : sty && sty.color ? rgba(sty.color, (sty.alpha === undefined ? 22 : sty.alpha) / 100) : (a.fill || 'rgba(220,40,30,.22)');
        c.fill();
        c.strokeStyle = (sty && sty.color) || a.stroke || '#d6342a';
        c.lineWidth = a.alarm ? 5 : (sty && sty.width) || 2;
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

    /**
     * Waypoints and airports (manual 7.1.7.4): symbol size, at most `wptMax` labelled points on screen (more -> small dots),
     * an upper and a lower label (name, code, elevation, arrival/required altitude, required Mc, required L/D, frequency),
     * optional colourised label background (green: reachable at the safety Mc, yellow: at Mc 0) and a red cross over
     * landing places with a runway shorter than the minimum.
     */
    drawWaypoints(c, nav, toScreen, vp, st, info) {
      st = st || {};
      c.font = '12px Verdana, sans-serif';
      c.textBaseline = 'middle';
      const R = vp.rect, r0 = st.wptSize || 6;
      const vis = [];
      for (const w of nav.waypoints) {
        const [x, y] = toScreen(w.lat, w.lon);
        if (x < R.x - 40 || x > R.x + R.w + 40 || y < R.y - 20 || y > R.y + R.h + 20) continue;
        vis.push([w, x, y]);
      }
      const dots = vis.length > (st.wptMax || 60);
      for (const [w, x, y] of vis) {
        const landable = w.type === 'airport' || w.type === 'glider' || w.type === 'field';
        if (dots) { c.fillStyle = '#1b4fd6'; c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); continue; }
        c.lineWidth = 2;
        if (landable) {
          c.strokeStyle = '#1b4fd6';
          c.fillStyle = '#fff';
          c.beginPath(); c.arc(x, y, r0, 0, Math.PI * 2); c.fill(); c.stroke();
          c.beginPath(); c.moveTo(x - r0 * 0.66, y); c.lineTo(x + r0 * 0.66, y); c.moveTo(x, y - r0 * 0.66); c.lineTo(x, y + r0 * 0.66); c.stroke();
          if (st.minRwLen > 0 && w.rwLen > 0 && w.rwLen < st.minRwLen) { // runway too short: red cross
            c.strokeStyle = '#ff3b30'; c.lineWidth = 3;
            c.beginPath(); c.moveTo(x - r0, y - r0); c.lineTo(x + r0, y + r0); c.moveTo(x + r0, y - r0); c.lineTo(x - r0, y + r0); c.stroke();
          }
        } else {
          c.strokeStyle = '#000'; c.fillStyle = '#ffe14a';
          c.beginPath(); c.moveTo(x, y - r0); c.lineTo(x + r0, y + r0 * 0.83); c.lineTo(x - r0, y + r0 * 0.83); c.closePath(); c.fill(); c.stroke();
        }
        const parts = [st.wptUpper || 'name', st.wptLower || 'none'].map((k) => this.wptLabel(w, k, info)).filter((t) => t);
        if (!parts.length) continue;
        const lines = st.wptSingle ? [parts.join(' ')] : parts;
        let bg = null;
        if (st.wptColorize && info) { const q = info(w); bg = q.arrival >= 0 ? '#29d35a' : q.arrival0 >= 0 ? '#ffd400' : null; }
        lines.forEach((txt, li) => {
          const ty = y + (li - (lines.length - 1) / 2) * 13;
          if (bg) { const tw = c.measureText(txt).width; c.fillStyle = bg; c.fillRect(x + 8, ty - 7, tw + 4, 14); }
          c.fillStyle = '#10223a';
          c.strokeStyle = bg ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,.8)';
          c.lineWidth = 3;
          c.strokeText(txt, x + 9 + r0 - 6, ty); c.fillText(txt, x + 9 + r0 - 6, ty);
        });
      }
    }

    /** Text of one waypoint label item, '' when not available. */
    wptLabel(w, kind, info) {
      const U = LX.units, fm = LX.fmt;
      switch (kind) {
        case 'name': return w.name || '';
        case 'code': return w.code || '';
        case 'elev': return w.elev !== undefined ? Math.round(U.alt(w.elev)) + U.label('alt') : '';
        case 'freq': return w.freq || '';
        case 'arrival': { const q = info && info(w); return q && isFinite(q.arrival) ? fm.signed(U.alt(q.arrival), 0) : ''; }
        case 'required': { const q = info && info(w); return q && isFinite(q.required) ? Math.round(U.alt(q.required)) + U.label('alt') : ''; }
        case 'reqMc': { const q = info && info(w); return q && isFinite(q.reqMc) ? fm.num(U.vario(q.reqMc), 1) : ''; }
        case 'reqLD': { const q = info && info(w); return q && isFinite(q.reqLD) ? String(Math.round(q.reqLD)) : ''; }
        default: return '';
      }
    }

    drawTask(c, nav, toScreen, vp, st) {
      st = st || {};
      if (!nav.task.length) return;
      c.lineWidth = 3;
      c.strokeStyle = st.taskColor || '#ff2fd5';
      c.beginPath();
      nav.task.forEach((p, i) => { const [x, y] = toScreen(p.wp.lat, p.wp.lon); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.lineWidth = 2;
      nav.task.forEach((p, i) => {
        if (st.showSelectedZoneOnly && i !== nav.active) return;
        const [x, y] = toScreen(p.wp.lat, p.wp.lon);
        const zc = st.zoneColor || '#ff2fd5';
        c.beginPath(); c.arc(x, y, Math.max(4, p.radius / vp.mpp), 0, Math.PI * 2);
        if (st.zoneAlpha > 0) { c.save(); c.globalAlpha = st.zoneAlpha / 100; c.fillStyle = zc; c.fill(); c.restore(); }
        c.strokeStyle = i === nav.active ? '#ffffff' : zc;
        c.stroke();
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

    /**
     * Flown path (manual 7.1.7.5). Styles: fixed colour, Mc (red: climb above Mc, orange: about Mc, blue: below,
     * grey: sink), vario (red up / blue down), altitude (red low -> blue high), ground speed (red slow -> blue fast).
     * History points are [lat, lon, alt, vario, groundspeed], one per 2 s.
     */
    drawTrack(c, hist, toScreen, st, mc) {
      st = st || {};
      if (st.showPath === false) return;
      const n = Math.max(2, Math.round((st.pathLength || 50) * 30));
      const h = hist.length > n ? hist.slice(-n) : hist;
      if (h.length < 2) return;
      c.save();
      c.lineWidth = st.pathWidth || 2; c.lineJoin = 'round'; c.lineCap = 'round';
      const style = st.pathStyle || 'fixed';
      const pts = h.map((p) => toScreen(p[0], p[1]));
      if (style === 'fixed' || h[0].length < 5) {
        c.strokeStyle = st.pathColor || '#1a3cff';
        c.beginPath(); pts.forEach(([x, y], i) => { i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
        c.restore(); return;
      }
      const col = this.pathColorFn(style, h, mc);
      let cur = null;
      for (let i = 1; i < h.length; i++) {
        const k = col(h[i]);
        if (k !== cur) { if (cur !== null) c.stroke(); c.strokeStyle = k; c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); cur = k; }
        c.lineTo(pts[i][0], pts[i][1]);
      }
      if (cur !== null) c.stroke();
      c.restore();
    }

    /** Colour of a history point for the given path style. */
    pathColorFn(style, h, mc) {
      const hue = (t) => `hsl(${Math.round(240 * clamp(t, 0, 1))},95%,50%)`; // 0 = red ... 1 = blue
      if (style === 'mc') {
        return (p) => (p[3] >= mc + 0.5 ? '#ff3b30' : p[3] < 0 ? '#8a8f99' : p[3] < mc - 0.5 ? '#2f7bff' : '#ff9a1f');
      }
      if (style === 'vario') return (p) => (p[3] >= 0 ? '#ff3b30' : '#2f7bff');
      if (style === 'autospan' || style === 'avgvario') { // thermal mode (7.1.7.6)
        let lo = Infinity, hi = -Infinity, sum = 0;
        h.forEach((p) => { if (p[3] < lo) lo = p[3]; if (p[3] > hi) hi = p[3]; sum += p[3]; });
        const avg = sum / h.length, span = Math.max(1e-6, hi - lo);
        if (style === 'autospan') return (p) => hue(1 - (p[3] - lo) / span); // red = strongest lift, blue = weakest
        return (p) => (p[3] >= avg + 0.5 ? '#ff3b30' : p[3] <= avg - 0.5 ? '#2f7bff' : '#ff9a1f');
      }
      const idx = style === 'altitude' ? 2 : 4;
      let lo = Infinity, hi = -Infinity;
      h.forEach((p) => { if (p[idx] < lo) lo = p[idx]; if (p[idx] > hi) hi = p[idx]; });
      const span = Math.max(1e-6, hi - lo);
      return (p) => hue((p[idx] - lo) / span);
    }

    /** Glider range area (manual 7.1.7.5): where final glide still arrives at the safety altitude. */
    drawGlideArea(c, ring, toScreen, vp, st) {
      if (!ring || ring.length < 3) return;
      const R = vp.rect;
      c.save();
      c.beginPath();
      if (st.areaFill !== 'inside') c.rect(R.x, R.y, R.w, R.h);
      ring.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.closePath();
      c.fillStyle = (st.areaColor || '#29d35a') + '55';
      c.fill('evenodd');
      c.strokeStyle = st.areaBorder || '#1a8a3a'; c.lineWidth = 2;
      c.beginPath();
      ring.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.closePath(); c.stroke();
      c.restore();
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
    drawTraffic(c, list, toScreen, vp, st) {
      st = st || {};
      const rot = vp.up === 'track' ? vp.track * D2R : 0;
      list.forEach((t) => {
        if (t.lat === undefined) return;
        const [x, y] = toScreen(t.lat, t.lon);
        if (x < vp.rect.x - 20 || x > vp.rect.x + vp.rect.w + 20 || y < vp.rect.y - 20 || y > vp.rect.y + vp.rect.h + 20) return;
        c.save(); c.translate(x, y); LX.symbols.flarmSymbol(c, t, st.flarmSymbolSize || 10, rot); c.restore();
        if (st.flarmLabels === 'none' || (st.flarmLabels === 'near' && Math.abs(t.dh) > 300)) return;
        const dh = Math.round(Math.abs(LX.units.alt(t.dh)) / 10) * 10;
        LX.symbols.otext(c, `${t.dh >= 0 ? '+' : '−'}${dh}${t.vs > 0.5 ? '↑' : t.vs < -0.5 ? '↓' : ''}`, x + 11, y + 4, 12, { weight: 'normal' });
      });
    }

    drawGoal(c, vp, d, toScreen, st) {
      st = st || {};
      // ground track: straight ahead (up when track-up)
      c.lineWidth = st.trackWidth || 2;
      c.strokeStyle = st.trackColor || 'rgba(70,70,70,.9)';
      const up = vp.up === 'track';
      const [tx, ty] = up ? [vp.ox, vp.oy - 4000] : (() => {
        const p = geo.dest(vp.own ? vp.own.lat : vp.lat, vp.own ? vp.own.lon : vp.lon, vp.track, 60000);
        return toScreen(p.lat, p.lon);
      })();
      if (st.showTrackLine !== false) { c.beginPath(); c.moveTo(vp.ox, vp.oy); c.lineTo(tx, ty); c.stroke(); }

      const nav = d.f && d.f.nav;
      if (!nav) return;
      const [gx, gy] = toScreen(nav.target.lat, nav.target.lon);
      if (st.showTargetLine !== false) {
        c.strokeStyle = st.targetColor || '#ff2fd5';
        c.lineWidth = st.targetWidth || 3;
        c.beginPath(); c.moveTo(vp.ox, vp.oy); c.lineTo(gx, gy); c.stroke();
      }
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
      if (d.collision && st.showCollision !== false) { // terrain collision on the glide (manual 8.3.4): red rectangle on the magenta line
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

  LX.Map = { Renderer: MapRenderer, AIRSPACE_TYPES, SCHEMES, SCHEME_NAMES, ZOOMS, terrain, ramp, tileMath: { tileX, tileY, tileLon, tileLat, tileZoom }, TILE_STYLES };
})(window);
