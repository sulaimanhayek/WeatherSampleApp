/* Rainroom UI: wires controls to the audio engine and the scene. */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const body = document.body;

  const PRESETS = {
    drizzle:  { label: 'Drizzle',      rain: 0.22, thunder: 0,    music: 0.45, wind: 0.08 },
    steady:   { label: 'Steady rain',  rain: 0.55, thunder: 0.15, music: 0.5,  wind: 0.18 },
    downpour: { label: 'Downpour',     rain: 0.88, thunder: 0.3,  music: 0.35, wind: 0.35 },
    storm:    { label: 'Thunderstorm', rain: 0.78, thunder: 0.85, music: 0.3,  wind: 0.55 },
    focus:    { label: 'Lo-fi focus',  rain: 0.42, thunder: 0.08, music: 0.75, wind: 0.06 },
  };
  const MIX = ['rain', 'thunder', 'music', 'wind'];
  const KEYS = [...MIX, 'volume'];
  const STORE = 'rainroom:v1';

  // Rainfall rate classes follow the AMS glossary: light < 2.5, moderate < 7.6, heavy < 50 mm/h
  const mmPerHour = v => (v <= 0.001 ? 0 : 0.3 * Math.pow(80 / 0.3, v));
  const rainClass = mm => (mm === 0 ? 'dry' : mm < 2.5 ? 'light' : mm < 7.6 ? 'moderate' : mm < 50 ? 'heavy' : 'violent');
  const fmtMm = mm => (mm === 0 ? '0 mm/h' : (mm < 10 ? mm.toFixed(1) : Math.round(mm)) + ' mm/h');
  const stormWord = v => (v < 0.01 ? 'off' : v < 0.3 ? 'distant' : v < 0.65 ? 'rolling' : 'overhead');
  const pct = v => Math.round(v * 100) + '%';

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } };
  let saveTimer;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify({ levels: state.levels, preset: state.preset })); } catch (e) { /* storage unavailable */ }
    }, 400);
  };

  const saved = load() || {};
  const state = {
    levels: Object.assign({ volume: 0.8 }, pickMix(PRESETS.steady), saved.levels),
    preset: saved.preset || 'steady',
    playing: false,
  };

  function pickMix(p) { const o = {}; for (const k of MIX) o[k] = p[k]; return o; }

  const audio = new RainAudio();
  Object.assign(audio.levels, state.levels);
  let scene = null;
  try {
    scene = new RainScene($('#scene'), $('#bolt'));
    scene.setParams(state.levels);
  } catch (e) {
    console.warn('WebGL unavailable, running audio only', e);
  }

  /* ---------- controls ---------- */
  const inputs = Object.fromEntries(KEYS.map(k => [k, $('#' + k)]));
  const outputs = Object.fromEntries(KEYS.map(k => [k, $('#' + k + 'Out')]));

  function renderControls(lv) {
    for (const k of KEYS) {
      const v = lv[k];
      inputs[k].value = Math.round(v * 100);
      inputs[k].style.setProperty('--fill', v * 100 + '%');
    }
    const mm = mmPerHour(lv.rain);
    outputs.rain.textContent = fmtMm(mm);
    outputs.thunder.textContent = stormWord(lv.thunder);
    outputs.music.textContent = pct(lv.music);
    outputs.wind.textContent = pct(lv.wind);
    outputs.volume.textContent = pct(lv.volume);
    $('#nowMeta').textContent = `${fmtMm(mm)} · ${rainClass(mm)}`;
  }

  function renderPreset() {
    $('#nowLabel').textContent = PRESETS[state.preset] ? PRESETS[state.preset].label : 'Your mix';
    $$('.presets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === state.preset));
  }

  const matchPreset = () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      if (MIX.every(k => Math.abs(p[k] - state.levels[k]) < 0.011)) return id;
    }
    return 'custom';
  };

  let tweenRaf = 0;
  function tween(from, to, ms) {
    cancelAnimationFrame(tweenRaf);
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = {};
      for (const key of KEYS) cur[key] = from[key] + (to[key] - from[key]) * e;
      renderControls(cur);
      if (k < 1) tweenRaf = requestAnimationFrame(step);
    };
    tweenRaf = requestAnimationFrame(step);
  }

  function setLevels(next, animate) {
    const from = { ...state.levels };
    state.levels = { ...state.levels, ...next };
    for (const k of Object.keys(next)) audio.setLevel(k, next[k]);
    if (scene) scene.setParams(state.levels);
    if (animate) tween(from, state.levels, 1200); else renderControls(state.levels);
    saveSoon();
  }

  function choosePreset(id) {
    state.preset = id;
    renderPreset();
    setLevels(pickMix(PRESETS[id]), true);
  }

  for (const k of KEYS) {
    inputs[k].addEventListener('input', () => {
      cancelAnimationFrame(tweenRaf);
      setLevels({ [k]: inputs[k].value / 100 }, false);
      if (k !== 'volume') { state.preset = matchPreset(); renderPreset(); }
    });
  }
  $$('.presets .chip').forEach(c => c.addEventListener('click', () => choosePreset(c.dataset.preset)));

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
    if (state.levels.thunder < 0.05) {
      setLevels({ thunder: 0.35 }, true);
      state.preset = matchPreset();
      renderPreset();
    }
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
    $$('.timer .chip').forEach(c => c.classList.toggle('active', +c.dataset.min === min));
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
  $$('.timer .chip').forEach(c => c.addEventListener('click', () => setFocus(+c.dataset.min)));

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
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
  ['pointermove', 'keydown'].forEach(ev => window.addEventListener(ev, poke, { passive: true }));

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, button') && e.key === ' ') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === 'l' || e.key === 'L') callStrike();
    else if (e.key === 'h' || e.key === 'H') toggleCollapse();
  });

  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Rainroom', artist: 'Generated rain, thunder and music' });
    navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
  } catch (e) { /* unsupported */ }

  renderControls(state.levels);
  renderPreset();
  setFocus(0);
})();
