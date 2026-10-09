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

  /** Plain-language names for the EUMETView layers (the raw names are technical: msg_fes:ir108 ...). */
  const SAT_KINDS = [
    [/natural/i, 'Natural colour (daytime)', 'Looks like a photo from space: cloud, snow and ground. Best for spotting cumulus fields. Daytime only.'],
    [/hrv/i, 'High-resolution visible (daytime)', 'Sharpest daytime cloud picture; shows individual cumulus. Daytime only.'],
    [/vis_?006/i, 'Visible 0.6 µm (daytime)', 'Plain daytime cloud picture in black and white.'],
    [/vis_?008/i, 'Visible 0.8 µm (daytime)', 'Daytime cloud and vegetation, black and white.'],
    [/nir_?016/i, 'Near infrared 1.6 µm (daytime)', 'Tells ice cloud from water cloud and snow from cloud. Daytime only.'],
    [/ir_?108/i, 'Infrared (cloud-top temperature)', 'Works day and night. The colder the grey/colour, the higher the cloud top.'],
    [/ir_?039/i, 'Infrared 3.9 µm (low cloud, fog)', 'Shows low cloud and fog at night; sun glint by day.'],
    [/ir_?120/i, 'Infrared 12.0 µm', 'Like the 10.8 µm infrared; for experts.'],
    [/ir_?134/i, 'Infrared 13.4 µm (CO2)', 'Temperature of the mid-troposphere; for experts.'],
    [/ir_?087|ir_?097/i, 'Infrared (ozone / 8.7 µm)', 'For experts.'],
    [/wv_?062/i, 'Water vapour 6.2 µm', 'Moisture high in the atmosphere; shows jet streams and dry intrusions.'],
    [/wv_?073/i, 'Water vapour 7.3 µm', 'Moisture in the middle layers of the atmosphere.'],
    [/clm|cloud_?mask/i, 'Cloud mask', 'Where the satellite sees cloud (a processed product).'],
    [/cth|cloud_?top/i, 'Cloud top height', 'Height of the cloud tops in colour.'],
    [/kindex|gii_ki/i, 'K-index (thunderstorm risk)', 'Atmospheric instability derived from the satellite.'],
    [/liftedindex|gii_li/i, 'Lifted index (instability)', 'Negative values mean an unstable atmosphere.'],
    [/fire|frp/i, 'Fire detection', 'Active fires seen by the satellite.'],
  ];
  const SAT_REGIONS = { msg_fes: 'Meteosat Europe/Africa', mtg_fd: 'Meteosat Third Gen.', msg_iodc: 'Meteosat Indian Ocean' };

  /** { label, desc, known } for a layer name like "msg_fes:ir108". Unknown layers keep their technical name. */
  function describeSat(name) {
    const [ws, rest] = String(name).split(':');
    const region = SAT_REGIONS[ws] || ws;
    const k = SAT_KINDS.find((e) => e[0].test(rest || ''));
    return k ? { label: `${k[1]} - ${region}`, desc: k[2], known: true } : { label: `${rest || name} - ${region}`, desc: 'Technical layer without a description. Try it and see.', known: false };
  }

  class Weather {
    constructor(settings) {
      this.S = settings;
      this.rain = null;        // { host, frames: [{ time, path }], fetched }
      this.satLayers = null;   // layer names from EUMETView, null until loaded
      this.fcCache = new Map(); // lattice cell -> { t, times, vals } (see loadForecast)
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
        if (this.onSatLayers) this.onSatLayers();
      } catch (e) { this.status.sat = 'failed: ' + e.message; setTimeout(() => { this._busy.sat = false; }, 300000); return; }
      this._busy.sat = false;
    }

    /** Layers to offer: the ones with a plain-language name (Europe/Africa and Meteosat Third Gen.), or everything with "all". */
    satOptions(showAll) {
      const ls = this.satLayers || [];
      return showAll ? ls : ls.filter((n) => describeSat(n).known && !/^msg_iodc:/.test(n));
    }

    satLayerName(s) {
      const ls = this.satLayers || [];
      if (s.wxSatLayer && ls.indexOf(s.wxSatLayer) >= 0) return s.wxSatLayer;
      for (const re of [/^msg_fes:.*natural/i, /^msg_fes:.*ir_?108/i, /^msg_fes:.*hrv/i, /^msg_fes:/]) { const m = ls.find((n) => re.test(n)); if (m) return m; }
      return null;
    }

    /* -------------------------------------------------------------------- forecast */
    /*
     * Open-Meteo counts every location as one API call (free tier: 600 per minute, 10000 per day), so the forecast grid
     * is a FIXED lattice (cells snapped to 0.1 ... 8 degrees by zoom). Cells are cached for an hour and shared by
     * every parameter, a request carries at most 30 missing cells, requests are 6 s apart, and a failure
     * (HTTP 429 or network) pauses all forecast requests for 1 or 5 minutes.
     */
    static fcStep(box) {
      const raw = Math.max(box.lat1 - box.lat0, box.lon1 - box.lon0) / 8;
      return [0.1, 0.25, 0.5, 1, 2, 4, 8].find((v) => v >= raw) || 8;
    }

    /** Lattice cells (centres) inside the box: [{ key, lat, lon }]. */
    static fcCells(box, step) {
      const out = [];
      for (let i = Math.floor(box.lat0 / step); i <= Math.ceil(box.lat1 / step); i++) {
        for (let j = Math.floor(box.lon0 / step); j <= Math.ceil(box.lon1 / step); j++) out.push({ key: `${step}/${i}/${j}`, lat: +(i * step).toFixed(3), lon: +(j * step).toFixed(3) });
      }
      return out;
    }

    async loadForecast(vp, box) {
      const now = Date.now();
      if (this._busy.fc || now < (this.fcFailUntil || 0) || now < (this.fcNext || 0)) return;
      const cache = this.fcCache || (this.fcCache = new Map());
      let step = Weather.fcStep(box), cells = Weather.fcCells(box, step);
      while (cells.length > 80 && step < 8) { step = [0.1, 0.25, 0.5, 1, 2, 4, 8][[0.1, 0.25, 0.5, 1, 2, 4, 8].indexOf(step) + 1] || 8; cells = Weather.fcCells(box, step); }
      const missing = cells.filter((c) => !cache.has(c.key) || now - cache.get(c.key).t > 3600000).slice(0, 30);
      if (!missing.length) return;
      this._busy.fc = true;
      this.fcNext = now + 6000; // 30 cells per 6 s = at most 300 locations a minute (the free limit is 600)
      try {
        const q = 'cloud_cover,cape,boundary_layer_height,precipitation';
        const r = await fetch(`${OPEN_METEO}?latitude=${missing.map((c) => c.lat).join(',')}&longitude=${missing.map((c) => c.lon).join(',')}&hourly=${q}&forecast_days=2&timezone=GMT`);
        if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        const j = await r.json();
        const arr = Array.isArray(j) ? j : [j];
        arr.forEach((o, i) => cache.set(missing[i].key, { t: Date.now(), times: o.hourly.time, vals: o.hourly }));
        if (cache.size > 600) cache.delete(cache.keys().next().value);
        this.status.fc = `${cache.size} grid cells cached`;
      } catch (e) {
        this.fcFailUntil = Date.now() + (e.status === 429 ? 300000 : 60000);
        this.status.fc = e.status === 429 ? 'Open-Meteo says too many requests; pausing 5 min' : 'failed: ' + e.message + '; retrying in 1 min';
      }
      this._busy.fc = false;
    }

    /** Forecast blobs for the hour `offsetH` from now and the parameter in `s`: [{ lat, lon, color }] or null. */
    fcBlobs(offsetH, s, box) {
      if (!this.fcCache || !box) return null;
      const param = s.wxFcParam || 'cloud_cover', want = new Date(Date.now() + offsetH * 3600000).toISOString().slice(0, 13);
      const step = Weather.fcStep(box), out = [];
      Weather.fcCells(box, step).forEach((c) => {
        const e = this.fcCache.get(c.key);
        if (!e || !e.vals[param]) return;
        let idx = e.times.findIndex((t) => t.slice(0, 13) === want);
        if (idx < 0) idx = Math.min(e.times.length - 1, Math.max(0, offsetH));
        out.push({ lat: c.lat, lon: c.lon, color: fcColor(param, e.vals[param][idx]) });
      });
      return out.length ? out : null;
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
        this.loadForecast(vp, vp.box);
        out.blobs = this.fcBlobs(s.wxFcOffset || 0, s, vp.box);
        out.blobAlpha = (s.wxFcOpacity || 60) / 100;
        if (out.blobs) out.attr.push('Open-Meteo.com');
      }
      return out;
    }
  }

  LX.Weather = Weather;
  LX.Weather.tileBBox = tileBBox;
  LX.Weather.describeSat = describeSat;
  LX.Weather.fcColor = fcColor;
})(window);
