/**
 * Weather layers for the map (manual 7.1.7.2): satellite, forecast and rain radar, from free services that a
 * browser can read directly (tools/weather-probe.js checks them):
 *
 *   rain radar   RainViewer weather-maps.json (past ~2 h in 10 min frames) + radar tiles
 *   satellite    EUMETSAT EUMETView WMS (Meteosat) - layers are read from its GetCapabilities
 *   forecast     Open-Meteo: a coarse grid of points over the map, drawn as soft coloured blobs
 *
 * Everything is opt-in (Setup > Graphics > Weather) because it needs internet. The class only fetches and
 * decides WHAT to draw; map.js draws it. All network failures are kept as a status text, never thrown.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const EUMET = 'https://view.eumetsat.int/geoserver/wms';
  const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
  const RAIN = 'https://api.rainviewer.com/public/weather-maps.json';
  const EARTH = 40075016.686, HALF = EARTH / 2;

  /** Web-mercator bbox (EPSG:3857) of slippy-map tile z/x/y: "minx,miny,maxx,maxy". */
  function tileBBox(z, x, y) {
    const n = Math.pow(2, z), s = EARTH / n;
    const x0 = x * s - HALF, x1 = (x + 1) * s - HALF, y1 = HALF - y * s, y0 = HALF - (y + 1) * s;
    return `${x0},${y0},${x1},${y1}`;
  }

  /** Colour of a forecast value for the chosen parameter: [r, g, b, alpha 0..1]. */
  function fcColor(param, v) {
    const ramp = (t, stops) => { // stops: [[t, [r,g,b]] ...] ascending
      t = Math.max(0, Math.min(1, t));
      for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, a] = stops[i - 1], [t1, b] = stops[i], k = (t - t0) / (t1 - t0); return a.map((q, j) => q + (b[j] - q) * k); }
      return stops[stops.length - 1][1];
    };
    if (param === 'cloud_cover') return [235, 240, 250, Math.min(0.85, v / 100 * 0.85)];
    if (param === 'precipitation') return [40, 90, 255, v < 0.1 ? 0 : Math.min(0.85, 0.3 + v / 5)];
    if (param === 'cape') { const c = ramp(v / 3000, [[0, [60, 120, 255]], [0.15, [60, 200, 120]], [0.5, [255, 220, 60]], [1, [255, 50, 40]]]); return [...c, 0.55]; }
    const c = ramp(v / 3500, [[0, [60, 120, 255]], [0.4, [60, 200, 120]], [0.7, [255, 220, 60]], [1, [255, 50, 40]]]); // boundary layer height, m
    return [...c, 0.55];
  }

  class Weather {
    constructor(settings) {
      this.S = settings;
      this.rain = null;        // { host, frames: [{ time, path }], fetched }
      this.satLayers = null;   // layer names from EUMETView, null until loaded
      this.fc = null;          // { key, t, pts: [{ lat, lon, vals: [...] }], times: [...] }
      this.status = { rain: 'off', sat: 'off', fc: 'off' };
      this._busy = {};
    }

    /** Fetch helper that records problems as status text instead of throwing. */
    async _json(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

    /* ------------------------------------------------------------------ rain radar */
    async loadRain() {
      if (this._busy.rain) return;
      this._busy.rain = true;
      try {
        const j = await this._json(RAIN);
        const frames = ((j.radar && j.radar.past) || []).concat((j.radar && j.radar.nowcast) || []);
        this.rain = { host: j.host, frames, fetched: Date.now() };
        const last = frames[frames.length - 1];
        this.status.rain = last ? `${frames.length} frames, newest ${new Date(last.time * 1000).toISOString().slice(11, 16)}Z` : 'no data';
      } catch (e) { this.status.rain = 'failed: ' + e.message; this.rain = this.rain || { host: '', frames: [], fetched: Date.now() }; } // retried after 5 min
      this._busy.rain = false;
    }

    /** Frame to show now. History span 0 = newest only; otherwise the last N minutes loop, the newest held for "freeze" s. */
    rainFrame(nowMs, s) {
      const fr = this.rain && this.rain.frames;
      if (!fr || !fr.length) return null;
      const span = s.wxRainHistory || 0;
      if (!span) return fr[fr.length - 1];
      const newest = fr[fr.length - 1].time;
      const list = fr.filter((f) => f.time >= newest - span * 60);
      const step = 600, freeze = (s.wxRainFreeze || 0) * 1000, cycle = list.length * step + freeze;
      const k = Math.floor((nowMs % cycle) / step);
      return list[Math.min(list.length - 1, k)];
    }

    /* ------------------------------------------------------------------- satellite */
    async loadSatLayers() {
      if (this._busy.sat || this.satLayers) return;
      this._busy.sat = true;
      try {
        const r = await fetch(`${EUMET}?service=WMS&version=1.3.0&request=GetCapabilities`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
        const names = [...xml.querySelectorAll('Layer > Name')].map((n) => n.textContent.trim());
        // real layers are workspace-qualified (msg_fes:ir108); keep the full-disc Meteosat ones
        this.satLayers = [...new Set(names.filter((n) => /^(msg_fes|msg_iodc|mtg_fd):/.test(n)))].sort();
        this.status.sat = this.satLayers.length + ' Meteosat layers';
      } catch (e) { this.status.sat = 'failed: ' + e.message; setTimeout(() => { this._busy.sat = false; }, 300000); return; }
      this._busy.sat = false;
    }

    satLayerName(s) {
      const ls = this.satLayers || [];
      if (s.wxSatLayer && ls.indexOf(s.wxSatLayer) >= 0) return s.wxSatLayer;
      for (const re of [/^msg_fes:.*natural/i, /^msg_fes:.*ir_?108/i, /^msg_fes:.*hrv/i, /^msg_fes:/]) { const m = ls.find((n) => re.test(n)); if (m) return m; }
      return null;
    }

    /* -------------------------------------------------------------------- forecast */
    /** Grid of forecast points over the visible area (8 x 6), refetched when the view moves or after 15 min. */
    async loadForecast(vp, box, s) {
      const param = s.wxFcParam || 'cloud_cover';
      const key = `${param}/${box.lat0.toFixed(1)}/${box.lon0.toFixed(1)}/${(box.lat1 - box.lat0).toFixed(1)}`;
      if (this._busy.fc || (this.fc && this.fc.key === key && Date.now() - this.fc.t < 900000)) return;
      this._busy.fc = true;
      try {
        const NX = 8, NY = 6, lats = [], lons = [];
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
          lats.push((box.lat1 - (box.lat1 - box.lat0) * (j + 0.5) / NY).toFixed(3));
          lons.push((box.lon0 + (box.lon1 - box.lon0) * (i + 0.5) / NX).toFixed(3));
        }
        const j = await this._json(`${OPEN_METEO}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${param}&forecast_days=2&timezone=GMT`);
        const arr = Array.isArray(j) ? j : [j];
        const pts = arr.map((o, i) => ({ lat: +lats[i], lon: +lons[i], vals: o.hourly[param] }));
        this.fc = { key, t: Date.now(), pts, times: arr[0].hourly.time, param };
        this.status.fc = `${pts.length} points, ${param}`;
      } catch (e) { this.status.fc = 'failed: ' + e.message; this.fc = this.fc ? Object.assign(this.fc, { t: Date.now() - 600000 }) : null; }
      this._busy.fc = false;
    }

    /** Forecast blobs for the hour `offsetH` from now: [{ lat, lon, color }] or null. */
    fcBlobs(offsetH, s) {
      if (!this.fc) return null;
      const want = new Date(Date.now() + offsetH * 3600000).toISOString().slice(0, 13); // YYYY-MM-DDTHH
      let idx = this.fc.times.findIndex((t) => t.slice(0, 13) === want);
      if (idx < 0) idx = Math.min(this.fc.times.length - 1, Math.max(0, offsetH));
      return this.fc.pts.map((p) => ({ lat: p.lat, lon: p.lon, color: fcColor(this.fc.param, p.vals[idx]) }));
    }

    /**
     * What the map should draw for this view: { rasters: [{ key, maxZoom, alpha, urlFor(z, x, y) }], blobs, alpha, attr: [...] }.
     * Also starts the fetches that are needed (at most one per layer in flight).
     */
    layers(vp, s) {
      const out = { rasters: [], blobs: null, blobAlpha: 0, attr: [] };
      if (!(s.wxRain || s.wxSat || s.wxFc)) return out;
      const widthKm = (vp.rect.w * vp.mpp) / 1000;
      if (s.wxMinZoom > 0 && widthKm < s.wxMinZoom) return out; // only visible when zoomed out far enough
      const now = Date.now();
      if (s.wxSat) {
        if (!this.satLayers) this.loadSatLayers();
        const name = this.satLayerName(s);
        if (name) {
          out.rasters.push({ key: 'sat/' + name, maxZoom: 9, alpha: (s.wxSatOpacity || 70) / 100, urlFor: (z, x, y) => `${EUMET}?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(name)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox=${tileBBox(z, x, y)}` });
          out.attr.push('© EUMETSAT');
        }
      }
      if (s.wxRain) {
        if (!this.rain || now - this.rain.fetched > 300000) this.loadRain();
        const f = this.rainFrame(now, s);
        if (f && this.rain.host) {
          out.rasters.push({ key: 'rain/' + f.path, maxZoom: 7, alpha: (s.wxRainOpacity || 70) / 100, urlFor: (z, x, y) => `${this.rain.host}${f.path}/256/${z}/${x}/${y}/2/1_1.png` });
          out.attr.push('Weather data by RainViewer');
        }
      }
      if (s.wxFc && vp.box) {
        this.loadForecast(vp, vp.box, s);
        out.blobs = this.fcBlobs(s.wxFcOffset || 0, s);
        out.blobAlpha = (s.wxFcOpacity || 60) / 100;
        if (out.blobs) out.attr.push('Open-Meteo.com');
      }
      return out;
    }
  }

  LX.Weather = Weather;
  LX.Weather.tileBBox = tileBBox;
  LX.Weather.fcColor = fcColor;
})(window);
