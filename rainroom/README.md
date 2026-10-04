# Rainroom

Generative rain, thunder, wind and lo-fi music for late-night study, with live Three.js rain and lightning.

Every sound is synthesized in the browser with the Web Audio API, so nothing loops and there are no audio files:

- **Rain**: pink-noise hiss and brown-noise body, shaped by intensity, plus individual drops scheduled as a Poisson process (filtered noise ticks, and bubble "plinks" for drops landing in puddles).
- **Thunder**: each strike is placed at a random distance. The flash appears at once and the rumble arrives about 2.9 s per km later, as it would outside. Close strikes add a crack and a sub-bass boom.
- **Wind**: band-passed noise with drifting gusts and a faint whistle.
- **Music**: a slow Dmaj9 → Bm9 → Gmaj9 → Em9 pad with a sub bass and sparse pentatonic keys through a dotted-eighth echo and a generated reverb.

Rainfall is shown in mm/h, classed light / moderate / heavy / violent by AMS thresholds.

## Run

No build step. Serve the folder and open it:

```bash
cd rainroom
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js is vendored in `vendor/`, so it works offline once the page has loaded (the Google Fonts fall back to system fonts without a connection).

To bundle into a single HTML file (Three.js from cdnjs):

```bash
python3 tools/build_single.py   # -> dist/rainroom.html
```

## Controls

| Key | Action |
| --- | --- |
| Space | Play / pause |
| L | Call a lightning strike |
| H | Hide / show controls |

Presets: Drizzle, Steady rain, Downpour, Thunderstorm, Lo-fi focus. The focus timer (25/50/90 min) plays a soft chime when it ends. While playing, the page asks to keep the screen awake and dims the controls after 8 s without input. Your mix is saved in local storage.

## Files

- `js/audio.js`: the synthesis engine (`RainAudio`)
- `js/scene.js`: sky shader, GPU rain streaks and lightning bolts (`RainScene`)
- `js/app.js`: UI wiring, presets, timer, wake lock
- `style.css`, `index.html`

On iPhone, the ringer switch can mute web audio on older iOS versions. iOS 17+ honours the `audioSession` hint the app sets.
