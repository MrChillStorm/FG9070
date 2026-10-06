/**
 * Terrain elevation from free "Terrarium" DEM tiles (RGB-encoded heights:
 * elevation m = R*256 + G + B/256 - 32768), the public Mapzen/AWS terrain
 * dataset (SRTM and other sources). Used for:
 *   - the map's terrain shading (instead of the procedural backdrop)
 *   - the side view, height above ground, the Gnd navbox
 *   - the terrain check on final glide (manual 8.3.4: the yellow "climb N m
 *     to clear the terrain" number and the red collision marker)
 *
 * Tiles load asynchronously; `elevation()` returns undefined until the tiles it
 * needs are available (and requests them), so callers fall back gracefully
 * (procedural terrain, FlightGear's own ground elevation). Everything works
 * without a network – the DEM simply never arrives.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const D2R = Math.PI / 180;
  const T = 256;
  const MAX_LOADS = 6;
  const MAX_TILES = 220;

  /** RGBA bytes -> Float32Array of metres (pure, unit-tested). */
  function decodeRGBA(data) {
    const out = new Float32Array(T * T);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
    return out;
  }

  const tileX = (lon, n) => ((lon + 180) / 360) * n;
  const tileY = (lat, n) => ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n;

  /** Zoom whose pixels are about `mpp` metres at `lat` (clamped to what the tileset offers). */
  function zoomFor(lat, mpp) {
    const z = Math.round(Math.log2((156543.03392 * Math.cos(lat * D2R)) / Math.max(1, mpp)));
    return Math.max(5, Math.min(12, z));
  }

  class DEM {
    constructor(settings) {
      this.S = settings;
      this.tiles = new Map(); // key -> { data: Float32Array } | { failedAt }
      this.loading = 0;
      this.stats = { loaded: 0, failed: 0 };
    }

    enabled() { return this.S.get().terrain !== 'off'; }

    /** Decoded tile or null (requesting it if needed). */
    tile(z, x, y) {
      const n = 1 << z;
      if (y < 0 || y >= n) return null;
      x = ((x % n) + n) % n;
      const key = (z * 4096 + x) * 4096 + y; // numeric key: this is called thousands of times per frame
      const t = this.tiles.get(key);
      if (t) {
        if (t.data) return t.data;
        if (t.failedAt && performance.now() - t.failedAt > 60000) this.tiles.delete(key); else return null;
      }
      if (!this.enabled() || this.loading >= MAX_LOADS || !global.document) return null;
      this.loading++;
      this.tiles.set(key, { pending: true });
      const img = new Image();
      img.crossOrigin = 'anonymous'; // needed to read the pixels back
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = T;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          this.tiles.set(key, { data: decodeRGBA(g.getImageData(0, 0, T, T).data) });
          this.stats.loaded++;
        } catch (e) { this.tiles.set(key, { failedAt: performance.now() }); this.stats.failed++; }
        this.loading--;
      };
      img.onerror = () => { this.tiles.set(key, { failedAt: performance.now() }); this.stats.failed++; this.loading--; };
      img.src = LX.SOURCES.terrarium.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      if (this.tiles.size > MAX_TILES) { for (const k of this.tiles.keys()) { this.tiles.delete(k); if (this.tiles.size <= MAX_TILES - 20) break; } }
      return null;
    }

    /** Bilinear elevation (m) at zoom `z`, or undefined when a needed tile is not loaded. */
    elevationZ(lat, lon, z) {
      const n = 1 << z;
      const px = tileX(lon, n) * T - 0.5, py = tileY(lat, n) * T - 0.5;
      const x0 = Math.floor(px), y0 = Math.floor(py);
      const fx = px - x0, fy = py - y0;
      const at = (ix, iy) => {
        const t = this.tile(z, Math.floor(ix / T), Math.floor(iy / T));
        return t ? t[(((iy % T) + T) % T) * T + (((ix % T) + T) % T)] : undefined;
      };
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }

    /** Elevation with a zoom chosen for a pixel of about `mpp` metres. */
    elevation(lat, lon, mpp) { return this.elevationZ(lat, lon, zoomFor(lat, mpp || 150)); }

    /** Ask for the tiles around a point so lookups succeed soon. */
    prefetch(lat, lon, radiusM, mpp) {
      const z = zoomFor(lat, mpp || 150);
      const n = 1 << z, tileM = (40075016.686 * Math.cos(lat * D2R)) / n;
      const r = Math.min(3, Math.ceil(radiusM / tileM));
      const cx = Math.floor(tileX(lon, n)), cy = Math.floor(tileY(lat, n));
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.tile(z, cx + dx, cy + dy);
    }
  }

  /**
   * Terrain check along the straight glide toward the target (manual 8.3.4): flying the final glide
   * line from `alt` at glide ratio `ratio`, how much extra height is needed to stay `safety` m above the
   * terrain? Returns { climb, lat, lon, dist } for the worst point, or null when clear / unknown.
   */
  DEM.prototype.clearance = function (f, nav, safety, geo) {
    if (!this.enabled() || !nav || !isFinite(nav.Emc) || nav.Emc <= 0) return null;
    const D = nav.dist, brg = nav.bearing;
    if (D < 1500) return null;
    const steps = Math.max(10, Math.min(120, Math.round(D / 400)));
    let worst = null, missing = 0;
    for (let i = 1; i < steps; i++) {
      const d = (D * i) / steps;
      if (D - d < 800) break; // the target area itself is handled by the arrival number
      const p = geo.dest(f.lat, f.lon, brg, d);
      const h = this.elevation(p.lat, p.lon, 300);
      if (h === undefined) { missing++; continue; }
      const path = f.alt - d / nav.Emc;
      const need = h + safety - path;
      if (!worst || need > worst.need) worst = { need, lat: p.lat, lon: p.lon, dist: d };
    }
    if (!worst || worst.need <= 0) return null;
    return { climb: worst.need, lat: worst.lat, lon: worst.lon, dist: worst.dist, missing };
  };

  LX.DEM = DEM;
  LX.demTools = { decodeRGBA, zoomFor, tileX, tileY };
})(window);
