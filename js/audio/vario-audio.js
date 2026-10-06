/**
 * Vario audio – real-time synthesis with the Web Audio API.
 *
 * Mode names and behaviour follow the LX90xx/80xx user manual (Setup > Sounds
 * > Audio Settings):
 *
 *   Vario audio mode
 *     Linear positive       beeps (sound interrupted by silence) while the
 *                           needle is positive; continuous tone when negative
 *     Linear negative       inverse of Linear positive
 *     Linear                continuous, linear tone over the full range
 *     Digital positive      like Linear positive but frequency moves in steps
 *     Digital negative      inverse of Digital positive
 *     Linear positive only  sound only for positive values, silence otherwise
 *     Digital positive only like the above with stepped frequency
 *   SC (speed command) audio mode
 *     SC positive / SC negative / SC   same shapes driven by the speed-to-fly
 *                                      value
 *     SC mixed    positive relative (netto) values sound as vario, negative
 *                 relative values sound as SC
 *     Relative / Netto / Vario         beep as vario mode using that value
 *
 *   Frequency map (manual defaults): 500 Hz at 0, 1500 Hz at +100 % of the
 *   vario range, 200 Hz at -100 %.
 *
 * Details the manual does not give (beep cadence, duty cycle, the stepping of
 * the digital modes, the SC value scale) are my approximations; they are
 * collected in `tone()` so they are easy to tune against the real unit.
 *
 * `tone()` is a pure function so it can be unit-tested without audio.
 */
