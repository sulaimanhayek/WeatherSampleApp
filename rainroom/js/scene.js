/* Rainroom visuals: a shader sky with drifting cloud and lightning, GPU-animated rain streaks, and a 2D bolt overlay. */
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);

  const BG_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const BG_FRAG = `
    uniform float uTime, uFlash, uFlashX;
    uniform vec2 uRes;
    varying vec2 vUv;
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
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2(uv.x * aspect, uv.y);
      vec3 col = mix(vec3(0.045, 0.06, 0.08), vec3(0.015, 0.025, 0.045), uv.y);

      float c1 = fbm(p * 2.2 + vec2(uTime * 0.012, 0.0));
      float c2 = fbm(p * 4.0 - vec2(uTime * 0.02, uTime * 0.004));
      float clouds = smoothstep(0.35, 0.9, c1 * 0.7 + c2 * 0.4) * smoothstep(0.05, 0.8, uv.y);
      col += clouds * vec3(0.05, 0.065, 0.085);

      // Faint town glow low on the horizon
      col += vec3(0.11, 0.075, 0.045) * pow(1.0 - uv.y, 5.0) * 0.55;

      float d = length(vec2(p.x - uFlashX * aspect, (uv.y - 0.85) * 1.5));
      float flash = uFlash * (0.3 + clouds * 1.8) * exp(-d * 1.2);
      col += flash * vec3(0.75, 0.82, 1.0) + uFlash * 0.07;

      vec2 q = uv - 0.5;
      col *= 1.0 - dot(q, q) * 0.9;
      col += (hash(uv * uRes + uTime) - 0.5) / 255.0; // dither against banding
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const RAIN_VERT = `
    attribute vec4 aSeed;   // x (-1..1), distance from camera, speed multiplier, phase
    attribute float aEnd;   // 0 = head of streak, 1 = tail
    uniform float uTravel, uWind, uSpread;
    varying float vAlpha;
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
    }
  `;

  const RAIN_FRAG = `
    uniform float uFlash;
    varying float vAlpha;
    void main() {
      vec3 c = vec3(0.62, 0.73, 0.84) * (1.0 + uFlash * 2.5);
      gl_FragColor = vec4(c, vAlpha * 0.6);
    }
  `;

  function jag(a, b, rough, depth) {
    if (depth === 0) return [a, b];
    const m = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * rough, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * rough * 0.3];
    return jag(a, m, rough / 2, depth - 1).concat(jag(m, b, rough / 2, depth - 1).slice(1));
  }

  class RainScene {
    constructor(canvas, boltCanvas) {
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      this.renderer.autoClear = false;
      this.bolt = boltCanvas;
      this.bctx = boltCanvas.getContext('2d');

      this.bgScene = new THREE.Scene();
      this.bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.bgU = { uTime: { value: 0 }, uFlash: { value: 0 }, uFlashX: { value: 0.5 }, uRes: { value: new THREE.Vector2(1, 1) } };
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
      this.rainU = { uTravel: { value: 0 }, uWind: { value: 0.1 }, uSpread: { value: 1 }, uFlash: this.bgU.uFlash };
      this.rain = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
        uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);

      this.params = { rain: 0.5, wind: 0.2 };
      this.cur = { rain: 0, wind: 0.2 };
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
      this.bolt.width = Math.round(w * this.dpr);
      this.bolt.height = Math.round(h * this.dpr);
    }

    setParams({ rain, wind }) {
      if (rain != null) this.params.rain = rain;
      if (wind != null) this.params.wind = wind;
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
      const end = [x0 + rand(-0.15, 0.15) * w, h * rand(0.45, 0.8)];
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
      c.save();
      c.scale(this.dpr, this.dpr);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.shadowColor = 'rgba(170, 200, 255, 0.9)';
      c.shadowBlur = 18;
      c.strokeStyle = 'rgb(236, 242, 255)';
      for (const p of this.bolts) {
        c.globalAlpha = Math.min(1, v) * p.alpha;
        c.lineWidth = p.width;
        c.beginPath();
        c.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) c.lineTo(p.pts[i][0], p.pts[i][1]);
        c.stroke();
      }
      c.restore();
      this.boltDrawn = true;
    }

    frame() {
      requestAnimationFrame(this.frame);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.t += dt;
      const k = 1 - Math.exp(-dt * 1.4);
      this.cur.rain += (this.params.rain - this.cur.rain) * k;
      this.cur.wind += (this.params.wind - this.cur.wind) * k;

      const rain = this.cur.rain;
      this.rain.geometry.setDrawRange(0, Math.round(this.N * Math.pow(rain, 0.85)) * 2);
      this.travel += dt * (20 + 16 * rain);
      this.rainU.uTravel.value = this.travel;

      const t = this.t;
      const gust = this.cur.wind * (0.7 + 0.3 * Math.sin(t * 0.23) * Math.sin(t * 0.71));
      const wind = 0.04 + gust * 0.5;
      this.rainU.uWind.value = wind;
      this.rainU.uSpread.value = Math.tan(Math.PI / 6) * this.camera.aspect * 1.15 + wind * 0.7;

      const f = this.flashValue();
      this.bgU.uFlash.value = f;
      this.bgU.uTime.value = t;
      this.drawBolt(f);

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
