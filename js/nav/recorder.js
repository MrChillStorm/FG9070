/**
 * Flight recorder + logbook (manual 7.1.2, 7.4.1).
 *
 * Records a fix every `recInterval` seconds while flying and stores finished
 * flights in the browser (IndexedDB). A flight can be exported as an IGC file –
 * clearly marked as an UNOFFICIAL simulator recording, with no security
 * signature, so it is not valid for any badge, record or contest.
 *
 * Fix format: [secondsOfDay, lat, lon, altM, groundSpeedMs, teVarioMs]
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const geo = LX.geo;
  const MAX_FLIGHTS = 25;
  const MAX_FIXES = 6000;

  class Recorder {
    constructor(settings, nav) {
      this.S = settings;
      this.nav = nav;
      this.flights = []; // finished, newest first
      this.cur = null;
      this.lastT = -1e9;
    }

    async load() {
      const s = await LX.Files.Store.get('flights');
      if (Array.isArray(s)) this.flights = s;
    }

    count() { return this.flights.length + (this.cur ? 1 : 0); }

    /** Call regularly with the flight state. */
    tick(f, flying, tMs) {
      const s = this.S.get();
      if (flying && !this.cur) this.begin(f, tMs);
      if (this.cur && flying && tMs - this.lastT >= (s.recInterval || 4) * 1000) {
        this.lastT = tMs;
        const sod = this.cur.startSod + (tMs - this.cur.t0) / 1000;
        if (this.cur.fixes.length < MAX_FIXES) this.cur.fixes.push([sod, f.lat, f.lon, f.alt, f.gs, f.te]);
      }
    }

    begin(f, tMs) {
      const d = new Date();
      this.cur = {
        date: d.toISOString().slice(0, 10), start: d.toTimeString().slice(0, 5),
        startSod: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(),
        t0: tMs, fixes: [], glider: LX.polar.glider(this.S.get().glider).name, pilot: this.S.get().pilot || '',
        task: this.nav && this.nav.task && this.nav.task.length ? this.nav.options.name : '',
      };
      this.lastT = -1e9;
    }

    /** Landed: finalise and persist the current flight. */
    end(summary) {
      const c = this.cur;
      this.cur = null;
      if (!c || c.fixes.length < 5) return null;
      const alts = c.fixes.map((x) => x[3]);
      const rec = Object.assign(c, {
        dur: c.fixes[c.fixes.length - 1][0] - c.fixes[0][0],
        maxAlt: Math.max(...alts), minAlt: Math.min(...alts),
        thermals: summary && summary.thermals !== undefined ? summary.thermals : 0,
      });
      delete rec.t0;
      this.flights.unshift(rec);
      this.flights = this.flights.slice(0, MAX_FLIGHTS);
      LX.Files.Store.set('flights', this.flights);
      return rec;
    }

    remove(i) { this.flights.splice(i, 1); LX.Files.Store.set('flights', this.flights); }

    /** Flight `i` (0 = newest finished); i === -1 -> the one in progress. */
    get(i) { return i < 0 ? this.cur : this.flights[i]; }

    igc(rec) {
      const date = new Date(rec.date + 'T00:00:00Z');
      return LX.Files.writeIGC(rec.fixes, { date, pilot: rec.pilot, glider: rec.glider });
    }

    downloadIGC(i) {
      const rec = i === undefined ? (this.cur && this.cur.fixes.length > 5 ? this.cur : this.flights[0]) : this.get(i);
      if (!rec) return false;
      LX.filesUI.download(`${rec.date.replace(/-/g, '')}_${rec.start.replace(':', '')}_SIM.igc`, this.igc(rec), 'text/plain');
      return true;
    }
  }

  /** Statistics derived from a fix list (replay "statistics" view and logbook). */
  function stats(fixes) {
    if (fixes.length < 2) return null;
    let dist = 0, maxGs = 0, minV = 1e9, maxV = -1e9, sumV = 0;
    for (let i = 1; i < fixes.length; i++) {
      dist += geo.dist(fixes[i - 1][1], fixes[i - 1][2], fixes[i][1], fixes[i][2]);
      maxGs = Math.max(maxGs, fixes[i][4]);
      const dt = fixes[i][0] - fixes[i - 1][0];
      if (dt > 0) { const v = (fixes[i][3] - fixes[i - 1][3]) / dt; minV = Math.min(minV, v); maxV = Math.max(maxV, v); sumV += v * dt; }
    }
    const dur = fixes[fixes.length - 1][0] - fixes[0][0];
    const alts = fixes.map((f) => f[3]);
    return {
      dur, dist, avgSpeed: dur > 0 ? dist / dur : 0, maxGs, minV, maxV, avgV: dur > 0 ? sumV / dur : 0,
      maxAlt: Math.max(...alts), minAlt: Math.min(...alts), takeoffAlt: alts[0], landAlt: alts[alts.length - 1],
    };
  }

  LX.Recorder = Recorder;
  LX.flightStats = stats;
})(window);
