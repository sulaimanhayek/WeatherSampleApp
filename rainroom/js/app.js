/* Rainroom UI: wires controls to the audio engine and the scene. */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const body = document.body;
  const root = document.documentElement;

  const LAYERS = ['thunder', 'wind', 'window', 'mud', 'traffic', 'keyboard'];
  const SLIDERS = ['rain', 'rainVol', 'music', 'volume'];
  // A layer at 0 in a preset is switched off; its last level is kept for when it comes back on
  const PRESETS = {
    drizzle:  { label: 'Drizzle',      rain: 0.22, music: 0.45, thunder: 0,    wind: 0,    window: 0.5,  mud: 0,   traffic: 0.2, keyboard: 0 },
    steady:   { label: 'Steady rain',  rain: 0.55, music: 0.5,  thunder: 0.15, wind: 0.18, window: 0,    mud: 0,   traffic: 0,   keyboard: 0 },
    downpour: { label: 'Downpour',     rain: 0.88, music: 0.35, thunder: 0.3,  wind: 0.35, window: 0,    mud: 0.4, traffic: 0,   keyboard: 0 },
    storm:    { label: 'Thunderstorm', rain: 0.78, music: 0.3,  thunder: 0.85, wind: 0.55, window: 0.35, mud: 0,   traffic: 0,   keyboard: 0 },
    city:     { label: 'City night',   rain: 0.5,  music: 0.4,  thunder: 0,    wind: 0.1,  window: 0.3,  mud: 0,   traffic: 0.6, keyboard: 0 },
    focus:    { label: 'Lo-fi focus',  rain: 0.42, music: 0.75, thunder: 0.08, wind: 0,    window: 0.3,  mud: 0,   traffic: 0,   keyboard: 0.35 },
  };
  const STORE = 'rainroom:v2';

  // Rainfall rate classes follow the AMS glossary: light < 2.5, moderate < 7.6, heavy < 50 mm/h
  const mmPerHour = v => (v <= 0.001 ? 0 : 0.3 * Math.pow(80 / 0.3, v));
  const rainClass = mm => (mm === 0 ? 'dry' : mm < 2.5 ? 'light' : mm < 7.6 ? 'moderate' : mm < 50 ? 'heavy' : 'violent');
  const fmtMm = mm => (mm === 0 ? '0 mm/h' : (mm < 10 ? mm.toFixed(1) : Math.round(mm)) + ' mm/h');
  const pct = v => Math.round(v * 100) + '%';

  /* ---------- state ---------- */
  function defaults() {
    const hour = new Date().getHours();
    const p = PRESETS.steady;
    const layers = {};
    for (const k of LAYERS) layers[k] = { on: p[k] > 0, vol: p[k] > 0 ? p[k] : 0.4 };
    return {
      levels: { rain: p.rain, rainVol: 0.8, music: p.music, volume: 0.8 },
      layers,
      preset: 'steady',
      mood: hour >= 7 && hour < 18 ? 'day' : 'evening',
      desk: false,
      street: true,
      tab: 'mix',
    };
  }

  function load() {
    const d = defaults();
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (!s) return d;
      Object.assign(d.levels, s.levels);
      for (const k of LAYERS) if (s.layers && s.layers[k]) Object.assign(d.layers[k], s.layers[k]);
      for (const k of ['preset', 'mood', 'desk', 'street', 'tab']) if (s[k] != null) d[k] = s[k];
    } catch (e) { /* storage unavailable */ }
    return d;
  }

  const state = load();
  state.playing = false;

  let saveTimer;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { levels, layers, preset, mood, desk, street, tab } = state;
      try { localStorage.setItem(STORE, JSON.stringify({ levels, layers, preset, mood, desk, street, tab })); } catch (e) { /* storage unavailable */ }
    }, 400);
  }

  const eff = k => (state.layers[k].on ? state.layers[k].vol : 0);

  /* ---------- engines ---------- */
  const audio = new RainAudio();
  let scene = null;
  try {
    scene = new RainScene($('#scene'), $('#bolt'), $('#glass'));
  } catch (e) {
    console.warn('WebGL unavailable, running audio only', e);
  }

  // Push the whole state into the audio engine and the scene; both smooth their own transitions
  function sync() {
    for (const k of SLIDERS) audio.setLevel(k, state.levels[k]);
    for (const k of LAYERS) audio.setLevel(k, eff(k));
    if (scene) {
      scene.setParams({
        rain: state.levels.rain, wind: eff('wind'), window: eff('window'),
        day: state.mood === 'day' ? 1 : 0, desk: state.desk ? 1 : 0, street: state.street ? 1 : 0,
      });
    }
    saveSoon();
  }

  /* ---------- rendering ---------- */
  const inputs = Object.fromEntries(SLIDERS.map(k => [k, $('#' + k)]));
  const outputs = Object.fromEntries(SLIDERS.map(k => [k, $('#' + k + 'Out')]));
  const tiles = Object.fromEntries(LAYERS.map(k => {
    const el = $(`.tile[data-layer="${k}"]`);
    return [k, { el, btn: el.querySelector('.tile-btn'), state: el.querySelector('.tile-state'), input: el.querySelector('input') }];
  }));

  const setFill = (input, v) => { input.value = Math.round(v * 100); input.style.setProperty('--fill', v * 100 + '%'); };

  // vals holds slider positions, which can be mid-animation and differ from state
  function currentVals() {
    const v = { ...state.levels };
    for (const k of LAYERS) v[k] = state.layers[k].vol;
    return v;
  }

  function render(vals = currentVals()) {
    for (const k of SLIDERS) setFill(inputs[k], vals[k]);
    const mm = mmPerHour(vals.rain);
    outputs.rain.textContent = fmtMm(mm);
    outputs.rainVol.textContent = pct(vals.rainVol);
    outputs.music.textContent = pct(vals.music);
    outputs.volume.textContent = pct(vals.volume);
    $('#nowMeta').textContent = `${fmtMm(mm)} · ${rainClass(mm)}`;

    for (const k of LAYERS) {
      const t = tiles[k];
      const on = state.layers[k].on;
      setFill(t.input, vals[k]);
      t.el.classList.toggle('on', on);
      t.btn.setAttribute('aria-pressed', String(on));
      t.state.textContent = on ? pct(vals[k]) : 'Off';
    }
  }

  function renderPreset() {
    $('#nowLabel').textContent = PRESETS[state.preset] ? PRESETS[state.preset].label : 'Your mix';
    $$('.presets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === state.preset));
  }

  function matchPreset() {
    for (const [id, p] of Object.entries(PRESETS)) {
      const same = Math.abs(p.rain - state.levels.rain) < 0.011 && Math.abs(p.music - state.levels.music) < 0.011 &&
        LAYERS.every(k => Math.abs(p[k] - eff(k)) < 0.011);
      if (same) return id;
    }
    return 'custom';
  }
  function refreshPreset() { state.preset = matchPreset(); renderPreset(); }

  let tweenRaf = 0;
  function tween(from, to, ms) {
    cancelAnimationFrame(tweenRaf);
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = {};
      for (const key of Object.keys(to)) cur[key] = from[key] + (to[key] - from[key]) * e;
      render(cur);
      if (k < 1) tweenRaf = requestAnimationFrame(step);
    };
    tweenRaf = requestAnimationFrame(step);
  }

  /* ---------- mix ---------- */
  function choosePreset(id) {
    const p = PRESETS[id];
    const from = currentVals();
    state.levels.rain = p.rain;
    state.levels.music = p.music;
    for (const k of LAYERS) {
      if (p[k] > 0) state.layers[k] = { on: true, vol: p[k] };
      else state.layers[k].on = false;
    }
    state.preset = id;
    renderPreset();
    sync();
    tween(from, currentVals(), 1200);
  }
  $$('.presets .chip').forEach(c => c.addEventListener('click', () => choosePreset(c.dataset.preset)));

  for (const k of SLIDERS) {
    inputs[k].addEventListener('input', () => {
      cancelAnimationFrame(tweenRaf);
      state.levels[k] = inputs[k].value / 100;
      sync();
      render();
      if (k === 'rain' || k === 'music') refreshPreset();
    });
  }

  /* ---------- sound tiles ---------- */
  function setLayer(k, patch) {
    cancelAnimationFrame(tweenRaf);
    Object.assign(state.layers[k], patch);
    sync();
    render();
    refreshPreset();
  }
  for (const k of LAYERS) {
    const t = tiles[k];
    t.btn.addEventListener('click', () => {
      const L = state.layers[k];
      setLayer(k, { on: !L.on, vol: !L.on && L.vol < 0.05 ? 0.4 : L.vol });
      if (state.layers[k].on && !state.playing) toast('Press play to hear it.');
    });
    t.input.addEventListener('input', () => {
      const v = t.input.value / 100;
      setLayer(k, { vol: v, on: v > 0 });
    });
  }

  /* ---------- tabs ---------- */
  const TABS = ['mix', 'sounds', 'room'];
  function setTab(id) {
    state.tab = TABS.includes(id) ? id : 'mix';
    const i = TABS.indexOf(state.tab);
    $$('.tab').forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + state.tab));
    $('.tab-ink').style.transform = `translateX(${i * 100}%)`;
    fitPanes();
    saveSoon();
  }
  function fitPanes() {
    const pane = $('#pane-' + state.tab);
    if (pane) $('.panes').style.height = pane.offsetHeight + 'px';
  }
  window.addEventListener('resize', fitPanes);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPanes);
  $$('.tab').forEach(b => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = (TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
      setTab(TABS[i]);
      $('#tab-' + TABS[i]).focus();
    });
  });

  /* ---------- room: mood + lamps ---------- */
  function setMood(mood) {
    state.mood = mood === 'day' ? 'day' : 'evening';
    root.dataset.mood = state.mood;
    $$('.seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mood === state.mood)));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = state.mood === 'day' ? '#b9c2c9' : '#06090f';
    $('.hero h1').innerHTML = state.mood === 'day' ? 'Rain for the <em>slow afternoon</em>' : 'Rain for the <em>late hours</em>';
    sync();
  }
  $$('.seg button').forEach(b => b.addEventListener('click', () => setMood(b.dataset.mood)));

  function setLamp(which, on) {
    state[which] = on;
    $(`.lamp[data-lamp="${which}"]`).setAttribute('aria-pressed', String(on));
    body.classList.toggle('desk-on', state.desk);
    sync();
  }
  $$('.lamp').forEach(b => b.addEventListener('click', () => {
    setLamp(b.dataset.lamp, !state[b.dataset.lamp]);
    audio.click();
  }));

  /* ---------- play / pause ---------- */
  async function setPlaying(want) {
    if (want === state.playing) return;
    state.playing = want;
    if (want) {
      body.classList.add('started', 'playing');
      try { await audio.play(); } catch (e) {
        state.playing = false;
        body.classList.remove('playing');
        toast('Audio could not start. Tap play to try again.');
        return;
      }
      requestWake();
      poke();
    } else {
      audio.pause();
      body.classList.remove('playing', 'idle');
      releaseWake();
    }
    $('#playBtn').setAttribute('aria-label', want ? 'Pause' : 'Play');
    try { navigator.mediaSession.playbackState = want ? 'playing' : 'paused'; } catch (e) { /* unsupported */ }
  }
  $('#startBtn').addEventListener('click', () => setPlaying(true));
  $('#playBtn').addEventListener('click', () => setPlaying(!state.playing));

  /* ---------- lightning ---------- */
  let strikeTick, strikeHide;
  audio.onStrike = ({ distance, delay }) => {
    if (scene) scene.flash({ distance });
    const el = $('#strike');
    $('#strikeKm').textContent = `Strike ${distance.toFixed(1)} km away`;
    const end = performance.now() + delay * 1000;
    el.classList.add('show');
    clearInterval(strikeTick);
    clearTimeout(strikeHide);
    const update = () => {
      const left = (end - performance.now()) / 1000;
      if (left > 0) { $('#strikeNote').textContent = `thunder in ${left.toFixed(1)} s`; return; }
      $('#strikeNote').textContent = 'sound travels about 1 km every 3 s';
      clearInterval(strikeTick);
      strikeHide = setTimeout(() => el.classList.remove('show'), 4500);
    };
    update();
    strikeTick = setInterval(update, 100);
  };

  async function callStrike() {
    if (!state.playing) await setPlaying(true);
    if (!state.playing) return;
    const L = state.layers.thunder;
    if (!L.on || L.vol < 0.05) setLayer('thunder', { on: true, vol: Math.max(L.vol, 0.35) });
    audio.strike(0.3 + Math.random() * 2);
  }
  $('#strikeBtn').addEventListener('click', callStrike);

  /* ---------- collapse ---------- */
  function toggleCollapse() {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#collapseBtn').setAttribute('aria-expanded', String(!collapsed));
    $('#collapseBtn').setAttribute('aria-label', collapsed ? 'Show controls' : 'Hide controls');
  }
  $('#collapseBtn').addEventListener('click', toggleCollapse);

  /* ---------- focus timer ---------- */
  let focusEnd = 0, focusTick;
  function setFocus(min) {
    focusEnd = min ? Date.now() + min * 60000 : 0;
    $$('.timer-chips .chip').forEach(c => c.classList.toggle('active', +c.dataset.min === min));
    clearInterval(focusTick);
    if (min) focusTick = setInterval(updateFocus, 1000);
    updateFocus();
  }
  function updateFocus() {
    const el = $('#focusLeft');
    if (!focusEnd) { el.textContent = ''; return; }
    const ms = focusEnd - Date.now();
    if (ms <= 0) {
      setFocus(0);
      audio.chime();
      toast('Focus session done. Stand up, stretch, drink some water.');
      return;
    }
    const s = Math.ceil(ms / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
  }
  $$('.timer-chips .chip').forEach(c => c.addEventListener('click', () => setFocus(+c.dataset.min)));

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  /* ---------- screen wake lock ---------- */
  let wakeLock = null;
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* denied or unsupported */ }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.playing) requestWake(); });

  /* ---------- idle dimming ---------- */
  let idleTimer, swallowClick = false;
  function poke() {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (state.playing) body.classList.add('idle'); }, 8000);
  }
  // While dimmed, the first tap only brings the controls back
  window.addEventListener('pointerdown', e => {
    if (body.classList.contains('idle') && e.pointerType !== 'mouse') swallowClick = true;
    poke();
  }, { capture: true, passive: true });
  window.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); }
  }, { capture: true });
  window.addEventListener('pointerup', () => { setTimeout(() => { swallowClick = false; }, 50); }, { capture: true, passive: true });
  ['pointermove', 'keydown'].forEach(ev => window.addEventListener(ev, poke, { passive: true }));

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (k === 'l') callStrike();
    else if (k === 'h') toggleCollapse();
    else if (k === 'd') setMood(state.mood === 'day' ? 'evening' : 'day');
  });

  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Rainroom', artist: 'Generated rain, thunder and music' });
    navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
  } catch (e) { /* unsupported */ }

  // First frame: everything rendered from saved or default state
  setMood(state.mood);
  setLamp('desk', state.desk);
  setLamp('street', state.street);
  setTab(state.tab);
  setFocus(0);
  render();
  renderPreset();
  sync();
})();
