# Lowpoly Time Sync Environment

A real-time low-poly 3D environment built with **Three.js** where sky lighting, sun and moon positions, moon phases, stars, the Milky Way, and procedural clouds all synchronize with the user's actual geographic location and time of day.

## Demonstration

![Full Day Cycle Demo](assets/gif/day-cycle.gif)

---

## What This Project Does

This website recreates the sky as it actually appears at your real-world location and time of day. It uses astronomy calculations to find the true position of the sun and moon in the sky, then renders lighting that transitions naturally between dawn, noon, dusk, and night. The moon displays its correct phase based on the current date. A full three-layer Milky Way (star points, dust blobs, and a galactic haze sphere) fades in during twilight synchronized to sky darkness. A time slider at the bottom of the screen lets you scrub to any hour of the day, jump forward or backward by a day, or reset to the current real-world time.

---

## Key Highlights

- Real astronomical sun and moon positioning
- Real-time sky lighting synced to user location
- Procedural three-layer Milky Way (stars, dust, and galactic haze)
- GLSL shaders for moon phases, sky gradients, and clouds
- Time-scrubbing UI to explore different times of day
- Physically accurate celestial sphere rotation using local sidereal time

---

## Live Demo

View the project here:
https://pun1th01.github.io/lowpoly-time-sync-environment/

---

## Screenshots

### Sunrise

![Sunrise](assets/screenshots/sunrise.png)

### Noon

![Noon](assets/screenshots/noon.png)

### Sunset

![Sunset](assets/screenshots/sunset.png)

### Night

![Night](assets/screenshots/night.png)

---

## Demo

Load the page and the scene immediately reflects your current time and location:

- The sun rises and sets along the correct solar path for the user's location and date
- The sky transitions through day, sunset, twilight, and night palettes
- Stars and a three-layer Milky Way appear during twilight, fading in smoothly with sky darkness
- The moon renders with its correct current phase and fades at the horizon
- Procedural clouds drift slowly across the sky dome

Use the time slider at the bottom to scrub through any hour of the day, or step through days to watch moon phases and seasonal sun angles change.

---

## Features

| Feature | Description |
|---|---|
| **Real sun positioning** | SunCalc computes altitude and azimuth from GPS coordinates and the current date/time |
| **Real moon positioning** | Moon positioned using real astronomical data from SunCalc; fades smoothly at the horizon |
| **Moon phases** | Per-pixel Lambertian shader driven by the real sun–moon angle; earthshine fills the dark limb; crescent, gibbous, and full moon all render correctly |
| **Dynamic sky colours** | Four-stage altitude blend: day → sunset → twilight → night, plus a warm horizon glow at sunrise/sunset |
| **Sky gradient dome** | Inverted sphere (radius 75 000) with a per-frame zenith/horizon GLSL gradient |
| **Procedural clouds** | 3-octave FBM value noise rendered in the sky dome fragment shader; drift rate tied to simulation hours so the slider visibly moves clouds |
| **Star field** | Up to ~18 000 stars distributed on a sphere using rejection sampling to maintain uniform angular density; Gaussian band density bias (~4× denser along galactic plane); per-star colour tinting (blue/purple in band, warm near galactic core); per-star twinkling via time-driven sinusoid; rotated using a proper celestial sphere hierarchy (latitude tilt → sidereal time → galactic tilt) |
| **Milky Way — dust layer** | 2 200 soft additive blobs with cubic elevation falloff (±8.6°); opacity boosted near galactic-core longitude; per-blob size variation breaks up uniformity |
| **Milky Way — haze sphere** | Inverted sphere at 97 % of star radius; 4-octave FBM fragment shader concentrated on the galactic equator; provides the continuous soft glow individual particles cannot produce |
| **Nebula / sky-darkness link** | `nebulaVisibility = pow(starVisibility, 1.5)` — dust and haze fade in more gradually than stars, matching natural sky behaviour |
| **Adaptive FOV** | Camera field of view widens automatically on portrait / narrow viewports to preserve the scene framing |
| **Geolocation** | Optional browser geolocation; falls back to Bangalore (12.97° N, 77.59° E) |
| **Time slider UI** | Glassmorphism panel; slider, ±Day buttons, and Reset; responsive layout for mobile |
| **Auto time advance** | Simulation clock advances 1 minute per real-world minute when the slider is idle; pauses for 10 s after any interaction |
| **Adaptive GPU rendering** | Automatically scales star density based on detected WebGL capability to maintain compatibility with low-end hardware while preserving full visual fidelity on modern devices |

---

## How It Works

### Sun & Moon Positioning

