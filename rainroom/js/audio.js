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
      this.levels = { rain: 0.55, rainVol: 0.8, music: 0.5, volume: 0.8, thunder: 0.15, wind: 0.18, window: 0, mud: 0, traffic: 0, keyboard: 0 };
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

      const sends = { rain: 0.12, thunder: 0.6, music: 0.55, wind: 0.1, window: 0.08, mud: 0.15, traffic: 0.25, keyboard: 0.05 };
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
      this.buildAmbience();
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
      const L = this.levels;
      this.ramp(this.bus.rain.gain, v > 0.001 ? (0.35 + 0.65 * v) * L.rainVol * 1.25 : 0, 0.6);
      this.ramp(this.rainHiss.gain, 0.12 + 0.55 * v, 0.6);
      this.ramp(this.rainBody.gain, 0.05 + 0.9 * v * v, 0.6);
      // With the window layer up you're indoors, so the outside rain loses its top end
      this.ramp(this.rainLP.frequency, (3000 + 7000 * v) * (1 - 0.55 * L.window), 0.6);
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

    /* ---------- ambience: window, mud, traffic, keyboard ---------- */
    buildAmbience() {
      // Window: rain heard through glass, plus taps and drips on the pane
      this.winBodyLP = this.filter('lowpass', 700);
      this.winBody = this.gain(0);
      chain(this.loop(this.noise.pink), this.winBodyLP, this.winBody, this.bus.window);
      // Traffic: a constant low city rumble under the passing cars
      chain(this.loop(this.noise.brown), this.filter('lowpass', 160), this.gain(0.3), this.bus.traffic);
      this.nextTap = this.nextMud = this.nextCar = this.nextKey = 0;
      this.steps = 0;
      this.keysLeft = 0;
    }

    panTo(p, from, to, t0, t1) {
      if (!p.pan) return;
      p.pan.setValueAtTime(from, t0);
      p.pan.linearRampToValueAtTime(to, t1);
    }

    env(param, t, peak, attack, decay) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    noiseHit(t, buffer, nodes, peak, attack, decay, dest) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const g = this.gain(0);
      this.env(g.gain, t, peak, attack, decay);
      chain(src, ...nodes, g, dest);
      src.start(t, rand(0, buffer.duration - 0.5), attack + decay + 0.05);
    }

    tone(t, f0, f1, glide, peak, decay, dest, type = 'sine') {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + glide);
      const g = this.gain(0);
      this.env(g.gain, t, peak, 0.003, decay);
      chain(o, g, dest);
      o.start(t); o.stop(t + decay + 0.05);
    }

    windowTap(t) {
      const p = this.pan(rand(-0.8, 0.8));
      p.connect(this.bus.window);
      if (Math.random() < 0.18) {
        // a drip running off the frame
        const f = rand(450, 1000);
        this.tone(t, f, f * rand(1.3, 1.8), 0.05, rand(0.04, 0.1), rand(0.06, 0.12), p);
      } else {
        this.noiseHit(t, this.noise.white, [this.filter('highpass', 2200), this.filter('bandpass', rand(2800, 6500), 6)],
          rand(0.12, 0.4), 0.001, rand(0.02, 0.05), p);
        if (Math.random() < 0.3) this.tone(t, rand(4000, 6000), rand(3800, 5800), 0.03, 0.015, 0.04, p);
      }
    }

    squelch(t, step) {
      const d = rand(0.08, 0.2);
      const peak = step ? rand(0.35, 0.6) : rand(0.12, 0.3);
      const p = this.pan(rand(-0.6, 0.6));
      p.connect(this.bus.mud);
      const bp = this.filter('bandpass', 250, 3);
      bp.frequency.setValueAtTime(rand(200, 350), t);
      bp.frequency.exponentialRampToValueAtTime(rand(700, 1300), t + d);
      this.noiseHit(t, this.noise.pink, [bp, this.filter('lowpass', 2500)], peak, 0.015, d + 0.1, p);
      if (step) {
        // the boot pulling back out of the mud
        const t2 = t + rand(0.18, 0.28);
        const bp2 = this.filter('bandpass', 1000, 4);
        bp2.frequency.setValueAtTime(rand(900, 1300), t2);
        bp2.frequency.exponentialRampToValueAtTime(rand(250, 400), t2 + 0.12);
        this.noiseHit(t2, this.noise.pink, [bp2], peak * 0.6, 0.01, 0.14, p);
      }
    }

    mudPop(t) {
      const p = this.pan(rand(-0.7, 0.7));
      chain(p, this.filter('lowpass', 1500), this.bus.mud);
      const f = rand(110, 320);
      this.tone(t, f, f * rand(1.8, 2.6), rand(0.03, 0.07), rand(0.08, 0.2), 0.1, p);
    }

    car(t) {
      const ctx = this.ctx;
      this.nextCar = t + rand(3, 12) * (1.3 - this.levels.traffic);
      const dur = rand(4, 8);
      const mid = t + dur * rand(0.4, 0.6);
      const end = t + dur;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const peak = rand(0.25, 0.6);
      const p = this.pan(0);
      this.panTo(p, -0.85 * dir, 0.85 * dir, t, end);
      p.connect(this.bus.traffic);
      const shape = (param, amp) => {
        param.setValueAtTime(0.0001, t);
        param.exponentialRampToValueAtTime(amp, mid);
        param.exponentialRampToValueAtTime(0.0001, end);
      };

      // Road noise, its band sweeping up then down as the car approaches and leaves
      const road = ctx.createBufferSource();
      road.buffer = this.noise.pink; road.loop = true;
      const bp = this.filter('bandpass', 300, 0.8);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(rand(700, 1100), mid);
      bp.frequency.exponentialRampToValueAtTime(260, end);
      const g1 = this.gain(0); shape(g1.gain, peak);
      chain(road, bp, g1, p);
      road.start(t, rand(0, 5)); road.stop(end + 0.1);

      // Spray off wet tyres
      const spray = ctx.createBufferSource();
      spray.buffer = this.noise.white; spray.loop = true;
      const g2 = this.gain(0); shape(g2.gain, peak * 0.3);
      chain(spray, this.filter('highpass', 2200), this.filter('lowpass', 6000), g2, p);
      spray.start(t, rand(0, 2)); spray.stop(end + 0.1);

      // Engine hum with a slight Doppler drop
      const eng = ctx.createOscillator();
      eng.type = 'sawtooth';
      const f = rand(55, 85);
      eng.frequency.setValueAtTime(f * 1.04, t);
      eng.frequency.linearRampToValueAtTime(f * 0.95, end);
      const g3 = this.gain(0); shape(g3.gain, peak * 0.22);
      chain(eng, this.filter('lowpass', 180), g3, p);
      eng.start(t); eng.stop(end + 0.1);
    }

    keystroke(t, big) {
      const p = this.pan(rand(-0.25, 0.25));
      p.connect(this.bus.keyboard);
      const peak = rand(0.18, 0.3);
      this.noiseHit(t, this.noise.white, [this.filter('bandpass', rand(2200, 4200), 1.2)], peak, 0.001, rand(0.02, 0.035), p);
      const f = big ? rand(110, 140) : rand(170, 260);
      this.tone(t, f, f * 0.9, 0.04, rand(0.15, 0.25), 0.05, p);
      // softer click as the key comes back up
      this.noiseHit(t + rand(0.07, 0.11), this.noise.white, [this.filter('bandpass', rand(3000, 5000), 1.5)], peak * 0.3, 0.001, 0.02, p);
    }

    click() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime + 0.01;
      this.noiseHit(t, this.noise.white, [this.filter('bandpass', 3200, 2)], 0.3, 0.001, 0.025, this.chimeBus);
      this.tone(t, 240, 200, 0.03, 0.2, 0.05, this.chimeBus);
    }

    tickAmbience(now, ahead) {
      const L = this.levels;
      if (L.window > 0.005) {
        const rate = 3 + 28 * Math.max(L.rain, 0.1);
        if (this.nextTap < now) this.nextTap = now;
        while (this.nextTap < ahead) {
          this.windowTap(this.nextTap);
          this.nextTap += -Math.log(1 - Math.random()) / rate;
        }
      }
      if (L.mud > 0.005) {
        if (this.nextMud < now) this.nextMud = now;
        while (this.nextMud < ahead) {
          const t = this.nextMud;
          if (this.steps > 0) {
            this.squelch(t, true);
            this.steps--;
            this.nextMud += rand(0.5, 0.62);
          } else if (Math.random() < 0.08) {
            this.steps = 5 + Math.floor(Math.random() * 8); // someone walks through
            this.nextMud += rand(0.3, 1);
          } else {
            if (Math.random() < 0.5) this.squelch(t, false); else this.mudPop(t);
            this.nextMud += -Math.log(1 - Math.random()) / 1.4;
          }
        }
      }
      if (L.traffic > 0.005 && now > this.nextCar) this.car(now + 0.05);
      if (L.keyboard > 0.005) {
        if (this.nextKey < now) this.nextKey = now;
        while (this.nextKey < ahead) {
          if (this.keysLeft > 0) {
            const big = Math.random() < 0.12; // space bar
            this.keystroke(this.nextKey, big);
            this.keysLeft--;
            this.nextKey += big ? rand(0.18, 0.3) : rand(0.07, 0.17) * (Math.random() < 0.08 ? 3 : 1);
          } else {
            this.keysLeft = 4 + Math.floor(Math.random() * 36);
            this.nextKey += rand(1, 6);
          }
        }
      }
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
      if (!(name in this.levels)) return;
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
      this.ramp(this.bus.wind.gain, L.wind * 1.6, 0.6);
      this.ramp(this.bus.window.gain, L.window * 2.4, 0.5);
      this.ramp(this.winBody.gain, 0.15 + 0.6 * L.rain, 0.6);
      this.ramp(this.bus.mud.gain, L.mud * 9, 0.5);
      this.ramp(this.bus.traffic.gain, L.traffic * 0.9, 0.8);
      this.ramp(this.bus.keyboard.gain, L.keyboard * 1.5, 0.4);
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

      this.tickAmbience(now, ahead);
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
      this.nextCar = now + rand(1, 4);
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
