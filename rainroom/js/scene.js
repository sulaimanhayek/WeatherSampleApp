/* Rainroom visuals: shader sky with clouds, lamps and lightning; GPU rain streaks; 2D bolt and window-glass overlays. */
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);

  // Shared by the sky and the rain so drops light up as they pass the lamps
  const LIGHTS = `
    uniform float uStreet, uDesk, uLampY, uAspect, uDay;
    float lampX(int i) { return 0.14 + float(i) * 0.26; }
    float streetLight(vec2 uv) {
      float s = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 d = (uv - vec2(lampX(i), uLampY)) * vec2(uAspect, 1.0);
        s += exp(-length(d) * 9.0);
      }
      return s * uStreet * (1.0 - 0.65 * uDay);
    }
    float deskLight(vec2 uv) {
      vec2 d = (uv - vec2(-0.06, uLampY + 0.1)) * vec2(uAspect, 1.0);
      return exp(-length(d) * 2.6) * uDesk * (1.0 - 0.7 * uDay);
    }
  `;

  const BG_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const BG_FRAG = `
    uniform float uTime, uFlash, uFlashX;
    uniform vec2 uRes;
    varying vec2 vUv;
    ${LIGHTS}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }
    void main() {
      vec2 uv = vUv;
      float aspect = uAspect;
      vec2 p = vec2(uv.x * aspect, uv.y);
      vec3 warm = vec3(1.0, 0.7, 0.38);

      vec3 night = mix(vec3(0.045, 0.06, 0.08), vec3(0.015, 0.025, 0.045), uv.y);
      vec3 day = mix(vec3(0.72, 0.75, 0.77), vec3(0.53, 0.58, 0.63), uv.y);
      vec3 col = mix(night, day, uDay);

      float c1 = fbm(p * 2.2 + vec2(uTime * 0.012, 0.0));
      float c2 = fbm(p * 4.0 - vec2(uTime * 0.02, uTime * 0.004));
      float clouds = smoothstep(0.35, 0.9, c1 * 0.7 + c2 * 0.4) * smoothstep(0.05, 0.8, uv.y);
      col += clouds * vec3(0.05, 0.065, 0.085) * (1.0 - uDay);
      col -= clouds * vec3(0.11, 0.11, 0.1) * uDay;

      // Town glow low on the horizon at night
      col += vec3(0.11, 0.075, 0.045) * pow(1.0 - uv.y, 5.0) * 0.55 * (1.0 - uDay);

      // Street lamps: posts are always there; heads, halos and light cones fade with uStreet
      vec3 postCol = mix(vec3(0.015, 0.02, 0.028), vec3(0.3, 0.33, 0.36), uDay);
      for (int i = 0; i < 4; i++) {
        vec2 d = (uv - vec2(lampX(i), uLampY)) * vec2(aspect, 1.0);
        float post = (1.0 - smoothstep(0.0012, 0.0028, abs(d.x))) * step(uv.y, uLampY);
        col = mix(col, postCol, post * 0.85);
        float r = length(d);
        float head = 1.0 - smoothstep(0.005, 0.01, r);
        col = mix(col, mix(postCol * 1.6, vec3(1.0, 0.88, 0.66), uStreet * (1.0 - 0.55 * uDay)), head);
        float flick = 0.95 + 0.05 * sin(uTime * 13.0 + float(i) * 7.0) * sin(uTime * 3.1 + float(i));
        float lit = uStreet * (1.0 - 0.65 * uDay) * flick;
        col += warm * (0.5 * exp(-r * 30.0) + 0.2 * exp(-r * 7.0)) * lit;
        float below = uLampY - uv.y;
        float cone = step(0.0, below) * exp(-abs(d.x) / max(below * 0.35, 0.002) * 1.5) * exp(-below * 3.5);
        col += warm * cone * 0.09 * lit;
      }

      // Desk lamp: warm light spilling in from the left edge, and a warmer room overall
      col += vec3(1.0, 0.66, 0.36) * 0.3 * deskLight(uv);
      col = mix(col, col * vec3(1.1, 0.98, 0.85), uDesk * 0.35 * (1.0 - uDay));

      float d = length(vec2(p.x - uFlashX * aspect, (uv.y - 0.85) * 1.5));
      float flash = uFlash * (0.3 + clouds * 1.8) * exp(-d * 1.2);
      col += (flash * vec3(0.75, 0.82, 1.0) + uFlash * 0.07) * mix(1.0, 0.45, uDay);

      vec2 q = uv - 0.5;
      col *= 1.0 - dot(q, q) * mix(0.9, 0.35, uDay);
      col += (hash(uv * uRes + uTime) - 0.5) / 255.0; // dither against banding
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const RAIN_VERT = `
    attribute vec4 aSeed;   // x (-1..1), distance from camera, speed multiplier, phase
    attribute float aEnd;   // 0 = head of streak, 1 = tail
    uniform float uTravel, uWind, uSpread;
    varying float vAlpha;
    varying vec2 vScreen;
    void main() {
      float dist = aSeed.y;
      float halfH = dist * 0.62;
      float fall = mod(aSeed.w * 2.0 * halfH + uTravel * aSeed.z, 2.0 * halfH);
      float y = halfH - fall;
      vec3 head = vec3(aSeed.x * dist * uSpread - uWind * y, y, 12.0 - dist);
      vec3 dir = normalize(vec3(uWind, -1.0, 0.0));
      float len = 0.35 + 0.9 * aSeed.z;
      vec3 p = head - dir * len * aEnd;
      vAlpha = mix(0.95, 0.14, smoothstep(3.0, 52.0, dist)) * (1.0 - aEnd);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vScreen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
    }
  `;

  const RAIN_FRAG = `
    uniform float uFlash;
    uniform vec3 uColor;
    varying float vAlpha;
    varying vec2 vScreen;
    ${LIGHTS}
    void main() {
      float lit = streetLight(vScreen) + deskLight(vScreen) * 0.3;
      vec3 c = uColor * (1.0 + uFlash * 2.5 * (1.0 - uDay * 0.6)) + vec3(1.0, 0.72, 0.42) * lit * 1.6;
      gl_FragColor = vec4(c, vAlpha * (mix(0.6, 0.5, uDay) + lit * 0.8));
    }
  `;

  function jag(a, b, rough, depth) {
    if (depth === 0) return [a, b];
    const m = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * rough, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * rough * 0.3];
    return jag(a, m, rough / 2, depth - 1).concat(jag(m, b, rough / 2, depth - 1).slice(1));
  }

  // One pre-rendered water drop per mood, drawn scaled for every drop on the glass
  function dropSprite(day) {
    const s = 64, r = s / 2;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(r * 0.8, r * 0.75, r * 0.1, r, r, r);
    const stops = day
      ? [[0, 'rgba(255,255,255,0.28)'], [0.72, 'rgba(70,86,100,0.2)'], [0.92, 'rgba(40,55,68,0.5)'], [1, 'rgba(40,55,68,0)']]
      : [[0, 'rgba(170,195,215,0.1)'], [0.72, 'rgba(8,14,22,0.3)'], [0.92, 'rgba(190,215,235,0.45)'], [1, 'rgba(190,215,235,0)']];
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.ellipse(r * 0.68, r * 0.62, r * 0.16, r * 0.11, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.ellipse(r * 1.12, r * 1.45, r * 0.3, r * 0.12, 0, 0, Math.PI * 2); g.fill();
    return c;
  }

  class RainScene {
    constructor(canvas, boltCanvas, glassCanvas) {
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      this.renderer.autoClear = false;
      this.bolt = boltCanvas;
      this.bctx = boltCanvas.getContext('2d');
      this.glass = glassCanvas;
      this.gctx = glassCanvas.getContext('2d');
      this.sprites = { night: dropSprite(false), day: dropSprite(true) };
      this.drops = [];
      this.spawnAcc = 0;

      const lightU = {
        uStreet: { value: 0 }, uDesk: { value: 0 }, uLampY: { value: 0.3 },
        uAspect: { value: 1 }, uDay: { value: 0 },
      };
      this.lightU = lightU;

      this.bgScene = new THREE.Scene();
      this.bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.bgU = Object.assign({ uTime: { value: 0 }, uFlash: { value: 0 }, uFlashX: { value: 0.5 }, uRes: { value: new THREE.Vector2(1, 1) } }, lightU);
      this.bgScene.add(new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({ uniforms: this.bgU, vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false })
      ));

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      this.camera.position.set(0, 0, 12);

      const N = this.N = 9000;
      const seeds = new Float32Array(N * 8);
      const ends = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        // sqrt biases drops into the distance, where the volume is larger
        const s = [Math.random() * 2 - 1, 3 + 49 * Math.sqrt(Math.random()), rand(0.75, 1.25), Math.random()];
        seeds.set(s, i * 8);
        seeds.set(s, i * 8 + 4);
        ends[i * 2 + 1] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
      this.rainU = Object.assign({
        uTravel: { value: 0 }, uWind: { value: 0.1 }, uSpread: { value: 1 },
        uFlash: this.bgU.uFlash, uColor: { value: new THREE.Color(0.62, 0.73, 0.84) },
      }, lightU);
      this.rain = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
        uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
        transparent: true, depthWrite: false,
      }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);

      this.params = { rain: 0.5, wind: 0.2, window: 0, day: 0, desk: 0, street: 0 };
      this.cur = { ...this.params, rain: 0 };
      this.nightRain = new THREE.Color(0.62, 0.73, 0.84);
      this.dayRain = new THREE.Color(0.2, 0.25, 0.3);
      this.flashes = [];
      this.bolts = null;
      this.t = 0;
      this.travel = 0;
      this.pointer = { x: 0, y: 0 };

      window.addEventListener('resize', () => this.resize());
      window.addEventListener('pointermove', e => {
        this.pointer.x = e.clientX / window.innerWidth - 0.5;
        this.pointer.y = e.clientY / window.innerHeight - 0.5;
      }, { passive: true });
      this.resize();
      this.clock = new THREE.Clock();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    resize() {
      const w = this.w = window.innerWidth;
      const h = this.h = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.bgU.uRes.value.set(w * this.dpr, h * this.dpr);
      this.lightU.uAspect.value = w / h;
      // On a portrait phone the controls cover the lower half, so the lamps stand higher
      this.lightU.uLampY.value = w / h < 1 ? 0.6 : 0.34;
      for (const c of [this.bolt, this.glass]) {
        c.width = Math.round(w * this.dpr);
        c.height = Math.round(h * this.dpr);
      }
    }

    setParams(p) {
      for (const k of Object.keys(this.params)) if (p[k] != null) this.params[k] = +p[k];
    }

    flash({ distance }) {
      const near = Math.max(0, 1 - distance / 6);
      const amp = (0.35 + 0.65 * near) * (this.reduced ? 0.35 : 1);
      const x = rand(0.15, 0.85);
      this.bgU.uFlashX.value = x;
      let s = this.t;
      const pulses = this.reduced ? 1 : 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < pulses; i++) {
        this.flashes.push({ t: s, a: amp * (i === 0 ? 1 : rand(0.4, 0.9)) });
        s += rand(0.06, 0.2);
      }
      if (!this.reduced && near > 0.35) this.makeBolt(x);
    }

    makeBolt(x) {
      const { w, h } = this;
      const x0 = x * w;
      const end = [x0 + rand(-0.15, 0.15) * w, h * rand(0.35, 0.7)];
      const main = jag([x0, -10], end, h * 0.14, 7);
      const paths = [{ pts: main, width: 2.2, alpha: 1 }];
      const branches = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < branches; i++) {
        const from = main[Math.floor(rand(0.2, 0.7) * main.length)];
        const len = h * rand(0.08, 0.22);
        const ang = rand(0.3, 1.1) * (Math.random() < 0.5 ? -1 : 1);
        const to = [from[0] + Math.sin(ang) * len, from[1] + Math.cos(ang) * len];
        paths.push({ pts: jag(from, to, len * 0.4, 5), width: 1, alpha: 0.55 });
      }
      this.bolts = paths;
      this.boltBorn = this.t;
    }

    flashValue() {
      const t = this.t;
      this.flashes = this.flashes.filter(f => t - f.t < 1.5);
      let v = 0;
      for (const f of this.flashes) if (t >= f.t) v += f.a * Math.exp(-(t - f.t) / 0.085);
      return Math.min(v, 1.4);
    }

    drawBolt(v) {
      const c = this.bctx;
      if (this.boltDrawn) { c.clearRect(0, 0, this.bolt.width, this.bolt.height); this.boltDrawn = false; }
      if (!this.bolts || this.t - this.boltBorn > 1.2) { this.bolts = null; return; }
      if (v < 0.02) return;
      const day = this.cur.day;
      c.save();
      c.scale(this.dpr, this.dpr);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.shadowColor = 'rgba(170, 200, 255, 0.9)';
      c.shadowBlur = 18;
      c.strokeStyle = 'rgb(236, 242, 255)';
      for (const p of this.bolts) {
        c.globalAlpha = Math.min(1, v) * p.alpha * (1 - 0.5 * day);
        c.lineWidth = p.width;
        c.beginPath();
        c.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) c.lineTo(p.pts[i][0], p.pts[i][1]);
        c.stroke();
      }
      c.restore();
      this.boltDrawn = true;
    }

    // Drops on the window pane: they bead up, grow, and the heavy ones run down, leaving a trail
    updateGlass(dt) {
      const c = this.gctx;
      const lvl = this.cur.window;
      if (lvl < 0.01) {
        if (this.glassDrawn) { c.clearRect(0, 0, this.glass.width, this.glass.height); this.glassDrawn = false; }
        return;
      }
      const { w, h } = this;
      const drops = this.drops;
      this.spawnAcc += dt * (4 + 50 * this.cur.rain) * Math.min(1, this.params.window * 2);
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        if (drops.length < 260) {
          drops.push({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.pow(Math.random(), 2.2) * 5, vy: 0, age: 0, life: rand(25, 60), seed: Math.random() * 6, trail: 0 });
        }
      }
      const born = [];
      for (const d of drops) {
        d.age += dt;
        if (!d.vy && d.r > 3.6 && Math.random() < dt * 0.25) d.vy = 5;
        if (!d.vy) continue;
        d.vy = Math.min(d.vy + dt * 300, 70 + d.r * 22);
        d.y += d.vy * dt;
        d.x += Math.sin(d.y * 0.05 + d.seed) * 0.3;
        d.r = Math.max(0, d.r - dt * 0.12);
        d.trail += d.vy * dt;
        if (d.trail > 10) {
          d.trail = 0;
          if (Math.random() < 0.6) born.push({ x: d.x + rand(-1, 1), y: d.y - d.r, r: 0.5 + rand(0.5, 1.2) * Math.min(1, d.r / 4), vy: 0, age: 0, life: rand(8, 20), seed: 0, trail: 0 });
        }
        for (const o of drops) {
          if (o === d || o.vy || o.dead) continue;
          const dx = o.x - d.x, dy = o.y - d.y;
          if (dx * dx + dy * dy < (d.r + o.r) * (d.r + o.r)) {
            d.r = Math.min(8, Math.hypot(d.r, o.r));
            o.dead = true;
          }
        }
      }
      this.drops = drops.filter(d => !d.dead && d.age < d.life && d.y < h + 20 && d.r > 0.4).concat(born);

      c.clearRect(0, 0, this.glass.width, this.glass.height);
      c.save();
      c.scale(this.dpr, this.dpr);
      const sprite = this.cur.day > 0.5 ? this.sprites.day : this.sprites.night;
      for (const d of this.drops) {
        const fade = Math.min(1, (d.life - d.age) / 3, d.age / 0.25);
        c.globalAlpha = lvl * fade;
        const stretch = d.vy ? 1.3 : 1;
        c.drawImage(sprite, d.x - d.r, d.y - d.r * stretch, d.r * 2, d.r * 2 * stretch);
      }
      c.restore();
      this.glassDrawn = true;
    }

    frame() {
      requestAnimationFrame(this.frame);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.t += dt;
      const k = 1 - Math.exp(-dt * 1.4);
      for (const key of Object.keys(this.cur)) this.cur[key] += (this.params[key] - this.cur[key]) * k;

      const rain = this.cur.rain;
      this.rain.geometry.setDrawRange(0, Math.round(this.N * Math.pow(rain, 0.85)) * 2);
      this.travel += dt * (20 + 16 * rain);
      this.rainU.uTravel.value = this.travel;
      this.rainU.uColor.value.copy(this.nightRain).lerp(this.dayRain, this.cur.day);

      const t = this.t;
      const gust = this.cur.wind * (0.7 + 0.3 * Math.sin(t * 0.23) * Math.sin(t * 0.71));
      const wind = 0.04 + gust * 0.5;
      this.rainU.uWind.value = wind;
      this.rainU.uSpread.value = Math.tan(Math.PI / 6) * this.camera.aspect * 1.15 + wind * 0.7;

      this.lightU.uDay.value = this.cur.day;
      this.lightU.uDesk.value = this.cur.desk;
      this.lightU.uStreet.value = this.cur.street;

      const f = this.flashValue();
      this.bgU.uFlash.value = f;
      this.bgU.uTime.value = t;
      this.drawBolt(f);
      this.updateGlass(dt);

      const cam = this.camera;
      cam.position.x += (this.pointer.x * 0.8 - cam.position.x) * k;
      cam.position.y += (-this.pointer.y * 0.5 - cam.position.y) * k;
      cam.lookAt(0, 0, 0);

      this.renderer.clear();
      this.renderer.render(this.bgScene, this.bgCam);
      this.renderer.render(this.scene, cam);
    }
  }

  window.RainScene = RainScene;
})();
