# Rainroom

Generative rain, thunder, wind and lo-fi music for late-night study, with live Three.js rain and lightning.

Every sound is synthesized in the browser with the Web Audio API, so nothing loops and there are no audio files:

- **Rain**: pink-noise hiss and brown-noise body, shaped by intensity, plus individual drops scheduled as a Poisson process (filtered noise ticks, and bubble "plinks" for drops landing in puddles).
- **Thunder**: each strike is placed at a random distance. The flash appears at once and the rumble arrives about 2.9 s per km later, as it would outside. Close strikes add a crack and a sub-bass boom.
- **Wind**: band-passed noise with drifting gusts and a faint whistle.
- **Music**: a slow Dmaj9 → Bm9 → Gmaj9 → Em9 pad with a sub bass and sparse pentatonic keys through a dotted-eighth echo and a generated reverb.
- **Window**: rain heard through glass, with taps and drips on the pane. Raising it also muffles the outdoor rain, as if you were inside.
- **Mud**: squelches, pops, and now and then someone walking through it.
- **Traffic**: cars passing on a wet road, sweeping across the stereo field with tyre spray and a slight Doppler drop, over a low city rumble.
- **Keyboard**: typing in bursts with pauses, space bar included.

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
| D | Switch daylight / evening |

The panel has three tabs. **Mix** holds the presets (Drizzle, Steady rain, Downpour, Thunderstorm, City night, Lo-fi focus), rainfall, rain volume, music and master volume. **Sounds** has a tile per layer (thunder, wind, window, mud, traffic, keyboard): tap to toggle, slide to set its level. **Room** switches between daylight and evening, turns the desk lamp and street lamps on or off, and starts the focus timer.

The scene follows along: street lamps light the rain falling past them, the desk lamp warms the room, and the window layer puts drops on the glass that bead up, merge and run down. The focus timer (25/50/90 min) plays a soft chime when it ends. While playing, the page asks to keep the screen awake and dims the controls after 8 s without input. Your mix is saved in local storage.

## Files

- `js/audio.js`: the synthesis engine (`RainAudio`)
- `js/scene.js`: sky shader, GPU rain streaks and lightning bolts (`RainScene`)
- `js/app.js`: UI wiring, presets, timer, wake lock
- `style.css`, `index.html`

On iPhone, the ringer switch can mute web audio on older iOS versions. iOS 17+ honours the `audioSession` hint the app sets.
