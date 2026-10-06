/**
 * Canvas symbols from the manual's "Creating New Symbol" chapter (8.3):
 * final glide, wind arrow + thermal assistant, zoom scale, GPS / battery
 * indicators, vario indicator and tape, side view, FLARM radar.
 * All functions draw on a 2D context in LCD logical pixels.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const D2R = Math.PI / 180;
  const clamp = LX.util.clamp;
  const F = 'Verdana, "DejaVu Sans", sans-serif';

  /** Outlined text (white with dark halo) – the unit draws map text this way. */
  function otext(c, str, x, y, size, opt) {
    opt = opt || {};
    c.font = `${opt.weight || 'bold'} ${size}px ${F}`;
    c.textAlign = opt.align || 'left';
    c.textBaseline = opt.base || 'alphabetic';
    c.lineWidth = Math.max(3, size / 5);
    c.lineJoin = 'round';
    c.strokeStyle = opt.halo || 'rgba(0,0,0,.9)';
    c.strokeText(str, x, y);
    c.fillStyle = opt.color || '#fff';
    c.fillText(str, x, y);
  }

  /* ------------------------------------------------------------ final glide */
  /**
   * Bottom number: predicted arrival altitude (+ above / - below final glide).
   * Middle: MacCready, prefixed T (task) / S / A / G / U ...
   * Chevrons: position relative to the glide path, one per 5 %.
   */
  function finalGlide(c, x, y, nav, mc, prefix, climb) {
    const h = 130, w = 62;
    c.save();
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(x, y, w, h);
    const arr = nav ? nav.arrival : NaN;
    const pct = nav ? nav.pct : 0;
    // chevrons (up when above the glide path, down when below)
    const n = Math.min(10, Math.round(Math.abs(pct) / 5));
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const cy = pct >= 0 ? y + h / 2 - 8 - i * 6 : y + h / 2 + 8 + i * 6;
      const dir = pct >= 0 ? 1 : -1;
      c.beginPath();
      c.moveTo(x + w - 20, cy + 3 * dir); c.lineTo(x + w - 11, cy - 3 * dir); c.lineTo(x + w - 2, cy + 3 * dir);
      c.stroke();
    }
    const a = LX.units.alt(arr);
    otext(c, Number.isFinite(arr) ? LX.fmt.signed(a, 0) : '---', x + w / 2 - 2, y + h - 8, 22, { align: 'center' });
    otext(c, (prefix || '') + LX.fmt.num(LX.units.vario(mc), 1), x + w / 2 - 2, y + h / 2 + 8, 22, { align: 'center', color: '#ffe14a' });
    // terrain on the way: height to climb to clear it (yellow, above the Mc value)
    if (climb > 0) otext(c, LX.fmt.num(LX.units.alt(climb), 0), x + w / 2 - 2, y + h / 2 - 16, 20, { align: 'center', color: '#ffd400' });
    c.restore();
  }

  /* ---------------------------------------------- wind arrow + thermal assist */
  /**
   * Wind arrow (black = combined/average wind). While circling, a ring of dots
   * shows the lift sampled at each heading: dot size = strength, colour from
   * the MacCready setting (red above, yellow about equal, blue below), the black
   * dot is the strongest sector, the small plane marks the glider's position.
   */
  function windThermal(c, cx, cy, r, f, bins, mc, up) {
    c.save();
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();

    // thermal assistant ring
    if (f.circling && bins) {
      let max = -9, maxI = -1, min = 9;
      bins.forEach((v, i) => { if (v !== null) { if (v > max) { max = v; maxI = i; } if (v < min) min = v; } });
      bins.forEach((v, i) => {
        if (v === null) return;
        const ang = (i * 15 + 7.5 - up) * D2R; // compass sector -> screen angle
        const px = cx + Math.sin(ang) * (r - 8), py = cy - Math.cos(ang) * (r - 8);
        const size = clamp(2 + (v - min) / Math.max(0.5, max - min) * 5, 2, 7);
        c.fillStyle = i === maxI ? '#000' : v > mc + 0.3 ? '#ff3b30' : v < mc - 0.3 ? '#2f7bff' : '#ffd400';
        c.beginPath(); c.arc(px, py, size, 0, Math.PI * 2); c.fill();
      });
      // glider marker on the ring
      const a = (f.track - up) * D2R;
      c.save(); c.translate(cx + Math.sin(a) * (r - 8), cy - Math.cos(a) * (r - 8)); c.rotate(a + Math.PI / 2);
      c.fillStyle = '#000'; c.fillRect(-7, -1.5, 14, 3); c.fillRect(-1.5, -6, 3, 12);
      c.restore();
    }

    // wind arrow: points toward where the wind blows
    if (f.windSpd > 0.3) {
      const to = (f.windDir + 180 - up) * D2R;
      const len = clamp(10 + f.windSpd * 2.4, 14, r - 14);
      c.save(); c.translate(cx, cy); c.rotate(to);
      c.strokeStyle = '#000'; c.fillStyle = '#000'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, len * 0.55); c.lineTo(0, -len * 0.55); c.stroke();
      c.beginPath(); c.moveTo(0, -len * 0.85); c.lineTo(7, -len * 0.35); c.lineTo(-7, -len * 0.35); c.closePath(); c.fill();
      c.restore();
    }
    otext(c, `${Math.round(f.windDir)}°/${Math.round(LX.units.speed(f.windSpd))}`, cx, cy + r + 15, 13, { align: 'center' });
    c.restore();
  }

  /* ----------------------------------------------------------- zoom, gps, battery */
  function zoomScale(c, x, y, scaleKm, mppPx) {
    const w = (scaleKm * 1000) / mppPx;
    c.save();
    c.strokeStyle = '#000'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - w, y); c.lineTo(x, y); c.moveTo(x - w, y - 5); c.lineTo(x - w, y + 5); c.moveTo(x, y - 5); c.lineTo(x, y + 5); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x - w, y); c.lineTo(x, y); c.stroke();
    otext(c, LX.fmt.num(LX.units.dist(scaleKm * 1000), scaleKm < 2 ? 1 : 0) + LX.units.label('dist'), x - w / 2, y - 8, 13, { align: 'center' });
    c.restore();
  }

  function northArrow(c, x, y, up) {
    c.save(); c.translate(x, y); c.rotate(-up * D2R);
    c.fillStyle = '#000'; c.strokeStyle = '#fff'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, -14); c.lineTo(8, 10); c.lineTo(0, 5); c.lineTo(-8, 10); c.closePath(); c.fill(); c.stroke();
    c.restore();
    otext(c, 'N', x + 12, y - 8, 12);
  }

  /* --------------------------------------------------------- vario indicator */
  /**
   * Round vario indicator (8.3.22): needle, red diamond = average climb, blue
   * arrow = MacCready, green T = last thermal average, mode icon.
   */
  function varioIndicator(c, cx, cy, r, f, o) {
    const range = o.range;
    const a0 = -120, a1 = 120; // degrees from 12 o'clock
    const ang = (v) => (clamp(v / range, -1, 1) * (a1 - a0)) / 2;
    c.save();
    c.fillStyle = '#05070a';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#565a62'; c.lineWidth = 3; c.stroke();
    // ticks every 0.5 range-fraction
    const step = range <= 2.5 ? 0.5 : 1;
    c.font = `bold ${Math.round(r / 7)}px ${F}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let v = -range; v <= range + 1e-6; v += step) {
      const a = ang(v) * D2R;
      const major = Math.abs(v - Math.round(v)) < 1e-6 && (range <= 5 || Math.round(v) % 2 === 0);
      const r0 = r - (major ? 16 : 10), r1 = r - 4;
      c.strokeStyle = v === 0 ? '#fff' : '#9aa0aa'; c.lineWidth = major ? 3 : 1.5;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); c.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); c.stroke();
      if (major) { c.fillStyle = '#fff'; c.fillText((v < 0 ? '\u2212' : '') + Math.abs(Math.round(LX.units.vario(v))), cx + Math.sin(a) * (r - 30), cy - Math.cos(a) * (r - 30)); }
    }
    // MacCready arrow (blue), last thermal avg (green T), average (red diamond)
    const mark = (v, draw) => { const a = ang(v) * D2R; c.save(); c.translate(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4)); c.rotate(a); draw(); c.restore(); };
    mark(o.mc, () => { c.fillStyle = '#3d8bff'; c.beginPath(); c.moveTo(0, 2); c.lineTo(-7, -12); c.lineTo(7, -12); c.fill(); });
    if (o.thermalAvg != null) mark(o.thermalAvg, () => { c.fillStyle = '#29d35a'; c.fillRect(-7, -14, 14, 4); c.fillRect(-2, -14, 4, 14); });
    mark(o.avg, () => { c.fillStyle = '#ff3b30'; c.beginPath(); c.moveTo(0, 0); c.lineTo(6, -7); c.lineTo(0, -14); c.lineTo(-6, -7); c.fill(); });
    // needle
    const na = ang(o.value) * D2R;
    c.save(); c.translate(cx, cy); c.rotate(na);
    c.fillStyle = '#ff9a1f'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -(r - 26)); c.lineTo(6, 6); c.lineTo(-6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.fillStyle = '#222'; c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fill();
    // mode icon: circular arrow = vario (climb), rising line = speed command
    c.strokeStyle = '#fff'; c.lineWidth = 3;
    const ix = cx + r * 0.55, iy = cy + r * 0.62;
    if (f.mode === 'vario') { c.beginPath(); c.arc(ix, iy, 11, 0.4, 5.6); c.stroke(); c.beginPath(); c.moveTo(ix + 8, iy - 8); c.lineTo(ix + 14, iy - 2); c.lineTo(ix + 5, iy - 1); c.stroke(); }
    else { c.beginPath(); c.moveTo(ix - 12, iy + 8); c.lineTo(ix + 12, iy - 8); c.stroke(); }
    // digital value
    c.fillStyle = '#fff'; c.font = `bold ${Math.round(r / 3.2)}px ${F}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(LX.fmt.signed(LX.units.vario(o.value), LX.fmt.varioDigits()), cx, cy + r * 0.38);
    c.font = `${Math.round(r / 8)}px ${F}`; c.fillStyle = '#9aa0aa';
    c.fillText(LX.units.label('vario'), cx, cy + r * 0.62);
    c.restore();
  }

  /** Vertical vario tape (8.3.16). */
  function varioTape(c, x, y, w, h, value, range) {
    c.save();
    c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#6a6e76'; c.strokeRect(x + .5, y + .5, w - 1, h - 1);
    const mid = y + h / 2, ppu = (h / 2 - 8) / range;
    c.font = `${Math.round(w / 3.4)}px ${F}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    for (let v = -range; v <= range; v += range <= 2.5 ? 0.5 : 1) {
      const yy = mid - v * ppu;
      c.strokeStyle = '#aaa'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + w - 10, yy); c.lineTo(x + w, yy); c.stroke();
      if (Math.abs(v - Math.round(v)) < 1e-6) c.fillText(String(Math.abs(Math.round(v))), x + 4, yy);
    }
    // value box
    const vy = mid - clamp(value, -range, range) * ppu;
    c.fillStyle = '#000'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + w, vy); c.lineTo(x + w - 14, vy - 12); c.lineTo(x + 2, vy - 12); c.lineTo(x + 2, vy + 12); c.lineTo(x + w - 14, vy + 12); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = `bold ${Math.round(w / 3)}px ${F}`; c.textAlign = 'center';
    c.fillText(LX.fmt.num(value, 1), x + w / 2 - 6, vy);
    c.restore();
  }

  /* ---------------------------------------------------------------- side view */
  /**
   * Lateral view toward the target (8.3.9): terrain, projected track (grey, from
   * the current glide ratio), required glide for Mc 0 (yellow) and for the
   * current Mc (magenta). Safety altitude is included in the lines.
   */
  function sideView(c, x, y, w, h, f, nav, terrainFn, safety) {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = '#143e78'; c.fillRect(x, y, w, h);
    const dmax = Math.max(5000, nav ? nav.dist * 1.05 : 30000);
    const hmax = Math.max(f.alt + 600, 1500), hmin = 0;
    const X = (d) => x + 34 + (d / dmax) * (w - 40);
    const Y = (a) => y + h - 14 - ((a - hmin) / (hmax - hmin)) * (h - 26);
    // grid + labels
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.font = `10px ${F}`; c.fillStyle = '#fff'; c.textAlign = 'left';
    for (let a = 500; a < hmax; a += 500) { c.beginPath(); c.moveTo(x + 30, Y(a)); c.lineTo(x + w, Y(a)); c.stroke(); c.fillText(Math.round(LX.units.alt(a)) + LX.units.label('alt'), x + 2, Y(a) + 3); }
    // terrain
    c.fillStyle = '#7a4a20';
    c.beginPath(); c.moveTo(X(0), Y(0));
    for (let i = 0; i <= 60; i++) { const d = (dmax * i) / 60; c.lineTo(X(d), Y(terrainFn(d))); }
    c.lineTo(X(dmax), Y(0)); c.closePath(); c.fill();
    c.strokeStyle = '#d2a56a'; c.stroke();
    // projected track + required glides
    const ratioNow = isFinite(f.glideRatioNow) && f.glideRatioNow > 0 ? Math.min(f.glideRatioNow, 60) : 35;
    const line = (ratio, col, off) => {
      c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(0), Y(f.alt - (off || 0)));
      c.lineTo(X(dmax), Y(f.alt - (off || 0) - dmax / ratio)); c.stroke();
    };
    line(ratioNow, '#bdbdbd', 0);
    if (nav) {
      const elev = nav.target.elev || 0;
      // from the target (+safety) back to us at the required ratio
      const fromTarget = (ratio, col) => {
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath();
        c.moveTo(X(nav.dist), Y(elev + safety)); c.lineTo(X(0), Y(elev + safety + nav.dist / Math.max(1, ratio))); c.stroke();
      };
      fromTarget(nav.Emc0, '#ffd400');
      fromTarget(nav.Emc, '#ff2fd5');
    }
    // glider
    c.fillStyle = '#fff'; c.beginPath(); c.arc(X(0), Y(f.alt), 4, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /* ------------------------------------------------------------------- FLARM */
  /**
   * FLARM radar (8.3.12): rings at 2 and 5 km (scaled), ownship centre, targets
   * as arrows (colour = threat, relative-altitude arrow).
   */
  /** Manual 7.1.7.9: colour by height relative to us – above (>100 m), below (>100 m) or near. */
  const flarmColor = (t) => (t.dh > 100 ? '#ff7a45' : t.dh < -100 ? '#4fd37a' : '#ffffff');
  /** Lost signal: the symbol blinks until it times out (default 120 s). */
  const flarmVisible = (t) => !t.lostFor || Math.floor(performance.now() / 400) % 2 === 0;
  function flarmSymbol(c, t, size, rot) {
    if (!flarmVisible(t)) return;
    c.save(); c.rotate(t.track * D2R - rot);
    const k = size / 11;
    c.fillStyle = flarmColor(t); c.strokeStyle = '#000'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(0, -11 * k); c.lineTo(8 * k, 8 * k); c.lineTo(0, 4 * k); c.lineTo(-8 * k, 8 * k); c.closePath(); c.fill(); c.stroke();
    c.restore();
    if (t.alarm >= 1) { c.strokeStyle = t.alarm >= 3 ? '#ff3b30' : '#ffd400'; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 15 * size / 11, 0, Math.PI * 2); c.stroke(); }
  }

  function flarmRadar(c, cx, cy, r, f, targets, up, range, extra) {
    range = range || 5000;
    extra = extra || {};
    c.save();
    c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#2d7a3f'; c.lineWidth = 1.5;
    [1, 0.5].forEach((k) => { c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke(); });
    c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
    c.fillStyle = '#9aa0aa'; c.font = `11px ${F}`; c.textAlign = 'left';
    c.fillText(LX.fmt.num(LX.units.dist(range), 1) + LX.units.label('dist'), cx + 4, cy - r + 12);
    c.fillText(LX.fmt.num(LX.units.dist(range / 2), 1) + LX.units.label('dist'), cx + 4, cy - r / 2 + 12);
    // MacCready glide slopes (manual 8.3.12): grey rings at the distance where the glider has lost 100/200/300 m
    if (extra.ld > 1) {
      c.strokeStyle = 'rgba(150,155,165,.55)'; c.lineWidth = 1; c.setLineDash([2, 4]); c.fillStyle = 'rgba(170,175,185,.8)'; c.font = `10px ${F}`;
      [100, 200, 300, 500].forEach((h) => {
        const rr = (extra.ld * h / range) * r; if (rr < 12 || rr > r) return;
        c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.stroke();
        c.fillText('-' + Math.round(LX.units.alt(h)), cx - 10, cy + rr - 2);
      });
      c.setLineDash([]);
    }
    // PCAS contacts: only a distance is known, so a dotted circle at that range (manual 7.1.7.9)
    (extra.pcas || []).forEach((p) => {
      const rr = Math.min(1, p.dist / range) * r; if (p.dist > range) return;
      c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.setLineDash([3, 5]); c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      otext(c, (p.dh >= 0 ? '+' : '−') + Math.round(Math.abs(LX.units.alt(p.dh)) / 10) * 10, cx + rr * 0.7071 + 4, cy - rr * 0.7071, 11);
    });
    // ownship
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx, cy - 10); c.lineTo(cx, cy + 10); c.moveTo(cx - 12, cy); c.lineTo(cx + 12, cy); c.stroke();
    (targets || []).forEach((t) => {
      const px = cx + Math.max(-1, Math.min(1, t.e / range)) * r * 0.97, py = cy - Math.max(-1, Math.min(1, t.n / range)) * r * 0.97;
      const rot = up === 'north' ? 0 : 0;
      c.save(); c.translate(px, py); flarmSymbol(c, t, 11, (f.track || 0) * D2R + rot); c.restore();
      otext(c, (t.dh >= 0 ? '+' : '−') + Math.round(Math.abs(LX.units.alt(t.dh)) / 10) * 10 + (t.vs > 0.5 ? '↑' : t.vs < -0.5 ? '↓' : ''), px + 10, py + 4, 11);
    });
    c.restore();
  }

  /* --------------------------------------------------------- gps + battery */
  function gpsBars(c, x, y, n) {
    c.save();
    c.fillStyle = n >= 8 ? '#29d35a' : n >= 4 ? '#ffd400' : '#ff3b30';
    for (let i = 0; i < 5; i++) {
      const on = i < Math.ceil(n / 2);
      c.globalAlpha = on ? 1 : 0.25;
      c.fillRect(x + i * 6, y + 14 - (4 + i * 2.5), 4, 4 + i * 2.5);
    }
    c.restore();
  }

  LX.symbols = { otext, finalGlide, windThermal, zoomScale, northArrow, varioIndicator, varioTape, sideView, flarmRadar, flarmSymbol, flarmColor, gpsBars };
})(window);