[SunCalc](https://github.com/mourner/suncalc) returns `altitude` (radians above the horizon) and `azimuth` (radians from south, westward) for any date/time/location.

These are converted to Three.js world-space Cartesian coordinates:

```
x = cos(altitude) * sin(azimuth)   // east/west
y = sin(altitude)                   // height
z = cos(altitude) * cos(azimuth)   // north/south
```

The sun and moon spheres are placed 50 000 units from the camera along their respective direction vectors, keeping them at a fixed angular size regardless of scene scale. The moon fades smoothly over the ±0.05 rad window at the horizon using a `uOpacity` uniform.

### Sky Gradient Shader

An inverted sphere (`THREE.BackSide`, radius 75 000) with a custom `ShaderMaterial`. The vertex shader computes `vWorldDir = normalize(modelMatrix * position)`. The fragment shader blends `horizonColor` and `zenithColor` uniforms using `smoothstep(0.0, 0.6, vWorldDir.y)`, producing a natural atmospheric gradient. Both uniforms are updated every frame from the 4-stage sky colour system.

### 4-Stage Sky Colour System

```
altitude > 0.3 rad  →  day blue
altitude > 0.0      →  lerp to sunset orange
altitude > -0.3     →  lerp to twilight purple
altitude ≤ -0.3     →  lerp to deep night navy
```

A warm amber horizon glow is blended in during the ±0.1 rad window around sunrise/sunset.

### Procedural Cloud Shader

Clouds live entirely inside the sky dome fragment shader — no additional geometry. A `hash → noise → 3-octave FBM` pipeline generates soft billowy shapes. The 2D UV is projected from the world direction:

```glsl
vec2 uv = vWorldDir.xz / (vWorldDir.y + 0.05);
uv *= 2.0;
uv += vec2(time * 0.3, time * 0.15);
```

The `time` uniform is `cloudSimOffset + realTime`, where `cloudSimOffset = hours * 5.0`. This means each hour on the slider produces a clearly visible cloud shift. Cloud colour is white in daylight, warm during sunset, and suppressed at night via a luminance check on `zenithColor`.

### Moon Phase Shader

The moon sphere uses a `ShaderMaterial`. The vertex shader transforms normals with `normalMatrix` (producing view-space normals). Each frame, the world-space vector from moon to sun is transformed into view space and passed as the `sunDirection` uniform. The fragment shader computes:

```glsl
float brightness = smoothstep(-0.05, 0.25, dot(N, L));
vec3 finalColor  = moonColor * (brightness + 0.12); // 0.12 = earthshine
```

This produces correct crescent, quarter, gibbous, and full moon appearances as the sun–moon angle changes across the synodic month. `SunCalc.getMoonIllumination()` drives the moon glow sprite opacity.

### Star Field

Up to 18 000 candidate positions are distributed uniformly on a sphere (radius 80 000) using rejection sampling. Acceptance probability is biased by a Gaussian function of equatorial distance (σ ≈ 28 % of sphere radius), producing a clearly visible Milky Way band at ~4× background density. Per-star attributes — size, brightness, twinkle phase offset, and RGB colour tint — are stored as `BufferGeometry` custom attributes. Stars in the band shift toward blue/purple; a smooth cosine brightness gradient centered on `CORE_THETA = 1.1` simulates the brighter galactic-centre region without clustering stars into a blob.

### Three-Layer Milky Way

The Milky Way is rendered by three additive layers inside a `starGroup` (fixed galactic-plane tilt `rotation.z = 0.6` rad). The group sits inside a three-level celestial sphere hierarchy — see [Celestial Sphere Orientation](#celestial-sphere-orientation) below for how rotation is driven:

1. **Star points** — the `Points` geometry described above; `starVisibility` uniform.
2. **Dust blobs** — 2 200 `Points` with large `gl_PointSize`; cubic elevation falloff concentrates >90 % of blobs within ±0.05 rad of the galactic plane; opacity peaks near CORE_THETA; uses `nebulaVisibility` uniform.
3. **Haze sphere** — inverted `SphereGeometry` at `starDistance * 0.97`; fragment shader applies a sharp Gaussian band (`exp(-lat² × 120)`) multiplied by a 4-octave FBM product, giving patchy continuous glow; uses `nebulaVisibility` uniform.

### Celestial Sphere Orientation

The star field and Milky Way use a three-level `Group` hierarchy so the galaxy moves across the sky without mirroring or flipping orientation:

```
latitudeGroup   rotation.x = π/2 − lat   tilts the celestial pole to the correct
                                          elevation above the horizon for the
                                          observer's latitude
    └ skyGroup  rotation.y = LST × π/12  rotates the sky by local sidereal time,
                                          aligning the star field with Earth's
                                          rotation relative to the celestial sphere
                                          (≈23h 56m per full rotation)
         └ starGroup  rotation.z = 0.6   fixed galactic-plane tilt that orients
                                          the Milky Way band diagonally
```

Local Sidereal Time (LST) is computed from the simulation timestamp each frame:

```js
const d    = (simulationTime - Date.UTC(2000, 0, 1, 12)) / 86400000; // days since J2000
const GMST = 18.697374558 + 24.06570982441908 * d;                   // Greenwich MST (hours)
const LST  = ((GMST + longitude / 15) % 24 + 24) % 24;              // local sidereal time
skyGroup.rotation.y = LST * Math.PI / 12;                            // convert to radians
```

Because the galactic tilt lives on `starGroup` (innermost) and the sidereal rotation lives on `skyGroup` (middle), the two transforms are applied in the correct order by Three.js matrix multiplication. Combining both rotations on a single object with Euler angles would cause the band orientation to mirror at certain hour angles.

### Nebula / Sky-Darkness Link

All three layers share a `starVisibility` factor derived from sun altitude:

```js
const starVis       = clamp((-altitude - 0.1) / 0.15, 0, 1);  // 0 at -6°, 1 at -14°
const nebulaVisibility = Math.pow(starVis, 1.5);
```

Stars use `starVis` directly. Dust and haze use `nebulaVisibility`, which is always ≤ `starVis`, so the nebula fades in more gradually during early twilight and reaches full brightness at the same moment stars do.

### Lighting

| Light | Type | Purpose |
|---|---|---|
| `dirLight` | `DirectionalLight` (white) | Sun; shadow frustum ±20 000 units; intensity × daylight factor |
| `moonLight` | `DirectionalLight` (0xaaccff) | Night fill; intensity from `sin(moonAltitude) × 0.25` |
| `ambientLight` | `AmbientLight` (white, 0.15 base) | Prevents fully black shadows |
| `skyAmbient` | `AmbientLight` (0x87a8c8) | Sky-scattered fill; scales with daylight factor |

### Time Synchronization

`setInterval` fires every 60 seconds and advances `simulationTime` by one minute, then calls `refreshSun()`. A `userControllingTime` flag suppresses auto-advance while the slider is being dragged, and clears automatically 10 seconds after the last interaction.

---

## Technologies

- [Three.js r160](https://threejs.org/) — 3D rendering, custom shaders, shadow maps
- [SunCalc 1.9.0](https://github.com/mourner/suncalc) — astronomical sun/moon calculations
- [GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader) — low-poly scene model
- Vanilla ES modules — no build step required
- [Blender](https://www.blender.org/) — all environment assets modeled, textured, and exported as GLB

---

## Installation

No npm, no build step — just a static file server.

**Prerequisites:** Python 3 (or any static file server)

```bash
# Clone the repository
git clone https://github.com/pun1th01/lowpoly-time-sync-environment.git
cd lowpoly-time-sync-environment

# Start a local server
python -m http.server 8000

# Open in browser
http://localhost:8000
```

> **Why a server?** Three.js ES modules and GLB loading require an HTTP context; opening `index.html` directly via `file://` will not work.

---

## Controls

| Control | Action |
|---|---|
| **Time slider** | Scrub to any minute of the current day |
| **− Day** | Step back one calendar day |
| **+ Day** | Step forward one calendar day |
| **Reset** | Return to the current real-world time |
| *(idle)* | Scene auto-advances 1 min per real-world minute |

---

## Project Structure

```
lowpoly-time-sync-environment/
│
├── index.html              # Entry point — ES module imports, SunCalc script tag
├── script.js               # All Three.js scene logic
│
├── assets/
│   ├── models/
│   │   └── scenery.glb     # Low-poly landscape (GLTF binary)
│   └── screenshots/        # Repository screenshots
│
├── README.md
├── LICENSE
└── .gitignore
```

### script.js section map

| Section | Lines (approx.) | Contents |
|---|---|---|
| Scene / Renderer / Camera | top | `PerspectiveCamera` with adaptive FOV, `WebGLRenderer` |
| Global State | — | `simulationTime`, `currentLat/Lon`, `cloudSimOffset` |
| Lighting | — | Sun dir light, moon fill light, ambient lights |
| Sky System | — | Sky dome shader (gradient + FBM clouds) |
| Celestial Bodies | — | Sun/moon spheres, glow sprites, phase shader |
| Star System | — | Star geometry, dust blobs, galactic haze sphere |
| Sun / Moon Positioning | — | `updateSunPosition()` — sky colour, star visibility, lighting |
| Model Loading | — | `loadEnvironmentModel()` via GLTFLoader |
| Geolocation | — | `initGeolocation()` with Bangalore fallback |
| Time Control UI | — | `buildTimeUI()` — glassmorphism panel, auto-advance |
| Animation Loop | — | `animate()` — dome tracking, uniform updates |
| Window Resize | — | Adaptive FOV + renderer resize |
| Startup | — | `loadEnvironmentModel`, `initGeolocation`, `buildTimeUI`, `animate` |

---

## Future Improvements

- [x] Mobile support — responsive layout and touch-friendly slider controls
- [x] Visual improvements — enhanced cloud detail, softer star glow, smoother horizon blending
- [x] Visual fixes — reduce sky banding at night, improve moon glow intensity scaling at different phases
- [ ] Region selector — allow users to explore the sky from different cities around the world
- [ ] Date change UI — allow users to change the calendar date to observe seasonal sky changes

---

## License

MIT — see [LICENSE](LICENSE) for details.
