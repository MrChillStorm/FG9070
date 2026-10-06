/**
 * EXPERIMENTAL WebSocket source (FlightGear httpd "PropertyListener").
 *
 *   ws://HOST:PORT/PropertyListener
 *   -> {"command":"addListener","node":"/orientation/pitch-deg"}
 *   <- {"path":"/orientation/pitch-deg","value":3.2,...}   (pushed on change)
 *
 * Pushes values only when they change, so it is far lighter than polling, but
 * the protocol varies a little between FlightGear versions – if it misbehaves
 * switch Settings -> Transport back to "HTTP polling".
 *
 * The reported rate is messages per second (not full-panel refreshes).
 */
(function (global) {
  'use strict';
  const AP = global.AeroPanel;

  class WsSource {
    constructor(o) {
      this.o = o;
      this.running = false;
      this.ws = null;
      this.stamps = [];
      this.byPath = {};
      o.props.forEach((p) => (this.byPath[p.path] = p.key));
    }

    start() {
      this.running = true;
      this.connect();
    }

    stop() {
      this.running = false;
      if (this.ws) this.ws.close();
    }

    connect() {
      if (!this.running) return;
      this.o.onStatus({ mode: 'connecting', message: 'Connecting (WebSocket)…' });
      let ws;
      try {
        ws = new WebSocket(`ws://${this.o.host}:${this.o.port}/PropertyListener`);
      } catch (e) {
        this.retry();
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.o.props.forEach((p) => {
          ws.send(JSON.stringify({ command: 'addListener', node: p.path }));
          ws.send(JSON.stringify({ command: 'get', node: p.path })); // prime initial value
        });
        this.o.onStatus({ mode: 'live', hz: 0, message: `${this.o.host}:${this.o.port} (ws)` });
      };

      ws.onmessage = (ev) => {
        let msgs;
        try {
          msgs = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (!Array.isArray(msgs)) msgs = [msgs];
        const values = {};
        for (const m of msgs) {
          const key = this.byPath[m.path || m.node];
          const v = Number(m.value);
          if (key && Number.isFinite(v)) values[key] = v;
        }
        if (!Object.keys(values).length) return;
        const now = performance.now();
        this.stamps.push(now);
        while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
        this.o.onValues(values);
        this.o.onStatus({ mode: 'live', hz: this.stamps.length, unit: 'msg/s' });
      };

      ws.onclose = () => this.retry();
      ws.onerror = () => {
        this.o.onStatus({ mode: 'error', hz: 0, message: `WebSocket error ${this.o.host}:${this.o.port}` });
      };
    }

    retry() {
      if (!this.running) return;
      setTimeout(() => this.connect(), 2000);
    }
  }

  AP.data.WsSource = WsSource;
})(window);
