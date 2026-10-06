/**
 * HTTP polling source for FlightGear's built-in web server.
 *
 *   fgfs --httpd=5400
 *   GET http://HOST:5400/json/velocities/airspeed-kt  ->  { "value": 92.4, ... }
 *
 * Every property is fetched in parallel each cycle. Cycles never overlap: the
 * next one starts `interval` ms after the previous one STARTED (or right after
 * it finished if it ran long), so a slow network degrades the rate instead of
 * piling up requests on the simulator.
 *
 * Source interface (shared with ws/demo):
 *   new Source({ props, host, port, hz, onValues(map), onStatus(obj) })
 *   .start()  .stop()
 */
(function (global) {
  'use strict';
  const AP = global.AeroPanel;

  const TIMEOUT_MS = 1500;
  const SLOW_EVERY = 25; // slow properties are polled every Nth cycle
  const MISSING_RETRY = 200; // properties that returned 404 are retried every Nth cycle

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class HttpSource {
    constructor(o) {
      this.o = o;
      this.running = false;
      this.stamps = []; // timestamps of completed cycles, for rate estimate
      this.missing = new Set();
    }

    start() {
      this.running = true;
      this.o.onStatus({ mode: 'connecting', message: 'Connecting…' });
      this.loop();
    }

    stop() {
      this.running = false;
    }

    url(path) {
      return `http://${this.o.host}:${this.o.port}/json${path}`;
    }

    async fetchOne(prop) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(this.url(prop.path), { cache: 'no-store', signal: ctl.signal });
        if (!res.ok) return { prop, ok: false, net: false };
        const j = await res.json();
        const v = Number(j && typeof j === 'object' ? j.value : j);
        return Number.isFinite(v) ? { prop, ok: true, value: v } : { prop, ok: false, net: false };
      } catch (e) {
        return { prop, ok: false, net: true };
      } finally {
        clearTimeout(timer);
      }
    }

    async loop() {
      const interval = 1000 / Math.max(1, this.o.hz);
      let cycle = 0;
      while (this.running) {
        const t0 = performance.now();
        // A property the sim answered with 404 (aircraft doesn't have it) is retried only
        // rarely, instead of 20x per second (which also floods the browser console).
        const due = this.o.props.filter((p) => {
          if (this.missing.has(p.key)) return cycle % MISSING_RETRY === 0;
          return p.rate === 'fast' || cycle % SLOW_EVERY === 0;
        });
        cycle++;
        const results = await Promise.all(due.map((p) => this.fetchOne(p)));
        if (!this.running) return;

        const values = {};
        let netFail = 0;
        for (const r of results) {
          if (r.ok) {
            values[r.prop.key] = r.value;
            this.missing.delete(r.prop.key);
          } else {
            if (r.net) netFail++;
            else this.missing.add(r.prop.key);
          }
        }

        if (netFail === results.length) {
          this.stamps.length = 0;
          this.o.onStatus({
            mode: 'error',
            hz: 0,
            message: `No answer from ${this.o.host}:${this.o.port}`,
          });
          await sleep(1000); // back off while the sim is unreachable
          continue;
        }

        const now = performance.now();
        this.stamps.push(now);
        while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
        this.o.onValues(values);
        this.o.onStatus({
          mode: 'live',
          hz: this.stamps.length,
          missing: Array.from(this.missing),
          message: `${this.o.host}:${this.o.port}`,
        });

        await sleep(Math.max(0, interval - (performance.now() - t0)));
      }
    }
  }

  AP.data.HttpSource = HttpSource;
})(window);