(function (global) {
  'use strict';
  const LX = global.LX;
  const clamp = LX.util.clamp;

  const DIGITAL_STEPS = 10; // frequency steps across the full range

  /**
   * @param mode   audio mode name (see above), for SC modes pass the already
   *               resolved shape: 'positive' | 'negative' | 'linear' | ... via shapeOf()
   * @param x      normalised value -1..+1 (value / full-scale range)
   * @param p      { f0, fPlus, fMinus }
   * @returns { silent, freq, beeping, period, duty }
   */
  function tone(shape, x, p) {
    x = clamp(x, -1, 1);
    const DEAD = 0.02; // below 2 % of full scale: silence-ish at the centre
    const digital = shape.digital;
    let xf = x;
    if (digital) xf = Math.round(x * DIGITAL_STEPS) / DIGITAL_STEPS;
    const freq = xf >= 0 ? p.f0 + xf * (p.fPlus - p.f0) : p.f0 + -xf * (p.fMinus - p.f0);

    const positive = x > DEAD;
    const negative = x < -DEAD;
    if (!positive && !negative) return { silent: true, freq, beeping: false, period: 1, duty: 0 };

    // which side is interrupted (beeps), which is continuous, which is silent
    let side = 'continuous';
    if (shape.kind === 'positive') side = positive ? 'beep' : 'continuous';
    else if (shape.kind === 'negative') side = negative ? 'beep' : 'continuous';
    else if (shape.kind === 'positive-only') side = positive ? 'beep' : 'silent';
    else if (shape.kind === 'linear') side = 'continuous';

    if (side === 'silent') return { silent: true, freq, beeping: false, period: 1, duty: 0 };
    if (side === 'continuous') return { silent: false, freq, beeping: false, period: 1, duty: 1 };

    // beep cadence: 1.0 s per beep just above zero, 0.16 s at full scale
    const m = Math.abs(x);
    const period = 1.0 - 0.84 * Math.pow(m, 0.8);
    return { silent: false, freq, beeping: true, period, duty: 0.5 };
  }

  const VARIO_SHAPES = {
    'Linear positive': { kind: 'positive' },
    'Linear negative': { kind: 'negative' },
    'Linear': { kind: 'linear' },
    'Digital positive': { kind: 'positive', digital: true },
    'Digital negative': { kind: 'negative', digital: true },
    'Linear positive only': { kind: 'positive-only' },
    'Digital positive only': { kind: 'positive-only', digital: true },
  };
  const SC_SHAPES = {
    'SC positive': { kind: 'positive' },
    'SC negative': { kind: 'negative' },
    'SC': { kind: 'linear' },
  };

  /**
   * Decide what the speaker should do now.
   * Returns { silent, freq, beeping, period, duty, vol } using the current
   * flight state `f` and settings `s`.
   */
  function resolve(f, s) {
    const range = s.varioRange || 5;
    const p = { f0: s.freq0, fPlus: s.freqPlus, fMinus: s.freqMinus };
    const varioShape = VARIO_SHAPES[s.audioMode] || VARIO_SHAPES['Linear positive'];

    // SC value (m/s equivalent): +1 m/s of needle ~ 10 km/h too slow.
    // Positive = slower than speed-to-fly. (Approximation – see header.)
    const sc = (f.stf - f.ias) * 3.6 / 10;
    const dead = s.scBand || 1;

    if (f.mode === 'vario') {
      const t = tone(varioShape, f.teSound / range, p);
      t.vol = s.volVario;
      return t;
    }

    // cruise / speed-to-fly
    let value, shape = VARIO_SHAPES['Linear positive'];
    const mode = s.scAudioMode || 'SC mixed';
    if (mode === 'Vario') value = f.teSound;
    else if (mode === 'Netto') value = f.netto;
    else if (mode === 'Relative') value = f.relative;
    else if (mode === 'SC mixed') {
      if (f.relative > 0.1) value = f.relative; // lift: sound the air
      else { value = sc; shape = SC_SHAPES['SC positive']; }
    } else { value = sc; shape = SC_SHAPES[mode] || SC_SHAPES['SC positive']; }

    if (shape !== VARIO_SHAPES['Linear positive'] || mode === 'SC mixed') {
      // SC dead band applies to speed-command values only
      if (value === sc && Math.abs(sc) < dead) {
        return { silent: true, freq: s.freq0, beeping: false, period: 1, duty: 0, vol: s.volSC };
      }
    }
    const t = tone(shape, value / range, p);
    t.vol = s.volSC;
    return t;
  }

  /* ------------------------------------------------------------- audio engine */
  class VarioAudio {
    constructor(settings) {
      this.S = settings;
      this.ctx = null;
      this.provider = null; // () => flight.f
      this.enabled = false;
      this.beepEnd = 0; // audio-clock time the current beep ends
      this.nextBeep = 0;
      this.last = null;
    }

    /** Must run inside a user gesture (autoplay policy). */
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.osc = ctx.createOscillator();
      this.osc.type = 'triangle';
      this.lp = ctx.createBiquadFilter();
      this.lp.type = 'lowpass';
      this.lp.frequency.value = 3500;
      this.env = ctx.createGain();
      this.env.gain.value = 0;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.osc.connect(this.lp).connect(this.env).connect(this.master).connect(ctx.destination);
      this.osc.start();
      this.enabled = true;
      this.timer = setInterval(() => this.tick(), 20);
    }

    /** Warning tone while an airspace/FLARM/altitude warning is up: 'red' (fast, high) | 'orange' | null. */
    setAlarm(level) { this.alarm = level; }

    /** Audible check (the manual's DEMO button): rising then falling tones. */
    demo(shapeName, seconds) {
      this.demoUntil = performance.now() + (seconds || 4) * 1000;
      this.demoShape = shapeName;
    }

    tick() {
      const ctx = this.ctx;
      if (!ctx || !this.provider) return;
      const s = this.S.get();
      const f = this.provider();
      let t;
      if (this.demoUntil && performance.now() < this.demoUntil) {
        const ph = (this.demoUntil - performance.now()) / 4000;
        const val = Math.sin(ph * Math.PI * 2) * (s.varioRange || 5);
        t = tone(VARIO_SHAPES[this.demoShape] || VARIO_SHAPES['Linear positive'], val / (s.varioRange || 5),
          { f0: s.freq0, fPlus: s.freqPlus, fMinus: s.freqMinus });
        t.vol = s.volVario;
      } else if (this.alarm) {
        t = { silent: false, freq: this.alarm === 'red' ? 1100 : 800, beeping: true, period: this.alarm === 'red' ? 0.28 : 0.6, duty: 0.5, vol: s.volBeep };
      } else {
        if (!f || !f.valid) { this.env.gain.setTargetAtTime(0, ctx.currentTime, 0.01); return; }
        t = resolve(f, s);
      }
      const now = ctx.currentTime;
      const vol = s.mute ? 0 : Math.pow(clamp((t.vol || 0) / 100, 0, 1), 2);
      this.master.gain.setTargetAtTime(vol, now, 0.03);

      if (t.silent) { this.env.gain.setTargetAtTime(0, now, 0.01); this.nextBeep = now; return; }
      this.osc.frequency.setTargetAtTime(t.freq, now, 0.012);

      if (!t.beeping) {
        this.env.gain.setTargetAtTime(1, now, 0.01);
        this.nextBeep = now;
        return;
      }
      // beeping: schedule on/off gates a little ahead
      if (this.nextBeep < now) this.nextBeep = now;
      while (this.nextBeep < now + 0.06) {
        const on = this.nextBeep;
        const off = on + t.period * t.duty;
        this.env.gain.setTargetAtTime(1, on, 0.004);
        this.env.gain.setTargetAtTime(0, off, 0.006);
        this.nextBeep = on + t.period;
      }
    }
  }

  LX.audioTone = tone;
  LX.audioResolve = resolve;
  LX.VarioAudio = VarioAudio;
  LX.AUDIO_MODES = { vario: Object.keys(VARIO_SHAPES), sc: ['SC positive', 'SC negative', 'SC', 'SC mixed', 'Relative', 'Netto', 'Vario'] };
})(window);
