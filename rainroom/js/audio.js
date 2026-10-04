/* Rainroom audio engine. Every sound is synthesized live with the Web Audio API; there are no samples. */
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };

  function noiseBuffer(ctx, seconds, color) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'white') d[i] = w;
        else if (color === 'pink') { // Paul Kellet's filter
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // Ease the tail into the first sample so the loop point doesn't click
      const n = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < n; i++) { const t = i / n; d[len - n + i] = d[len - n + i] * (1 - t) + d[0] * t; }
    }
    return buf;
  }

  function impulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // Dmaj9 → Bm9 → Gmaj9(6) → Em9, slow and open
  const CHORDS = [
    [50, 57, 61, 64, 66],
    [47, 54, 57, 61, 62],
    [43, 50, 54, 57, 59],
    [52, 55, 59, 62, 66],
  ];
  const SCALE = [74, 76, 78, 81, 83, 86, 88, 90]; // D major pentatonic, upper register
  const BPM = 66;

  class RainAudio {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.levels = { rain: 0.55, thunder: 0.15, music: 0.5, wind: 0.18, volume: 0.8 };
      this.onStrike = null;
    }

    gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    filter(type, freq, q = 0.7) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
    pan(v) {
      if (!this.ctx.createStereoPanner) return this.gain(1);
      const p = this.ctx.createStereoPanner(); p.pan.value = v; return p;
    }
    loop(buffer) {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer; s.loop = true;
      s.start(0, Math.random() * buffer.duration);
      return s;
    }
    ramp(param, v, tc = 0.35) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC({ latencyHint: 'playback' });
      // Lets iOS play through the silent switch where supported
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }

      this.out = this.gain(0);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3;
      comp.attack.value = 0.01; comp.release.value = 0.4;
      chain(this.out, comp, ctx.destination);

      this.verb = ctx.createConvolver();
      this.verb.buffer = impulse(ctx, 4.5, 2.8);
      chain(this.verb, this.gain(0.5), this.out);

      this.noise = {
        white: noiseBuffer(ctx, 3, 'white'),
        pink: noiseBuffer(ctx, 6, 'pink'),
        brown: noiseBuffer(ctx, 8, 'brown'),
      };

      const sends = { rain: 0.12, thunder: 0.6, music: 0.55, wind: 0.1 };
      this.bus = {};
      for (const k of Object.keys(sends)) {
        const g = this.bus[k] = this.gain(0);
        g.connect(this.out);
        chain(g, this.gain(sends[k]), this.verb);
      }
      this.chimeBus = this.gain(0.6);
      this.chimeBus.connect(this.out);
      chain(this.chimeBus, this.gain(0.5), this.verb);

      this.buildRain();
      this.buildWind();
      this.buildMusic();
      this.applyLevels();
    }

    /* ---------- rain ---------- */
    buildRain() {
      this.rainHP = this.filter('highpass', 450);
      this.rainLP = this.filter('lowpass', 6000);
      this.rainHiss = this.gain(0);
      chain(this.loop(this.noise.pink), this.rainHP, this.rainLP, this.rainHiss, this.bus.rain);

      this.rainBodyLP = this.filter('lowpass', 500);
      this.rainBody = this.gain(0);
      chain(this.loop(this.noise.brown), this.rainBodyLP, this.rainBody, this.bus.rain);

      this.drops = this.gain(0.7);
      this.drops.connect(this.bus.rain);
      this.nextDrop = 0;
    }

    applyRain() {
      const v = this.levels.rain;
      this.ramp(this.bus.rain.gain, v > 0.001 ? 0.35 + 0.65 * v : 0, 0.6);
      this.ramp(this.rainHiss.gain, 0.12 + 0.55 * v, 0.6);
      this.ramp(this.rainBody.gain, 0.05 + 0.9 * v * v, 0.6);
      this.ramp(this.rainLP.frequency, 3000 + 7000 * v, 0.6);
      this.ramp(this.rainBodyLP.frequency, 300 + 700 * v, 0.6);
    }

    drop(t) {
      const ctx = this.ctx;
      const g = this.gain(0);
      const p = this.pan(rand(-0.9, 0.9));
      if (Math.random() < 0.16) {
        // Drop hitting a puddle: a short upward-chirping bubble
        const o = ctx.createOscillator();
        const f = rand(900, 3200);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.04);
        const peak = rand(0.02, 0.07);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.04, 0.09));
        chain(o, g, p, this.drops);
        o.start(t); o.stop(t + 0.12);
      } else {
        // Drop hitting a leaf or roof: a filtered noise tick
        const src = ctx.createBufferSource();
        src.buffer = this.noise.white;
        const bp = this.filter('bandpass', rand(1500, 7000), rand(2, 12));
        const peak = rand(0.05, 0.4);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.015, 0.06));
        chain(src, bp, g, p, this.drops);
        src.start(t, rand(0, 2.5), 0.08);
      }
    }

    /* ---------- wind ---------- */
    buildWind() {
      this.windBP = this.filter('bandpass', 500, 0.9);
      this.windGust = this.gain(0.6);
      chain(this.loop(this.noise.pink), this.windBP, this.filter('lowpass', 1600), this.windGust, this.bus.wind);
      this.windWhistle = this.filter('bandpass', 1200, 9);
      chain(this.loop(this.noise.white), this.windWhistle, this.gain(0.05), this.windGust);
      this.nextGust = 0;
    }

    gust(now) {
      const w = this.levels.wind;
      this.windBP.frequency.setTargetAtTime(rand(250, 500 + 600 * w), now, 1.6);
      this.windWhistle.frequency.setTargetAtTime(rand(700, 1600), now, 2);
      this.windGust.gain.setTargetAtTime(rand(0.25, 1), now, rand(1.2, 2.5));
      this.nextGust = now + rand(2, 5);
    }

    /* ---------- thunder ---------- */
    strike(distance) {
      if (!this.ctx) return null;
      const now = this.ctx.currentTime;
      const t = this.levels.thunder;
      if (distance == null) distance = 0.3 + Math.pow(Math.random(), 0.8 + t * 1.6) * 5.7;
      const delay = distance * 2.9; // sound covers a kilometre in about 2.9 s
      this.thunder(now + delay, distance);
      this.nextStrike = now + delay + (9 + (1 - t) * 66) * rand(0.5, 1.5);
      if (this.onStrike) this.onStrike({ distance, delay });
      return { distance, delay };
    }

    thunder(t0, distance) {
      const ctx = this.ctx;
      const near = clamp(1 - distance / 6, 0, 1);
      const dur = rand(6, 11) + (1 - near) * 4;

      const src = ctx.createBufferSource();
      src.buffer = this.noise.brown; src.loop = true;
      const lp = this.filter('lowpass', 140, 0.9);
      lp.frequency.setValueAtTime(140 + 900 * near * near, t0);
      lp.frequency.exponentialRampToValueAtTime(70, t0 + dur);

      // Rolling envelope: an attack, then a few dips and swells as echoes arrive
      const g = this.gain(0);
      const peak = 0.35 + 0.75 * near;
      const attack = 0.04 + (1 - near) * 0.9;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      let tt = t0 + attack;
      const rolls = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < rolls; i++) {
        tt += rand(0.4, 1.6);
        g.gain.exponentialRampToValueAtTime(peak * rand(0.2, 0.45), tt);
        tt += rand(0.15, 0.6);
        g.gain.exponentialRampToValueAtTime(peak * rand(0.5, 0.95) * (1 - i / (rolls + 1)), tt);
      }
      const end = Math.max(tt + 2.5, t0 + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      chain(src, lp, g, this.pan(rand(-0.5, 0.5)), this.bus.thunder);
      src.start(t0, rand(0, 7));
      src.stop(end + 0.1);

      if (near > 0.75) this.crack(t0, near);
    }

    crack(t0, near) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise.white;
      const g = this.gain(0);
      const amp = 0.5 * near;
      g.gain.setValueAtTime(0.0001, t0);
      let t = t0;
      for (let i = 0; i < 3; i++) {
        g.gain.exponentialRampToValueAtTime(amp * (1 - i * 0.25), t + 0.008);
        t += rand(0.05, 0.12);
        g.gain.exponentialRampToValueAtTime(amp * 0.08, t);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      chain(src, this.filter('highpass', 700), g, this.bus.thunder);
      src.start(t0, rand(0, 2));
      src.stop(t + 0.8);

      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(70, t0);
      osc.frequency.exponentialRampToValueAtTime(32, t0 + 1.8);
      const og = this.gain(0);
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.6 * near, t0 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
      chain(osc, og, this.bus.thunder);
      osc.start(t0); osc.stop(t0 + 2.3);
    }

    /* ---------- music ---------- */
    buildMusic() {
      const ctx = this.ctx;
      this.padFilter = this.filter('lowpass', 1100, 0.6);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      chain(lfo, this.gain(450), this.padFilter.frequency);
      lfo.start();
      chain(this.padFilter, this.gain(0.9), this.bus.music);

      this.keys = this.gain(0.8);
      const keysLP = this.filter('lowpass', 2600);
      chain(this.keys, keysLP, this.bus.music);

      // Soft dotted-eighth echo on the keys
      const delay = ctx.createDelay(3);
      delay.delayTime.value = (60 / BPM) * 0.75;
      const dlp = this.filter('lowpass', 1800);
      keysLP.connect(delay);
      chain(delay, dlp, this.gain(0.38), delay);
      chain(dlp, this.gain(0.32), this.bus.music);

      this.beatIndex = 0;
      this.nextBeat = 0;
      this.melodyIdx = 2;
      this.padDue = true;
    }

    beat(t, i) {
      if (this.levels.music < 0.005) { this.padDue = true; return; }
      const spb = 60 / BPM;
      const chord = CHORDS[Math.floor(i / 8) % CHORDS.length];
      if (i % 8 === 0 || this.padDue) {
        this.padDue = false;
        this.chord(chord, t, (8 - (i % 8)) * spb);
      }
      if (Math.random() < (i % 4 === 0 ? 0.55 : 0.28)) {
        this.melodyIdx = clamp(this.melodyIdx + Math.round(rand(-2.4, 2.4)), 0, SCALE.length - 1);
        this.pluck(SCALE[this.melodyIdx], t + rand(0, 0.02), rand(0.08, 0.16));
        if (Math.random() < 0.18) {
          const j = clamp(this.melodyIdx + (Math.random() < 0.5 ? -1 : 1), 0, SCALE.length - 1);
          this.pluck(SCALE[j], t + spb / 2, rand(0.05, 0.1));
        }
      }
    }

    chord(notes, t, dur) {
      const ctx = this.ctx;
      for (const m of notes) {
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = midiHz(m);
          o.detune.value = det + rand(-3, 3);
          const g = this.gain(0);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.028, t + 2.2);
          g.gain.setValueAtTime(0.028, t + dur);
          g.gain.linearRampToValueAtTime(0, t + dur + 3.5);
          chain(o, g, this.padFilter);
          o.start(t); o.stop(t + dur + 3.6);
        }
      }
      const bass = ctx.createOscillator();
      bass.frequency.value = midiHz(notes[0] - 12);
      const bg = this.gain(0);
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(0.13, t + 1.5);
      bg.gain.setValueAtTime(0.13, t + dur);
      bg.gain.linearRampToValueAtTime(0, t + dur + 2);
      chain(bass, bg, this.bus.music);
      bass.start(t); bass.stop(t + dur + 2.1);
    }

    pluck(m, t, vel, dest = this.keys) {
      const ctx = this.ctx;
      const f = midiHz(m);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.006);
      g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      g.connect(dest);
      const partials = [[1, 'sine', 1], [2, 'triangle', 0.22], [3.01, 'sine', 0.06]];
      for (const [mul, type, amp] of partials) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mul;
        chain(o, this.gain(amp), g);
        o.start(t); o.stop(t + 3.3);
      }
    }

    chime() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.05;
      [74, 78, 81, 86].forEach((m, i) => this.pluck(m, t + i * 0.32, 0.2, this.chimeBus));
    }

    /* ---------- control ---------- */
    setLevel(name, v) {
      const prev = this.levels[name];
      this.levels[name] = v;
      if (!this.ctx) return;
      if (name === 'thunder' && prev <= 0.01 && v > 0.01) this.nextStrike = this.ctx.currentTime + rand(4, 10);
      this.applyLevels();
    }

    applyLevels() {
      const L = this.levels;
      this.applyRain();
      this.ramp(this.bus.thunder.gain, L.thunder > 0.001 ? 0.45 + 0.55 * L.thunder : 0);
      this.ramp(this.bus.music.gain, L.music * 0.9, 0.5);
      this.ramp(this.bus.wind.gain, L.wind * 1.3, 0.6);
      if (this.playing) this.ramp(this.out.gain, L.volume * L.volume, 0.25);
    }

    tick() {
      const now = this.ctx.currentTime;
      // Background tabs throttle timers to ~1 s, so schedule further ahead there
      const ahead = now + (document.hidden ? 1.6 : 0.3);

      const v = this.levels.rain;
      const rate = v > 0.001 ? 6 + 110 * Math.pow(v, 1.3) : 0;
      if (rate > 0) {
        if (this.nextDrop < now) this.nextDrop = now;
        while (this.nextDrop < ahead) {
          this.drop(this.nextDrop);
          this.nextDrop += -Math.log(1 - Math.random()) / rate; // Poisson arrivals
        }
      }

      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      while (this.nextBeat < ahead) {
        this.beat(this.nextBeat, this.beatIndex++);
        this.nextBeat += 60 / BPM;
      }

      if (now > this.nextGust) this.gust(now);
      if (this.levels.thunder > 0.01 && now > this.nextStrike) this.strike();
    }

    async play() {
      if (!this.ctx) this.init();
      const resumed = this.ctx.resume();
      this.playing = true;
      clearTimeout(this.suspendTimer);
      await resumed;
      const now = this.ctx.currentTime;
      this.nextDrop = now;
      this.nextBeat = now + 0.1;
      this.padDue = true;
      this.nextGust = now;
      if (!this.nextStrike || this.nextStrike < now) this.nextStrike = now + rand(6, 14);
      this.out.gain.setTargetAtTime(this.levels.volume * this.levels.volume, now, 0.9);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 60);
      this.tick();
    }

    pause() {
      this.playing = false;
      clearInterval(this.timer);
      if (!this.ctx) return;
      this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.35);
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => { if (!this.playing) this.ctx.suspend(); }, 2000);
    }
  }

  window.RainAudio = RainAudio;
})();
