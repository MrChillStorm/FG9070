/**
 * Data files: parsers, storage and loading ("Files and Transfer").
 *
 * Formats (all free / open):
 *   SeeYou CUP         waypoints + tasks                      parseCUP / writeCUP
 *   OpenAir            airspace (openaip.net, many others)    parseOpenAir
 *   OurAirports CSV    airports (public domain)               parseOurAirports
 *   OpenAIP JSON       airspace / airports / navaids          parseOpenAIP*
 *
 * The OpenAIP JSON shapes follow the public "core API" description; since the
 * service needs an API key I could not test against live responses – the
 * parsers are written defensively and covered by fixtures only.
 *
 * Parsed data is kept in IndexedDB (localStorage fallback) so it survives
 * reloads. Everything is SI (m) with decimal-degree coordinates.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const FT = 0.3048;

  /* --------------------------------------------------------------------- CSV */
  /** Split one CSV line honouring double quotes. */
  function csvLine(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /* --------------------------------------------------------------------- CUP */
  /** DDMM.mmmN / DDDMM.mmmE -> decimal degrees. */
  function cupCoord(s) {
    const m = /^(\d+)(\d\d\.\d+)([NSEW])$/.exec(s.trim());
    if (!m) return NaN;
    const v = parseInt(m[1], 10) + parseFloat(m[2]) / 60;
    return m[3] === 'S' || m[3] === 'W' ? -v : v;
  }
  const cupElev = (s) => { const m = /^(-?[\d.]+)\s*(m|ft)?$/i.exec((s || '').trim()); if (!m) return 0; const v = parseFloat(m[1]); return /ft/i.test(m[2] || '') ? v * FT : v; };
  const CUP_TYPE = { 1: 'tp', 2: 'airport', 3: 'field', 4: 'glider', 5: 'airport', 6: 'tp', 7: 'tp', 8: 'tp', 9: 'tp', 10: 'tp', 11: 'tp', 12: 'tp', 13: 'tp', 14: 'tp', 15: 'tp', 16: 'tp', 17: 'tp' };
  const CUP_STYLE = { airport: 5, glider: 4, field: 3, tp: 1, mark: 1 };

  function parseCUP(text) {
    const waypoints = [], tasks = [];
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    let inTasks = false, cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^-+Related Tasks-+$/i.test(line)) { inTasks = true; continue; }
      const f = csvLine(line);
      if (!inTasks) {
        if (/^name$/i.test(f[0])) continue; // header
        const lat = cupCoord(f[3] || ''), lon = cupCoord(f[4] || '');
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        waypoints.push({
          name: f[0], code: f[1] || f[0].slice(0, 6), lat, lon, elev: cupElev(f[5]),
          type: CUP_TYPE[parseInt(f[6], 10)] || 'tp', rwDir: f[7], rwLen: parseFloat(f[8]) || 0, freq: f[9], desc: f[10] || '',
        });
      } else if (/^Options,/i.test(line) && cur) {
        const o = {};
        f.slice(1).forEach((kv) => { const [k, v] = kv.split('='); o[k] = v; });
        if (o.TaskTime) { const [h, m] = o.TaskTime.split(':').map(Number); cur.options.aatTime = h * 60 + (m || 0); }
        if (o.NoStart) cur.options.beforeStart = 0;
      } else if (/^ObsZone=/i.test(line) && cur) {
        const o = {};
        f.forEach((kv) => { const [k, v] = kv.split('='); o[k] = v; });
        const i = parseInt(o.ObsZone, 10);
        const z = cur.zones[i] = cur.zones[i] || {};
        const len = (v) => { const m = /^([\d.]+)\s*(km|nm|ml|m)?$/i.exec(v || ''); if (!m) return undefined; const x = parseFloat(m[1]); return { km: x * 1000, nm: x * 1852, ml: x * 1609.344 }[(m[2] || 'm').toLowerCase()] || x; };
        if (o.R1) z.r1 = len(o.R1);
        if (o.A1) z.a1 = parseFloat(o.A1);
        if (o.A12) z.a12 = parseFloat(o.A12);
        if (o.R2) z.r2 = len(o.R2);
        if (o.A2) z.a2 = parseFloat(o.A2);
        if (o.Line === '1') z.line = true;
        if (o.Style !== undefined) z.dir = { 0: 'fixed', 1: 'symmetric', 2: 'next', 3: 'prev', 4: 'start' }[o.Style] || 'symmetric';
        if (o.Reduce === '1') cur.options.obsCorr = true;
      } else if (!/^STARTS=/i.test(line)) {
        // task line: "description","wp1","wp2",...
        cur = { name: f[0] || 'Task', points: f.slice(1).filter(Boolean), zones: [], options: {} };
        tasks.push(cur);
      }
    }
    return { waypoints, tasks };
  }

  function writeCUP(waypoints, tasks) {
    const c = (v, lonFlag) => {
      const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
      return String(d).padStart(lonFlag ? 3 : 2, '0') + m.toFixed(3).padStart(6, '0') + (lonFlag ? (v < 0 ? 'W' : 'E') : (v < 0 ? 'S' : 'N'));
    };
    const lines = ['name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc'];
    waypoints.forEach((w) => lines.push(`"${w.name}","${w.code || ''}",,${c(w.lat, false)},${c(w.lon, true)},${(w.elev || 0).toFixed(1)}m,${CUP_STYLE[w.type] || 1},,${w.rwLen || ''},,"${w.desc || ''}"`));
    if (tasks && tasks.length) {
      lines.push('-----Related Tasks-----');
      tasks.forEach((t) => lines.push(`"${t.name}",${t.points.map((p) => `"${p}"`).join(',')}`));
    }
    return lines.join('\n') + '\n';
  }

  /* ----------------------------------------------------------------- OpenAir */
  function oaAlt(s) {
    s = (s || '').trim().toUpperCase();
    if (!s) return 0;
    if (/^(GND|SFC|AGL)/.test(s) || s === '0') return 0;
    if (/^(UNL|UNLIM)/.test(s)) return 20000;
    let m = /^FL\s*(\d+)/.exec(s);
    if (m) return parseInt(m[1], 10) * 100 * FT;
    m = /^(\d+(?:\.\d+)?)\s*(FT|F|M)?/.exec(s);
    if (m) return parseFloat(m[1]) * (m[2] === 'M' ? 1 : FT);
    return 0;
  }
  function oaCoord(s) {
    // 46:30:00 N 014:20:00 E   or   46:30.5 N ...
    const m = /(\d+):(\d+)(?::(\d+(?:\.\d+)?))?\s*([NS])\s+(\d+):(\d+)(?::(\d+(?:\.\d+)?))?\s*([EW])/i.exec(s);
    if (!m) return null;
    const lat = (+m[1] + +m[2] / 60 + (+m[3] || 0) / 3600) * (m[4].toUpperCase() === 'S' ? -1 : 1);
    const lon = (+m[5] + +m[6] / 60 + (+m[7] || 0) / 3600) * (m[8].toUpperCase() === 'W' ? -1 : 1);
    return { lat, lon };
  }

  function parseOpenAir(text) {
    const out = [];
    let cur = null, center = null, cw = true;
    const flush = () => { if (cur && (cur.poly.length >= 3 || cur.circle)) { if (!cur.circle && cur.poly.length) cur.poly = cur.poly.map((p) => [p.lat, p.lon]); out.push(cur); } cur = null; };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\*.*$/, '').trim();
      if (!line) continue;
      const tag = line.slice(0, 2).toUpperCase();
      const rest = line.slice(2).trim();
      if (tag === 'AC') { flush(); cur = { name: '', cls: rest, lower: 0, upper: 0, poly: [] }; center = null; cw = true; }
      else if (!cur) continue;
      else if (tag === 'AN') cur.name = rest;
      else if (tag === 'AL') cur.lower = oaAlt(rest);
      else if (tag === 'AH') cur.upper = oaAlt(rest);
      else if (tag === 'DP') { const c = oaCoord(rest); if (c) cur.poly.push(c); }
      else if (line.toUpperCase().startsWith('V X=')) center = oaCoord(line.slice(4));
      else if (line.toUpperCase().startsWith('V D=')) cw = line.slice(4).trim() !== '-';
      else if (tag === 'DC' && center) cur.circle = { lat: center.lat, lon: center.lon, r: parseFloat(rest) * 1852 };
      else if (tag === 'DB' && center) {
        const [a, b] = rest.split(',').map((s) => oaCoord(s));
        if (a && b) {
          const r = geo.dist(center.lat, center.lon, a.lat, a.lon);
          let b0 = geo.bearing(center.lat, center.lon, a.lat, a.lon), b1 = geo.bearing(center.lat, center.lon, b.lat, b.lon);
          let span = cw ? ((b1 - b0 + 360) % 360) : -((b0 - b1 + 360) % 360);
          const n = Math.max(2, Math.ceil(Math.abs(span) / 5));
          for (let i = 0; i <= n; i++) { const p = geo.dest(center.lat, center.lon, b0 + (span * i) / n, r); cur.poly.push({ lat: p.lat, lon: p.lon }); }
        }
      }
    }
    flush();
    return out;
  }

  /* ------------------------------------------------------------ OurAirports */
  function parseOurAirports(text, opts) {
    opts = opts || {};
    const lines = text.split(/\r?\n/);
    const head = csvLine(lines[0]);
    const ix = (n) => head.indexOf(n);
    const iT = ix('type'), iN = ix('name'), iLa = ix('latitude_deg'), iLo = ix('longitude_deg'), iE = ix('elevation_ft'), iId = ix('ident'), iC = ix('iso_country'), iKw = ix('keywords');
    const out = [];
    for (let k = 1; k < lines.length; k++) {
      if (!lines[k]) continue;
      const f = csvLine(lines[k]);
      const type = f[iT];
      if (!/^(small_airport|medium_airport|large_airport)$/.test(type)) continue;
      const lat = parseFloat(f[iLa]), lon = parseFloat(f[iLo]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (opts.center && geo.dist(opts.center.lat, opts.center.lon, lat, lon) > (opts.radius || 400000)) continue;
      const glider = /glid|soar|segel/i.test((f[iKw] || '') + ' ' + (f[iN] || ''));
      out.push({ name: f[iN], code: f[iId], lat, lon, elev: (parseFloat(f[iE]) || 0) * FT, type: glider ? 'glider' : 'airport', country: f[iC] });
    }
    return out;
  }

  /** runways.csv -> { ident: [{ le, he, len (m), width (m), surface, hdg }] } */
  function parseRunways(text) {
    const lines = text.split(/\r?\n/);
    const head = csvLine(lines[0]);
    const ix = (n) => head.indexOf(n);
    const iA = ix('airport_ident'), iL = ix('length_ft'), iW = ix('width_ft'), iS = ix('surface'), iLe = ix('le_ident'), iHe = ix('he_ident'), iH = ix('le_heading_degT'), iC = ix('closed');
    const out = {};
    for (let k = 1; k < lines.length; k++) {
      if (!lines[k]) continue;
      const f = csvLine(lines[k]);
      if (f[iC] === '1') continue;
      (out[f[iA]] = out[f[iA]] || []).push({ le: f[iLe], he: f[iHe], len: Math.round((parseFloat(f[iL]) || 0) * FT), width: Math.round((parseFloat(f[iW]) || 0) * FT), surface: f[iS], hdg: parseFloat(f[iH]) });
    }
    return out;
  }

  /** airport-frequencies.csv -> { ident: [{ type, desc, mhz }] } */
  function parseFrequencies(text) {
    const lines = text.split(/\r?\n/);
    const head = csvLine(lines[0]);
    const ix = (n) => head.indexOf(n);
    const iA = ix('airport_ident'), iT = ix('type'), iD = ix('description'), iF = ix('frequency_mhz');
    const out = {};
    for (let k = 1; k < lines.length; k++) {
      if (!lines[k]) continue;
      const f = csvLine(lines[k]);
      (out[f[iA]] = out[f[iA]] || []).push({ type: f[iT], desc: f[iD], mhz: parseFloat(f[iF]) });
    }
    return out;
  }

  /** METAR JSON (aviationweather.gov style) -> { raw, temp, dew, wdir, wspd, qnh } or null. */
  function parseMetar(json) {
    const m = Array.isArray(json) ? json[0] : json;
    if (!m) return null;
    return { raw: m.rawOb || m.raw_text || '', temp: m.temp, dew: m.dewp, wdir: m.wdir, wspd: m.wspd, qnh: m.altim, time: m.obsTime };
  }

  /* ----------------------------------------------------------------- OpenAIP */
  const oaipAlt = (l) => {
    if (!l || l.value === undefined) return 0;
    const u = l.unit; // 0 = m, 1 = ft, 6 = FL (per the core API enums)
    const v = Number(l.value);
    return u === 6 ? v * 100 * FT : u === 1 ? v * FT : v;
  };
  function parseOpenAIPAirspaces(json) {
    const items = (json && (json.items || json)) || [];
    const out = [];
    for (const a of items) {
      const g = a.geometry;
      if (!g || g.type !== 'Polygon') continue;
      out.push({
        name: a.name, cls: a.icaoClass !== undefined ? 'ABCDEFG?'[a.icaoClass] || '?' : a.type !== undefined ? String(a.type) : '',
        lower: oaipAlt(a.lowerLimit), upper: oaipAlt(a.upperLimit),
        poly: g.coordinates[0].map((c) => [c[1], c[0]]),
      });
    }
    return out;
  }
  function parseOpenAIPAirports(json) {
    const items = (json && (json.items || json)) || [];
    const out = [];
    for (const a of items) {
      const g = a.geometry;
      if (!g || g.type !== 'Point') continue;
      const glider = a.type === 3 || /glid/i.test(a.name || ''); // type 3 = gliding site in the core API enum
      out.push({
        name: a.name, code: a.icaoCode || (a.name || '').slice(0, 6), lat: g.coordinates[1], lon: g.coordinates[0],
        elev: a.elevation && a.elevation.value !== undefined ? Number(a.elevation.value) * (a.elevation.unit === 1 ? FT : 1) : 0,
        type: glider ? 'glider' : 'airport',
        freq: (a.frequencies && a.frequencies[0] && a.frequencies[0].value) || '',
        rwLen: (a.runways && a.runways[0] && a.runways[0].dimension && a.runways[0].dimension.length && a.runways[0].dimension.length.value) || 0,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ IGC */
  /** IGC B-record text for a recorded fix list [[tSec, lat, lon, altM], ...]. */
  function writeIGC(fixes, meta) {
    meta = meta || {};
    const d = meta.date || new Date();
    const dd = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCFullYear()).slice(2);
    const coord = (v, lon) => { const a = Math.abs(v), deg = Math.floor(a), min = Math.round((a - deg) * 60000); return String(deg).padStart(lon ? 3 : 2, '0') + String(min).padStart(5, '0') + (lon ? (v < 0 ? 'W' : 'E') : (v < 0 ? 'S' : 'N')); };
    const lines = [
      'AXXXFG9070 TRAINER (UNOFFICIAL SIMULATOR - NOT A VALID IGC RECORDING)',
      `HFDTE${dd}`, 'HFFXA035', `HFPLTPILOTINCHARGE:${meta.pilot || ''}`, `HFGTYGLIDERTYPE:${meta.glider || ''}`,
      'HFGPSFLIGHTGEAR SIMULATOR', 'HFDTM100GPSDATUM:WGS-1984',
    ];
    fixes.forEach((f) => {
      const t = Math.max(0, Math.round(f[0]));
      const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(t / 60) % 60).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
      const alt = String(Math.max(0, Math.round(f[3]))).padStart(5, '0');
      lines.push(`B${hh}${mm}${ss}${coord(f[1], false)}${coord(f[2], true)}A${alt}${alt}`);
    });
    return lines.join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------- flight declaration (.hdr) */
  const ddmm = (v, lon) => { const a = Math.abs(v), deg = Math.floor(a), min = Math.round((a - deg) * 60000); return String(deg).padStart(lon ? 3 : 2, '0') + String(min).padStart(5, '0') + (lon ? (v < 0 ? 'W' : 'E') : (v < 0 ? 'S' : 'N')); };
  /**
   * IGC style declaration: header records plus C records (take-off, start, turn points, finish, landing).
   * decl = { pilot, glider, regId, compId, name, points: [{ name, lat, lon }] (start .. finish), date }.
   */
  function writeDeclaration(decl) {
    const d = decl.date || new Date();
    const dmy = (x) => String(x.getUTCDate()).padStart(2, '0') + String(x.getUTCMonth() + 1).padStart(2, '0') + String(x.getUTCFullYear()).slice(2);
    const hms = (x) => String(x.getUTCHours()).padStart(2, '0') + String(x.getUTCMinutes()).padStart(2, '0') + String(x.getUTCSeconds()).padStart(2, '0');
    const pts = decl.points || [];
    const L = ['HFPLTPILOTINCHARGE:' + (decl.pilot || ''), 'HFGTYGLIDERTYPE:' + (decl.glider || ''), 'HFGIDGLIDERID:' + (decl.regId || ''), 'HFCIDCOMPETITIONID:' + (decl.compId || '')];
    L.push(`C${dmy(d)}${hms(d)}000000${'0001'}${String(Math.max(0, pts.length - 2)).padStart(2, '0')}${decl.name || 'TASK'}`);
    const rec = (p, n) => 'C' + ddmm(p.lat, false) + ddmm(p.lon, true) + (n || p.name || '');
    if (pts.length) L.push(rec(pts[0], 'TAKEOFF'));
    pts.forEach((p) => L.push(rec(p)));
    if (pts.length) L.push(rec(pts[pts.length - 1], 'LANDING'));
    return L.join('\r\n') + '\r\n';
  }
  /** Inverse of writeDeclaration: { pilot, glider, regId, compId, name, points }. Take-off and landing are dropped. */
  function parseDeclaration(text) {
    const out = { pilot: '', glider: '', regId: '', compId: '', name: '', points: [] };
    const rows = [];
    text.split(/\r?\n/).forEach((l) => {
      let m;
      if ((m = /^HFPLT[^:]*:(.*)$/.exec(l))) out.pilot = m[1].trim();
      else if ((m = /^HFGTY[^:]*:(.*)$/.exec(l))) out.glider = m[1].trim();
      else if ((m = /^HFGID[^:]*:(.*)$/.exec(l))) out.regId = m[1].trim();
      else if ((m = /^HFCID[^:]*:(.*)$/.exec(l))) out.compId = m[1].trim();
      else if (l[0] === 'C' && /^C\d{6}\d{6}\d{6}/.test(l)) out.name = l.slice(25).trim() || 'TASK';
      else if ((m = /^C(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])(.*)$/.exec(l))) {
        const lat = (+m[1] + m[2] / 60000) * (m[3] === 'S' ? -1 : 1), lon = (+m[4] + m[5] / 60000) * (m[6] === 'W' ? -1 : 1);
        rows.push({ name: m[7].trim() || 'TP' + rows.length, lat, lon });
      }
    });
    out.points = rows.length > 2 ? rows.slice(1, -1) : rows; // drop take-off / landing
    return out;
  }

  /* ------------------------------------------------------------------ checklists */
  /**
   * Plain-text checklist file: a line starting with '#' begins a checklist (its title), every other
   * non-empty line is an action. (The real unit uses LX Styler's .checklists files, which are not read here.)
   */
  function parseChecklists(text) {
    const lists = [];
    text.split(/\r?\n/).forEach((l) => {
      l = l.trim(); if (!l) return;
      if (l[0] === '#') lists.push({ title: l.replace(/^#+\s*/, '') || 'Checklist', items: [] });
      else { if (!lists.length) lists.push({ title: 'Checklist', items: [] }); lists[lists.length - 1].items.push(l); }
    });
    return lists.filter((c) => c.items.length);
  }
  const writeChecklists = (lists) => lists.map((c) => '# ' + c.title + '\n' + c.items.join('\n')).join('\n\n') + '\n';

  /* ------------------------------------------------------------------ store */
  const Store = {
    db: null,
    async open() {
      if (this.db) return this.db;
      if (!global.indexedDB) return null;
      this.db = await new Promise((res) => {
        const rq = global.indexedDB.open('fg9070', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      });
      return this.db;
    },
    async get(key) {
      const db = await this.open();
      if (!db) { try { return JSON.parse(global.localStorage.getItem('fg9070.' + key)); } catch (e) { return null; } }
      return new Promise((res) => { const rq = db.transaction('kv').objectStore('kv').get(key); rq.onsuccess = () => res(rq.result === undefined ? null : rq.result); rq.onerror = () => res(null); });
    },
    async set(key, val) {
      const db = await this.open();
      if (!db) { try { global.localStorage.setItem('fg9070.' + key, JSON.stringify(val)); } catch (e) { /* quota */ } return; }
      return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    },
  };

  /* ---------------------------------------------------------------- loading */
  const Files = {
    parseCUP, writeCUP, parseOpenAir, parseOurAirports, parseRunways, parseFrequencies, parseMetar, writeDeclaration, parseDeclaration, parseChecklists, writeChecklists, parseOpenAIPAirspaces, parseOpenAIPAirports, writeIGC, csvLine, Store,

    /** Load a text file by name/extension and merge into nav. Returns a summary string. */
    async loadText(nav, name, text) {
      const lower = name.toLowerCase();
      let msg;
      if (/\.cup$/.test(lower)) {
        const r = parseCUP(text);
        nav.setWaypointFile(r.waypoints);
        r.tasks.forEach((t) => { if (!nav.savedTasks.some((s) => s.points.join('>') === t.points.join('>'))) nav.savedTasks.push(t); });
        await Store.set('waypoints', r.waypoints); await Store.set('tasks', nav.savedTasks);
        msg = `${r.waypoints.length} waypoints, ${r.tasks.length} tasks`;
      } else if (/\.(txt|air|openair)$/.test(lower)) {
        const a = parseOpenAir(text);
        nav.airspaces = a; await Store.set('airspaces', a);
        msg = `${a.length} airspace zones`;
      } else if (/\.csv$/.test(lower)) {
        const a = parseOurAirports(text, nav.homeCenter ? { center: nav.homeCenter, radius: 500000 } : {});
        nav.setAirports(a); await Store.set('airports', a);
        msg = `${a.length} airports`;
      } else if (/\.(json|geojson)$/.test(lower)) {
        const j = JSON.parse(text);
        const first = (j.items || j)[0] || {};
        if (first.geometry && first.geometry.type === 'Polygon') { const a = parseOpenAIPAirspaces(j); nav.airspaces = a; await Store.set('airspaces', a); msg = `${a.length} airspace zones (OpenAIP)`; }
        else { const a = parseOpenAIPAirports(j); nav.setAirports(a); await Store.set('airports', a); msg = `${a.length} airports (OpenAIP)`; }
      } else throw new Error('Unknown file type: ' + name);
      return msg;
    },

    async persistTasks(nav) { await Store.set('tasks', nav.savedTasks); },

    /** Restore previously loaded data into nav (called at start-up). */
    async restore(nav) {
      const [w, a, ap, t] = await Promise.all([Store.get('waypoints'), Store.get('airspaces'), Store.get('airports'), Store.get('tasks')]);
      if (w && w.length) nav.setWaypointFile(w);
      if (a && a.length) nav.airspaces = a;
      if (ap && ap.length) nav.setAirports(ap);
      if (t && t.length) nav.savedTasks = t;
      return !!(w && w.length) || !!(ap && ap.length);
    },

    async clear(kind) { await Store.set(kind, []); },

    /** Online download (CORS-enabled sources only). Airports + runways + frequencies around `center`. */
    async fetchOurAirports(nav, center, radius) {
      const base = LX.SOURCES.ourairports;
      const get = async (name) => { const r = await fetch(base + name); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.text(); };
      const [csv, rw, fq] = await Promise.all([get('airports.csv'), get('runways.csv').catch(() => ''), get('airport-frequencies.csv').catch(() => '')]);
      const a = parseOurAirports(csv, { center, radius: radius || 400000 });
      const rws = rw ? parseRunways(rw) : {}, fqs = fq ? parseFrequencies(fq) : {};
      a.forEach((x) => { if (rws[x.code]) x.runways = rws[x.code]; if (fqs[x.code]) x.freqs = fqs[x.code]; });
      nav.setAirports(a);
      await Store.set('airports', a);
      await Store.set('airportsMeta', { lat: center.lat, lon: center.lon, radius: radius || 400000, t: Date.now() });
      return `${a.length} airports within ${Math.round((radius || 400000) / 1000)} km (${a.filter((x) => x.runways).length} with runway data)`;
    },
    /** Fetch any supported data file from a URL (the server must allow cross-origin requests). */
    async loadURL(nav, url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const name = (url.split('?')[0].split('/').pop() || 'data').toLowerCase();
      return Files.loadText(nav, name, await r.text());
    },
    metarCache: {},
    /** METAR for an ICAO code (cached 10 min); null when unavailable. */
    async fetchMetar(icao) {
      icao = (icao || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(icao)) return null;
      const c = this.metarCache[icao];
      if (c && Date.now() - c.t < 600000) return c.v;
      try {
        const r = await fetch(LX.SOURCES.metar.replace('{id}', icao));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const v = parseMetar(await r.json());
        this.metarCache[icao] = { t: Date.now(), v };
        return v;
      } catch (e) { this.metarCache[icao] = { t: Date.now() - 540000, v: null }; return null; } // retry in a minute
    },
    /**
     * First-fix bootstrap: if no airport database is loaded (or it is far from here), download one.
     * Returns a status string or null when nothing was needed.
     */
    async bootstrap(nav, center) {
      const meta = await Store.get('airportsMeta');
      const have = (nav.airportDb || []).length > 0;
      const far = meta && geo.dist(meta.lat, meta.lon, center.lat, center.lon) > (meta.radius || 400000) * 0.6;
      if (have && !far) return null;
      return Files.fetchOurAirports(nav, center, 400000);
    },
    openaipPause: 1, // multiplier for the pauses between OpenAIP requests (tests set 0)
    async fetchOpenAIP(nav, kind, center, radius, key) {
      if (!key) throw new Error('OpenAIP needs a (free) API key – set it in Files and Transfer');
      // continue where an earlier, rate-limited download of the same area stopped
      const area = `${kind}:${radius}:${center.lat.toFixed(1)},${center.lon.toFixed(1)}`;
      const resume = Files._oaip && Files._oaip.area === area ? Files._oaip : null;
      const out = resume ? resume.out : [];
      const first = resume ? resume.page : 1;
      Files._oaip = null;
      let limited = false, pages = 0;
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const base = ((LX.settings && LX.settings.get().openaipProxy) || 'https://api.core.openaip.net').replace(/\/$/, '');
      for (let page = first; page <= 10; page++) {
        const url = `${base}/api/${kind}?page=${page}&limit=200&pos=${center.lat},${center.lon}&dist=${radius || 100000}`;
        let r;
        // OpenAIP rate-limits (HTTP 429): back off and retry a few times, honouring Retry-After
        for (let attempt = 0; attempt < 4; attempt++) {
          try { r = await fetch(url, { headers: { 'x-openaip-api-key': key } }); }
          catch (e) { throw new Error('OpenAIP blocked by the browser (CORS). Run tools/openaip-proxy.js and set its URL under Proxy'); }
          if (r.status !== 429) break;
          const ra = parseFloat(r.headers && r.headers.get && r.headers.get('retry-after'));
          await wait(Math.min(60000, (isFinite(ra) ? ra : [5, 10, 20, 30][attempt]) * 1000) * Files.openaipPause);
        }
        if (r.status === 429) {
          if (!pages) { if (page > 1) Files._oaip = { area, page, out }; throw new Error('OpenAIP rate limit (HTTP 429): wait a minute and press DOWNLOAD again'); }
          Files._oaip = { area, page, out }; limited = true; break; // keep what we have, resume here next time
        }
        if (!r.ok) throw new Error('OpenAIP HTTP ' + r.status);
        const j = await r.json();
        out.push(...(j.items || [])); pages++;
        if (!j.nextPage) break;
        await wait(1500 * Files.openaipPause); // be gentle with the free API
      }
      const note = limited ? ' (stopped early: OpenAIP rate limit - wait a minute and press DOWNLOAD again to continue)' : '';
      if (kind === 'airspaces') { const a = parseOpenAIPAirspaces(out); nav.airspaces = a; await Store.set('airspaces', a); return `${a.length} airspace zones${note}`; }
      const a = parseOpenAIPAirports(out); nav.setAirports(a); await Store.set('airports', a); return `${a.length} airports${note}`;
    },
  };

  /* nav model helpers used by the loaders */
  LX.Nav.prototype.setWaypointFile = function (list) {
    this.waypointFile = list;
    this._rebuild();
  };
  LX.Nav.prototype.setAirports = function (list) {
    this.airportDb = list;
    this._rebuild();
  };
  LX.Nav.prototype._rebuild = function () {
    // real data replaces the generated demo task / airspace (they refer to demo waypoints)
    if (this.demo) { this.task = []; this.airspaces = []; this.active = 0; this.started = false; this.demoWaypoints = null; }
    const user = this.waypointFile || [];
    const apts = this.airportDb || [];
    const keep = (this.waypoints || []).filter((w) => w.type === 'mark');
    this.waypoints = (user.length ? user : apts).concat(keep); // no waypoint file: the airports serve as waypoints
    const landable = (w) => w.type === 'airport' || w.type === 'glider' || w.type === 'field';
    // airports from the database, minus duplicates of user waypoints (manual 7.3: user file wins)
    const dup = (a) => user.some((w) => landable(w) && geo.dist(w.lat, w.lon, a.lat, a.lon) < 1500);
    this.airports = user.filter(landable).concat(apts.filter((a) => !dup(a)));
    if (!this.selected.apt || this.airports.indexOf(this.selected.apt) < 0) this.selected.apt = this.airports[0] || null;
    if (!this.selected.wpt || this.waypoints.indexOf(this.selected.wpt) < 0) this.selected.wpt = this.waypoints[0] || null;
    this.demo = false;
  };

  LX.Files = Files;
})(window);
