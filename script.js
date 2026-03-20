import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// =============================================================================
// SCENE / RENDERER / CAMERA
// =============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const BASE_ASPECT = 16 / 9;
const BASE_FOV    = 60;
function getAdaptiveFOV(currentAspect) {
  if (currentAspect >= BASE_ASPECT) return BASE_FOV;
  return THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) / currentAspect)
  );
}

const camera = new THREE.PerspectiveCamera(
  getAdaptiveFOV(window.innerWidth / window.innerHeight),
  window.innerWidth / window.innerHeight,
  0.1,
  300000
);
camera.position.set(-8739.92602089462, 386.5566095975547, 1147.3684536708317);
camera.rotation.set(-1.0348500942949634, -1.4857159300233853, -1.0332577125278524);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// =============================================================================
// GLOBAL STATE
// =============================================================================

let simulationTime = new Date();
const FALLBACK_LOCATION = { name: 'Bangalore', lat: 12.9716, lon: 77.5946 };
const CITY_DATASET = [
  { name: 'Bangalore', country: 'India', lat: 12.9716, lon: 77.5946, tz: 'Asia/Kolkata' },
  { name: 'Mumbai', country: 'India', lat: 19.0760, lon: 72.8777, tz: 'Asia/Kolkata' },
  { name: 'Delhi', country: 'India', lat: 28.6139, lon: 77.2090, tz: 'Asia/Kolkata' },
  { name: 'New York', country: 'USA', lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
  { name: 'Los Angeles', country: 'USA', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  { name: 'Chicago', country: 'USA', lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  { name: 'London', country: 'UK', lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  { name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { name: 'Berlin', country: 'Germany', lat: 52.5200, lon: 13.4050, tz: 'Europe/Berlin' },
  { name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
  { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai' },
  { name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { name: 'Cape Town', country: 'South Africa', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  { name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo' },
  { name: 'São Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816, tz: 'America/Argentina/Buenos_Aires' }
];
const CITY_LOCATIONS = Object.fromEntries(
  CITY_DATASET.map((city) => [city.name, { lat: city.lat, lon: city.lon }])
);

let currentLat = FALLBACK_LOCATION.lat;
let currentLon = FALLBACK_LOCATION.lon;
let currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let geoLat = null;
let geoLon = null;
let geolocationGranted = false;
let locationMode = 'fallback'; // 'manual-city' | 'geolocation' | 'fallback'
let activeCityName = null;
let cloudSimOffset = 0; // hours-based offset so the slider visibly shifts cloud position
let controlsApi = null;
let pendingOverlayMessage = null;

const locationTransition = {
  active: false,
  startMs: 0,
  durationMs: 0,
  fromLat: currentLat,
  fromLon: currentLon,
  toLat: currentLat,
  toLon: currentLon
};

function notifyControlsLocation() {
  if (controlsApi && typeof controlsApi.updateLocationStatus === 'function') {
    controlsApi.updateLocationStatus();
  }
}

function notifyControlsOverlay(text) {
  if (controlsApi && typeof controlsApi.showOverlay === 'function') {
    controlsApi.showOverlay(text);
  } else {
    pendingOverlayMessage = text;
  }
}

function smoothstep01(t) {
  return t * t * (3 - 2 * t);
}

function startLocationTransition(nextLat, nextLon, durationMs = 1200) {
  locationTransition.active = true;
  locationTransition.startMs = performance.now();
  locationTransition.durationMs = durationMs;
  locationTransition.fromLat = currentLat;
  locationTransition.fromLon = currentLon;
  locationTransition.toLat = nextLat;
  locationTransition.toLon = nextLon;
}

function setLocationSource(mode, lat, lon, options = {}) {
  const { smooth = true, cityName = null } = options;
  locationMode = mode;
  activeCityName = cityName;

  if (smooth) {
    startLocationTransition(lat, lon, 1200);
  } else {
    locationTransition.active = false;
    currentLat = lat;
    currentLon = lon;
  }

  notifyControlsLocation();
  refreshSun();
}

function refreshSun() {
  updateSunPosition(currentLat, currentLon, simulationTime);
}

// =============================================================================
// LIGHTING
// =============================================================================

// Sun directional light — intensity driven per-frame by daylight factor.
// Shadow frustum set to ±20 000 units to cover the full scene scale.
const dirLight = new THREE.DirectionalLight(0xffffff, 0);
dirLight.castShadow = true;
dirLight.shadow.camera.near   = 1;
dirLight.shadow.camera.far    = 250000;
dirLight.shadow.camera.left   = -20000;
dirLight.shadow.camera.right  =  20000;
dirLight.shadow.camera.top    =  20000;
dirLight.shadow.camera.bottom = -20000;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);
scene.add(dirLight.target);

// Moon fill light — blue-tinted, night-only. Target must be in scene for
// direction to resolve correctly.
const moonLight = new THREE.DirectionalLight(0x8899ff, 0);
moonLight.target.position.set(0, 0, 0);
scene.add(moonLight);
scene.add(moonLight.target);

// Ambient base fill keeps the night scene from going pitch-black.
const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
scene.add(ambientLight);

// Sky-scattered light — intensity scales with the daylight factor.
const skyAmbient = new THREE.AmbientLight(0x87a8c8, 0);
scene.add(skyAmbient);

// =============================================================================
// SKY SYSTEM
// =============================================================================

// Inverted sphere rendered with a zenith/horizon gradient.
// Clouds are computed in the fragment shader using 3-octave FBM value noise;
// the time uniform is set from simulation hours so drift tracks the time slider.
const skyDomeGeo = new THREE.SphereGeometry(75000, 32, 16);
const skyDomeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    horizonColor: { value: new THREE.Color(0xa6d3f2) },
    zenithColor:  { value: new THREE.Color(0x4d8fbe) },
    time:         { value: 0.0 },
    cloudDensity: { value: 0.35 }
  },
  vertexShader: `
    varying vec3 vWorldDir;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldDir = normalize(worldPos.xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3  horizonColor;
    uniform vec3  zenithColor;
    uniform float time;
    uniform float cloudDensity;
    varying vec3  vWorldDir;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) +
             (c - a) * u.y * (1.0 - u.x) +
             (d - b) * u.x * u.y;
    }
    // 3-octave FBM for soft layered cloud shapes
    float fbm(vec2 p) {
      float v = 0.0, amp = 0.5;
      for (int i = 0; i < 3; i++) { v += amp * noise(p); p *= 2.1; amp *= 0.5; }
      return v;
    }

    void main() {
      // Zenith-to-horizon gradient
      float t = smoothstep(0.0, 0.6, clamp(vWorldDir.y, 0.0, 1.0));
      vec3 skyColor = mix(horizonColor, zenithColor, t);

      // Cloud layer — upper hemisphere only, perspective-projected UV
      float heightMask = smoothstep(0.0, 0.12, vWorldDir.y);
      vec2 uv = vWorldDir.xz / (vWorldDir.y + 0.05);
      uv *= 2.0;
      uv += vec2(time * 0.3, time * 0.15);

      float cloud = smoothstep(0.52, 0.72, fbm(uv)) * heightMask;

      // White in daylight, warm-tinted at sunset, faded at night
      vec3 cloudColor = mix(vec3(1.0), horizonColor * 1.4, 0.25);
      cloudColor *= clamp(dot(zenithColor, vec3(0.299, 0.587, 0.114)) * 6.0, 0.0, 1.0);

      gl_FragColor = vec4(mix(skyColor, cloudColor, cloud * cloudDensity), 1.0);
    }
  `
});
const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
skyDome.renderOrder = 0;
scene.add(skyDome);

// Sky background colour constants — blended each frame based on sun altitude
const skyDayColor      = new THREE.Color(0x87CEEB);
const skySunsetColor   = new THREE.Color(0xFF9966);
const skyTwilightColor = new THREE.Color(0x2E3A6B);
const skyNightColor    = new THREE.Color(0x0B1026);

// Pre-allocated scratch objects — avoid GC pressure in the per-frame update
const _sunToMoon        = new THREE.Vector3();
const _viewNormalMatrix = new THREE.Matrix3();
const _skyColor         = new THREE.Color();
const _horizonCol       = new THREE.Color();
const _zenithCol        = new THREE.Color();
const _zenithDeep       = new THREE.Color(0x1a3a5c);
const _horizonGlow      = new THREE.Color(0xffbb66);

// =============================================================================
// CELESTIAL BODIES
// =============================================================================

// Sun — self-lit sphere, always full brightness
const sunSphere = new THREE.Mesh(
  new THREE.SphereGeometry(900, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true })
);
sunSphere.scale.setScalar(1.25);
sunSphere.visible = false;
scene.add(sunSphere);

// Moon — ShaderMaterial renders the lunar phase by comparing view-space surface
// normals against the sun direction (also in view space). Lambertian dot product
// with a soft smoothstep terminator; earthshine fills the dark side faintly.
const moonMaterial = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: {
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    uOpacity:     { value: 1.0 }
  },
  vertexShader: `
    varying vec3 vWorldNormal;
    void main() {
      // normalMatrix gives view-space normals; sunDirection is passed in view space
      vWorldNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 sunDirection;
    uniform float uOpacity;
    varying vec3 vWorldNormal;
    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 L = normalize(sunDirection);
      float brightness = smoothstep(-0.05, 0.25, dot(N, L));
      float earthshine = 0.12; // keeps dark limb visible at twilight
      vec3 moonColor = vec3(0.85, 0.87, 0.92);
      gl_FragColor = vec4(moonColor * (brightness + earthshine), uOpacity);
    }
  `
});
const moonSphere = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 24), moonMaterial);
moonSphere.scale.setScalar(0.9);
scene.add(moonSphere);

// Glow sprites — radial-gradient canvas textures with additive blending
function makeGlowTexture(innerRGBA, outerRGBA) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0,    innerRGBA);
  g.addColorStop(0.35, outerRGBA);
  g.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const sunGlowMaterial = new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,255,200,1)', 'rgba(255,150,30,0.6)'),
  blending: THREE.AdditiveBlending,
  transparent: true,
  opacity: 0.65,
  depthWrite: false
});
const sunGlow = new THREE.Sprite(sunGlowMaterial);
sunGlow.scale.set(5500, 5500, 1);
sunGlow.visible = false;
scene.add(sunGlow);

const moonGlowMaterial = new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(221,230,255,1)', 'rgba(180,200,255,0.25)'),
  blending: THREE.AdditiveBlending,
  transparent: true,
  opacity: 0.28,
  depthWrite: false
});
const moonGlow = new THREE.Sprite(moonGlowMaterial);
moonGlow.scale.set(3200, 3200, 1);
moonGlow.visible = false;
scene.add(moonGlow);

// =============================================================================
// STAR SYSTEM
// =============================================================================

// ---------------------------------------------------------------------------
// getStarCount — inspect renderer capabilities and return the appropriate
// candidate-generation count for the rejection-sampling star loop.
// The rejection sampler keeps roughly 35–40 % of candidates, so the final
// rendered star count is lower than the number returned here.
// ---------------------------------------------------------------------------
function getStarCount(renderer) {
  const caps = renderer.capabilities;
  const isWebGL2        = caps.isWebGL2;           // true on modern GPUs
  const maxUniforms     = caps.maxVertexUniforms;  // low on old/integrated GPUs
  const maxAttributes   = caps.maxVertexAttribs;   // typically 16, older HW may have 8

  const isLow    = !isWebGL2 || maxUniforms < 1024 || maxAttributes < 12;
  const isMedium = !isLow && (maxUniforms < 4096 || !isWebGL2);

  if (isLow) {
    console.log('Sky Renderer Mode: LOW END — using reduced star count (2000)');
    return 2000;
  }
  if (isMedium) {
    console.log('Sky Renderer Mode: MEDIUM — using reduced star count (8000)');
    return 8000;
  }
  console.log('Sky Renderer Mode: HIGH — using full star count (18000)');
  return 18000;
}

const STAR_CANDIDATE_COUNT = getStarCount(renderer);

// Stars are placed on a sphere using rejection sampling.
// The Milky Way appears as a FULL RING spanning the whole sky dome, tilted by
// rotation.z so it runs diagonally. Density is controlled by a band Gaussian
// on the sphere's equatorial plane (y ≈ 0 after tilt). A smooth per-theta
// "core brightness" gradient makes one region of the arc slightly brighter
// without clustering stars into a blob.
const starDistance = 80000;
const CORE_THETA   = 1.1; // longitude of the brighter galactic-centre region
const starPositions  = [];
const starSizes      = [];
const starBrightness = [];
const starTwinkleOff = [];
const starColors     = [];

for (let i = 0; i < STAR_CANDIDATE_COUNT; i++) {
  // Uniform random point on sphere
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const x = starDistance * Math.sin(phi) * Math.cos(theta);
  const y = starDistance * Math.cos(phi);
  const z = starDistance * Math.sin(phi) * Math.sin(theta);

  // Band Gaussian: moderate σ = 28 % so the band is wide enough to look like
  // a strip, not a hairline. Density ratio ≈ 4× (band centre vs background).
  const band = Math.exp(-Math.pow(y / (starDistance * 0.28), 2) * 5.0);

  // Background accept 20 %, band centre ~100 % → clearly denser stripe
  if (Math.random() > 0.20 + band * 0.80) continue;

  starPositions.push(x, y, z);

  // Core brightness: smooth cosine falloff centered on CORE_THETA
  // Affects star size/brightness but NOT density — no clustering.
  const dTheta   = Math.abs(((theta - CORE_THETA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const coreFactor = band * Math.max(0, Math.cos(Math.min(dTheta / 1.2, Math.PI * 0.5)));

  const size = (Math.random() * 1.8 + 0.4) * (1.0 + band * 0.6 + coreFactor * 0.5);
  starSizes.push(size);
  starBrightness.push((size * 0.55 + 0.45) * (1.0 + band * 0.5 + coreFactor * 0.6));
  starTwinkleOff.push(Math.random() * Math.PI * 2);

  // Colour: blue/purple in band, warm orange-yellow near core region
  const blue = band * (0.4 + Math.random() * 0.4);
  const warm = coreFactor * (0.4 + Math.random() * 0.4);
  starColors.push(
    Math.min(1, 1.0 - blue * 0.18 + warm * 0.10),  // R
    Math.min(1, 1.0 - blue * 0.10 - warm * 0.05),  // G
    Math.min(1, 1.0 + blue * 0.28 - warm * 0.20)   // B
  );
}

const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position',      new THREE.Float32BufferAttribute(starPositions,  3));
starGeometry.setAttribute('size',          new THREE.Float32BufferAttribute(starSizes,       1));
starGeometry.setAttribute('brightness',    new THREE.Float32BufferAttribute(starBrightness,  1));
starGeometry.setAttribute('twinkleOffset', new THREE.Float32BufferAttribute(starTwinkleOff,  1));
starGeometry.setAttribute('starColor',     new THREE.Float32BufferAttribute(starColors,       3));

const starMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    time:           { value: 0 },
    starVisibility: { value: 0 }
  },
  vertexShader: `
    attribute float size;
    attribute float brightness;
    attribute float twinkleOffset;
    attribute vec3  starColor;
    varying float vBrightness;
    varying float vTwinkle;
    varying vec3  vColor;
    uniform float time;
    void main() {
      vBrightness = brightness;
      vTwinkle = sin(time * 1.5 + twinkleOffset) * 0.6 + 0.4;
      vColor = clamp(starColor, 0.0, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * 18.0 * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying float vBrightness;
    varying float vTwinkle;
    varying vec3  vColor;
    uniform float starVisibility;
    void main() {
      if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
      float intensity = vBrightness * vTwinkle * starVisibility * 1.35;
      gl_FragColor = vec4(vColor * intensity, intensity);
    }
  `
});

// ── Milky Way dust / nebula layer ─────────────────────────────────────────────
// 2200 overlapping soft blobs spread around the full galactic band. Per-particle
// size variation breaks up uniformity so the band looks like natural cloud
// structure rather than a grid of identical dots.
const dustPositions  = [];
const dustOpacities  = [];
const dustSizes      = [];

for (let i = 0; i < 2200; i++) {
  // phi: full azimuth — particles wrap all the way around the sky dome
  const phi = Math.random() * Math.PI * 2;
  // elev: elevation angle from the galactic plane.
  // Cubic falloff (t^3) concentrates >90% of particles within ±0.05 rad of
  // the plane, with a long but sparse tail out to ±0.15 rad — forming a thin
  // bright core with soft diffuse edges, not a uniform cloud.
  const t    = (Math.random() - 0.5) * 2.0;  // uniform [-1, 1]
  const elev = t * t * t * 0.15;              // cubic → max ±0.15 rad (≈±8.6°)

  dustPositions.push(
    starDistance * Math.cos(elev) * Math.cos(phi),
    starDistance * Math.sin(elev),
    starDistance * Math.cos(elev) * Math.sin(phi)
  );
  // Smooth opacity boost near the galactic core longitude
  const dPhi     = Math.abs(((phi - CORE_THETA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const corePulse = Math.max(0, Math.cos(Math.min(dPhi / 1.2, Math.PI * 0.5)));
  const variation = 0.5 + Math.random() * 0.5;  // 0.5–1.0× brightness modulation
  dustOpacities.push((0.02 + Math.random() * 0.02 + corePulse * 0.01) * variation);
  // Size variation: 0.7–1.3× base so blobs differ visually
  dustSizes.push(1800.0 * (0.7 + Math.random() * 0.6));
}

const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position',    new THREE.Float32BufferAttribute(dustPositions, 3));
dustGeometry.setAttribute('dustOpacity', new THREE.Float32BufferAttribute(dustOpacities, 1));
dustGeometry.setAttribute('dustSize',    new THREE.Float32BufferAttribute(dustSizes,     1));

const dustMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { starVisibility: { value: 0 } },
  vertexShader: `
    attribute float dustOpacity;
    attribute float dustSize;
    varying float vDustOpacity;
    void main() {
      vDustOpacity = dustOpacity;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = dustSize * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform float starVisibility;
    varying float vDustOpacity;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      float alpha = smoothstep(0.55, 0.10, d) * vDustOpacity * starVisibility;
      gl_FragColor = vec4(0.70, 0.76, 1.0, alpha);
    }
  `
});

const starGroup = new THREE.Group();
starGroup.rotation.z = 0.6; // tilt so Milky Way band runs diagonally across sky
starGroup.renderOrder = 1;

// ── Galactic haze mesh ────────────────────────────────────────────────────────
// A large sphere slightly inside the star sphere whose fragment shader generates
// FBM noise concentrated around the equatorial plane (y ≈ 0 in local space).
// This provides the continuous soft-glow background that individual particles
// cannot produce on their own. Additive blending keeps it purely additive.
const hazeMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
  uniforms: { starVisibility: { value: 0 } },
  vertexShader: `
    varying vec3 vLocalPos;
    void main() {
      vLocalPos   = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float starVisibility;
    varying vec3 vLocalPos;

    // Cheap 2-D hash for FBM noise
    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 17.5);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i),          hash(i + vec2(1,0)), u.x),
                 mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 dir = normalize(vLocalPos);
      // Galactic latitude — dir.y is elevation from the equatorial plane
      float lat  = abs(dir.y);
      // Sharp Gaussian band: only visible within ±0.18 rad of plane
      float band = exp(-lat * lat * 120.0);
      // FBM noise on azimuth × patchy vertical offset
      vec2 uv    = vec2(atan(dir.z, dir.x) * 0.8, dir.y * 6.0);
      float haze = fbm(uv * 2.5) * fbm(uv * 0.9 + 1.7);
      float alpha = band * haze * 0.045 * starVisibility;
      gl_FragColor = vec4(0.68, 0.74, 1.0, alpha);
    }
  `
});
const hazeSphere = new THREE.Mesh(
  new THREE.SphereGeometry(starDistance * 0.97, 48, 24),
  hazeMaterial
);
starGroup.add(hazeSphere);              // rendered before dust and star points
// ─────────────────────────────────────────────────────────────────────────────

starGroup.add(new THREE.Points(dustGeometry,  dustMaterial));  // dust behind stars
starGroup.add(new THREE.Points(starGeometry,  starMaterial));

// Rotation hierarchy for a correct celestial sphere:
//   latitudeGroup  — tilts the pole to the correct elevation for the observer
//   └ skyGroup     — rotates the whole sky by local sidereal time (LST)
//        └ starGroup — fixed galactic-plane tilt (rotation.z = 0.6)
const skyGroup = new THREE.Group();
skyGroup.add(starGroup);

const latitudeGroup = new THREE.Group();
latitudeGroup.add(skyGroup);
scene.add(latitudeGroup);

// =============================================================================
// SUN / MOON POSITIONING
// =============================================================================

// SunCalc.getPosition() returns altitude (rad above horizon) and azimuth (rad
// from south, measured westward). Convert to Cartesian (Three.js Y-up):
//   x = cos(alt)*sin(az),  y = sin(alt),  z = cos(alt)*cos(az)
function updateSunPosition(lat, lon, date = new Date()) {
  const sunPos = SunCalc.getPosition(date, lat, lon);
  const { altitude, azimuth } = sunPos;

  const sunDir = new THREE.Vector3(
    Math.cos(altitude) * Math.sin(azimuth),
    Math.sin(altitude),
    Math.cos(altitude) * Math.cos(azimuth)
  ).normalize();

  // Sun directional light
  const lightDistance = 50000;
  dirLight.position.set(sunDir.x * lightDistance, sunDir.y * lightDistance, sunDir.z * lightDistance);
  dirLight.target.position.set(0, 0, 0);
  dirLight.target.updateMatrixWorld();

  // Moon direction from SunCalc (real orbital position)
  const moonPos = SunCalc.getMoonPosition(date, lat, lon);
  const moonDir = new THREE.Vector3(
    Math.cos(moonPos.altitude) * Math.sin(moonPos.azimuth),
    Math.sin(moonPos.altitude),
    Math.cos(moonPos.altitude) * Math.cos(moonPos.azimuth)
  ).normalize();

  // Place sun and moon spheres on a 50 000-unit sky sphere around the camera
  const SKY_DISTANCE = 50000;
  sunSphere.position.copy(camera.position).addScaledVector(sunDir, SKY_DISTANCE);
  sunSphere.position.y -= 150;
  moonSphere.position.copy(camera.position).addScaledVector(moonDir, SKY_DISTANCE);
  moonSphere.position.y -= 150;

  // Moon phase: normalMatrix produces view-space normals, so sunDirection must
  // also be in view space. Transform world-space moon→sun through the view matrix.
  _sunToMoon.subVectors(sunSphere.position, moonSphere.position).normalize();
  moonMaterial.uniforms.sunDirection.value
    .copy(_sunToMoon)
    .applyMatrix3(_viewNormalMatrix.getNormalMatrix(camera.matrixWorldInverse))
    .normalize();

  // Sun light colour: warm orange at horizon → white at noon
  const horizonFactor = THREE.MathUtils.clamp((altitude + 0.1) / 0.6, 0, 1);
  dirLight.color.setRGB(1.0, 0.75 + horizonFactor * 0.25, 0.5 + horizonFactor * 0.5);

  // Moon horizon fade — smooth 0→1 over altitude range [-0.05, 0.05]
  const FADE_START = 0.05;
  const FADE_END   = -0.05;
  const moonOpacity = THREE.MathUtils.clamp(
    (moonPos.altitude - FADE_END) / (FADE_START - FADE_END), 0, 1
  );
  moonMaterial.uniforms.uOpacity.value = moonOpacity;
  moonSphere.visible = moonOpacity > 0.01;
  moonGlow.visible   = moonOpacity > 0.01;

  // Glow halos — sun scale expands near the horizon; moon opacity scales with phase
  const sunOpacity = THREE.MathUtils.clamp((altitude - FADE_END) / (FADE_START - FADE_END), 0, 1);
  sunSphere.material.opacity = sunOpacity;
  sunSphere.visible = sunOpacity > 0.01;
  sunGlow.position.copy(sunSphere.position);
  sunGlow.visible = sunOpacity > 0.01;
  sunGlowMaterial.opacity = sunOpacity;
  const glowScale = 3500 + (1 - horizonFactor) * 2000;
  sunGlow.scale.set(glowScale, glowScale, 1);
  moonGlow.position.copy(moonSphere.position);
  moonGlowMaterial.opacity = SunCalc.getMoonIllumination(date).fraction * 0.4 * moonOpacity;

  // Daylight factor: reaches 1.0 at ~43° altitude, stays high through afternoon
  const daylight = THREE.MathUtils.clamp((altitude + 0.15) / 0.9, 0, 1);
  dirLight.intensity     = 1.25 * daylight;
  ambientLight.intensity = 0.35 * daylight + 0.05;
  skyAmbient.intensity   = 0.3  * daylight;

  // Clamp dirLight Y so it never shines up through the terrain
  if (dirLight.position.y < 1) dirLight.position.y = 1;

  // Moon fill light — night only
  moonLight.color.set(0xaaccff);
  moonLight.position.copy(moonDir).multiplyScalar(50000);
  moonLight.target.position.set(0, 0, 0);
  moonLight.target.updateMatrixWorld();
  moonLight.intensity = altitude < 0 ? Math.max(0, Math.sin(moonPos.altitude)) * 0.25 : 0;

  // Sky background — 4-stage altitude blend
  if (altitude > 0.3) {
    _skyColor.copy(skyDayColor);
  } else if (altitude > 0.0) {
    _skyColor.copy(skyDayColor).lerp(skySunsetColor, (0.3 - altitude) / 0.3);
  } else if (altitude > -0.3) {
    _skyColor.copy(skySunsetColor).lerp(skyTwilightColor, -altitude / 0.3);
  } else {
    _skyColor.copy(skyTwilightColor).lerp(skyNightColor, Math.min((-0.3 - altitude) / 0.4, 1));
  }
  if (altitude > -0.1 && altitude < 0.1) {
    _skyColor.lerp(_horizonGlow, (1 - Math.abs(altitude) * 10) * 0.2);
  }
  scene.background = _skyColor;

  // Sky dome gradient uniforms
  _horizonCol.copy(_skyColor);
  _zenithCol.copy(_skyColor).lerp(_zenithDeep, 0.55);
  skyDomeMat.uniforms.horizonColor.value.copy(_horizonCol);
  skyDomeMat.uniforms.zenithColor.value.copy(_zenithCol);

  // Stars fade in during twilight (-6° to -14°)
  const starVis = THREE.MathUtils.clamp((-altitude - 0.1) / 0.15, 0, 1);
  const nebulaVisibility = Math.pow(starVis, 1.5);
  starMaterial.uniforms.starVisibility.value = starVis;
  dustMaterial.uniforms.starVisibility.value  = nebulaVisibility;
  hazeMaterial.uniforms.starVisibility.value  = nebulaVisibility;

  // Star/galaxy rotation driven by local sidereal time so the Milky Way band
  // moves naturally with Earth's rotation and never flips.
  const d = (simulationTime - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const GMST = 18.697374558 + 24.06570982441908 * d;
  const LST = ((GMST + lon / 15) % 24 + 24) % 24;
  skyGroup.rotation.y = LST * Math.PI / 12;

  // Tilt the celestial sphere so the north pole sits at the correct elevation
  // above the horizon for the observer's latitude.
  // At 90°N → tilt = 0 (pole at zenith); at 0° → tilt = PI/2 (pole at horizon).
  latitudeGroup.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(lat);

  // Cloud offset driven by sim hours; large enough that each hour of slider movement is clearly visible
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  cloudSimOffset = hours * 5.0;
}

// =============================================================================
// MODEL LOADING
// =============================================================================

function loadEnvironmentModel() {
  const loader = new GLTFLoader();
  loader.load(
    'assets/models/scenery.glb',
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      model.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat) => {
            if (mat.roughness !== undefined) mat.roughness = 0.85;
            if (mat.metalness !== undefined) mat.metalness = 0.0;
          });
        }
      });
      scene.add(model);
    },
    (xhr) => console.log(`Loading: ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
    (err) => console.error('Failed to load model:', err)
  );
}

// =============================================================================
// GEOLOCATION
// =============================================================================

function initGeolocation() {
  // Render immediately with fallback so celestial objects never sit in a neutral/incorrect default pose.
  setLocationSource('fallback', FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, {
    smooth: false,
    cityName: FALLBACK_LOCATION.name
  });

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoLat = pos.coords.latitude;
      geoLon = pos.coords.longitude;
      geolocationGranted = true;
      currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log('Geolocation acquired — Lat:', geoLat, 'Lon:', geoLon);

      if (locationMode !== 'manual-city') {
        setLocationSource('geolocation', geoLat, geoLon, { smooth: true, cityName: null });
      } else {
        notifyControlsLocation();
      }
    },
    (err) => {
      console.warn('Geolocation denied:', err.message);
      geolocationGranted = false;
      geoLat = null;
      geoLon = null;
      currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      if (locationMode !== 'manual-city') {
        setLocationSource('fallback', FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, {
          smooth: true,
          cityName: FALLBACK_LOCATION.name
        });
        notifyControlsOverlay(`Using Default Location: ${FALLBACK_LOCATION.name}`);
      } else {
        notifyControlsLocation();
      }
    }
  );
}

// =============================================================================
// TIME CONTROL UI
// =============================================================================

function buildTimeUI() {
  // Tracks whether the user is manually operating the slider.
  // Auto-advance is suppressed while true, and resumes 10 s after last interaction.
  let userControllingTime = false;
  let userInteractionTimeout;
  const style = document.createElement('style');
  style.textContent = `
    html, body {
      overflow-x: hidden;
    }

    #time-controls {
      position: fixed;
      bottom: 22px;
      left: max(10px, calc(50% - 480px));
      right: max(10px, calc(50% - 480px));
      display: grid;
      gap: 12px;
      padding: 14px;
      width: auto;
      background:
        linear-gradient(135deg, rgba(112, 165, 203, 0.16), rgba(52, 89, 120, 0.06)),
        rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px) saturate(140%);
      -webkit-backdrop-filter: blur(12px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 18px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      color: #fff;
      font-family: 'Segoe UI', 'Trebuchet MS', sans-serif;
      font-size: 13px;
      user-select: none;
      z-index: 110;
      box-sizing: border-box;
      overflow: visible;
      transition: transform 180ms ease, box-shadow 220ms ease, border-color 220ms ease;
    }
    #time-controls:hover {
      border-color: rgba(255, 255, 255, 0.26);
      box-shadow: 0 22px 56px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.32);
      transform: translateY(-1px);
    }
    #time-controls .top-row,
    #time-controls .bottom-row {
      display: grid;
      gap: 10px;
      align-items: center;
    }
    #time-controls .top-row {
      grid-template-columns: 1.6fr 1fr 1fr;
    }
    #time-controls .bottom-row {
      grid-template-columns: auto 1fr auto auto;
    }
    #time-controls .control-group {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    #time-controls .control-label {
      font-size: 11px;
      letter-spacing: 0.06em;
      opacity: 0.92;
      text-transform: uppercase;
      font-weight: 600;
      color: #f2f7ff;
    }

    #time-controls .control-stack {
      position: relative;
      min-width: 0;
      overflow: visible;
    }

    #time-controls button,
    #time-controls input,
    #time-controls .field-shell {
      height: 38px;
      border-radius: 10px;
      border: 1px solid rgba(226, 241, 255, 0.28);
      background: rgba(255, 255, 255, 0.12);
      color: #f4f8ff;
      outline: none;
      transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
      box-sizing: border-box;
    }

    #time-controls button {
      padding: 0 14px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }
    #time-controls button:hover,
    #time-controls .field-shell:hover,
    #time-controls input[type="number"]:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.42);
      transform: translateY(-1px);
    }

    #time-controls button:focus-visible,
    #time-controls .field-shell:focus-visible,
    #time-controls input:focus-visible {
      border-color: rgba(182, 224, 255, 0.9);
      box-shadow: 0 0 0 2px rgba(104, 176, 255, 0.33);
    }

    #time-controls input[type="number"] {
      width: 100%;
      padding: 0 10px;
      font-size: 13px;
      font-family: inherit;
    }

    #time-controls input[type="number"] {
      background: rgba(255, 255, 255, 0.12);
    }

    #time-controls .glass-trigger {
      width: 100%;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-radius: 10px;
      border: 1px solid rgba(226, 241, 255, 0.28);
      background: rgba(255, 255, 255, 0.12);
      color: #f8fbff;
      text-align: left;
      padding: 0 12px;
    }

    #time-controls .glass-trigger .chevron {
      font-size: 12px;
      opacity: 0.9;
      transform-origin: 50% 50%;
      transition: transform 180ms ease;
    }

    #time-controls .control-stack.open .glass-trigger .chevron {
      transform: rotate(180deg);
    }

    #time-controls .glass-dropdown,
    #time-controls .glass-calendar {
      position: absolute;
      top: calc(100% + 8px);
      bottom: auto;
      left: 0;
      right: 0;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(10, 18, 30, 0.84);
      backdrop-filter: blur(12px) saturate(135%);
      -webkit-backdrop-filter: blur(12px) saturate(135%);
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.45);
      z-index: 9999;
      opacity: 0;
      transform: translateY(10px) scale(0.95);
      pointer-events: none;
      transition: all 0.2s ease;
    }

    #time-controls .glass-dropdown {
      z-index: 10000;
    }

    #time-controls .control-stack.open > .glass-dropdown,
    #time-controls .control-stack.open > .glass-calendar {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    #time-controls .glass-dropdown.open,
    #time-controls .glass-calendar.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    #time-controls .control-stack.open-up > .glass-dropdown,
    #time-controls .control-stack.open-up > .glass-calendar {
      top: auto;
      bottom: calc(100% + 8px);
      transform: translateY(-10px) scale(0.95);
    }

    #time-controls .control-stack.open.open-up > .glass-dropdown,
    #time-controls .control-stack.open.open-up > .glass-calendar {
      transform: translateY(0) scale(1);
    }

    #time-controls .glass-option {
      width: 100%;
      height: 36px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #f7fbff;
      text-align: left;
      padding: 0 12px;
      font-weight: 500;
      cursor: pointer;
    }

    #time-controls .glass-option:hover {
      background: rgba(161, 207, 255, 0.2);
      transform: none;
    }

    #time-controls .glass-option.is-selected {
      background: rgba(130, 191, 255, 0.32);
      color: #ffffff;
    }

    #time-controls .glass-dropdown {
      padding: 8px;
      display: grid;
      gap: 4px;
      max-height: 250px;
      overflow-y: auto;
      scroll-behavior: smooth;
    }

    #time-controls .glass-calendar {
      width: min(320px, calc(100vw - 28px));
      right: auto;
      padding: 10px;
    }

    #time-controls .calendar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    #time-controls .calendar-nav {
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.08);
      color: #f7fbff;
    }

    #time-controls .calendar-title {
      font-size: 13px;
      font-weight: 700;
      color: #f7fbff;
      letter-spacing: 0.02em;
    }

    #time-controls .calendar-weekdays,
    #time-controls .calendar-days {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 4px;
    }

    #time-controls .calendar-weekday {
      font-size: 11px;
      color: rgba(240, 247, 255, 0.72);
      text-align: center;
      padding: 4px 0;
      font-weight: 600;
    }

    #time-controls .calendar-day {
      width: 100%;
      height: 32px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #f5faff;
      padding: 0;
      font-size: 12px;
      font-weight: 600;
    }

    #time-controls .calendar-day.muted {
      color: rgba(200, 215, 232, 0.45);
    }

    #time-controls .calendar-day.selected-day {
      background: rgba(143, 204, 255, 0.4);
      border-color: rgba(208, 236, 255, 0.8);
      color: #ffffff;
    }

    #time-controls .calendar-day:hover {
      background: rgba(161, 207, 255, 0.2);
      transform: none;
    }

    #time-controls #time-slider {
      width: 100%;
      accent-color: #ffd47a;
      cursor: pointer;
      height: 10px;
      padding: 0;
      border: none;
      background: transparent;
      transform: none;
    }
    #time-controls #time-slider:hover {
      background: transparent;
      border: none;
      transform: none;
    }

    #time-controls #time-container {
      min-width: 160px;
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      box-sizing: border-box;
    }
    #time-controls #user-time {
      text-align: left;
      font-weight: 700;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    #time-controls #city-time {
      text-align: right;
      font-size: 12px;
      opacity: 0.85;
      font-weight: 600;
      white-space: nowrap;
    }
    #time-controls #location-status {
      grid-column: 1 / -1;
      font-size: 11px;
      opacity: 0.86;
      letter-spacing: 0.02em;
      min-height: 14px;
      color: #ecf5ff;
    }

    #time-controls #btn-reset {
      background: rgba(255, 198, 137, 0.2);
      border-color: rgba(255, 225, 170, 0.42);
    }
    #time-controls #btn-reset:hover {
      background: rgba(255, 212, 148, 0.3);
    }

    #time-controls #btn-prev-day,
    #time-controls #btn-next-day {
      min-width: 76px;
    }

    @media (max-width: 980px) {
      #time-controls .top-row {
        grid-template-columns: 1fr 1fr;
      }
      #time-controls .bottom-row {
        grid-template-columns: auto 1fr auto;
      }
      #time-controls #btn-reset {
        grid-column: 1 / -1;
      }
    }

    #time-controls #sheet-handle {
      display: none;
    }

    #city-overlay {
      position: fixed;
      top: 20%;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #ffffff;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      opacity: 0;
      pointer-events: none;
      z-index: 140;
      transition: opacity 0.35s ease;
      white-space: nowrap;
    }

    #city-overlay.show {
      opacity: 1;
    }

    @media (max-width: 600px) {
      #time-controls {
        left: 10px;
        right: 10px;
        bottom: 10px;
        width: auto;
        max-height: 96px;
        padding: 10px 12px 12px;
        gap: 9px;
        border-radius: 14px;
        overflow: hidden;
        transition: all 0.3s ease;
      }
      #time-controls #sheet-handle {
        display: block;
        width: 54px;
        height: 5px;
        margin: 0 auto 4px;
        border-radius: 999px;
        background: rgba(236, 245, 255, 0.5);
      }
      #time-controls.collapsed .top-row {
        grid-template-columns: 1fr auto;
        gap: 8px;
      }
      #time-controls.collapsed .top-row .control-group:nth-child(2),
      #time-controls.collapsed .top-row .control-group:nth-child(3),
      #time-controls.collapsed #location-status,
      #time-controls.collapsed #btn-prev-day,
      #time-controls.collapsed #btn-next-day,
      #time-controls.collapsed #btn-reset {
        display: none;
      }
      #time-controls.collapsed .bottom-row {
        grid-template-columns: 1fr;
      }
      #time-controls.collapsed #time-slider {
        margin-top: -2px;
      }
      #time-controls.expanded {
        max-height: 70vh;
        overflow-y: auto;
        overflow-x: visible;
      }
      #time-controls .top-row,
      #time-controls .bottom-row {
        grid-template-columns: 1fr;
      }
      #time-controls button,
      #time-controls input,
      #time-controls .field-shell,
      #time-controls .glass-trigger {
        height: 42px;
      }
      #time-controls .glass-calendar {
        width: 100%;
      }
      #time-controls #time-container {
        min-width: unset;
        padding: 0;
      }
      #time-controls #btn-prev-day,
      #time-controls #btn-next-day,
      #time-controls #btn-reset {
        width: 100%;
      }
    }

    @media (max-width: 768px) {
      #time-controls #calendar-popover {
        position: fixed;
        left: 50%;
        top: 45%;
        bottom: auto;
        right: auto;
        width: min(92vw, 360px);
        max-height: 80vh;
        overflow-y: auto;
        padding-bottom: env(safe-area-inset-bottom);
        transform: translate(-50%, -50%) scale(0.95);
        z-index: 9999;
      }

      #time-controls #date-stack.open > #calendar-popover {
        transform: translate(-50%, -50%) scale(1);
      }

      #time-controls #date-stack.open-up > #calendar-popover,
      #time-controls #date-stack.open.open-up > #calendar-popover {
        top: 45%;
        bottom: auto;
        transform: translate(-50%, -50%) scale(1);
      }

      #time-controls .calendar-days,
      #time-controls .calendar-weekdays {
        gap: 6px;
      }

      #time-controls .calendar-day {
        height: 32px;
        font-size: 12px;
      }

      #time-controls .glass-dropdown {
        max-height: 200px;
        overflow-y: auto;
        left: 0;
        right: auto;
      }
    }
  `;
  document.head.appendChild(style);

  let cityOverlayEl = document.getElementById('city-overlay');
  if (!cityOverlayEl) {
    cityOverlayEl = document.createElement('div');
    cityOverlayEl.id = 'city-overlay';
    cityOverlayEl.className = 'city-overlay';
    document.body.appendChild(cityOverlayEl);
  }

  const panel = document.createElement('div');
  panel.id = 'time-controls';
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div class="top-row">
      <label class="control-group">
        <span class="control-label">City</span>
        <div class="control-stack" id="city-stack">
          <button id="city-trigger" class="glass-trigger" type="button" aria-expanded="false">
            <span id="city-label">Use My Location</span>
            <span class="chevron">▼</span>
          </button>
          <div id="city-menu" class="glass-dropdown" role="listbox"></div>
        </div>
      </label>
      <label class="control-group">
        <span class="control-label">Date</span>
        <div class="control-stack" id="date-stack">
          <button id="date-trigger" class="glass-trigger" type="button" aria-expanded="false">
            <span id="date-label">Select date</span>
            <span class="chevron">▼</span>
          </button>
          <div id="calendar-popover" class="glass-calendar">
            <div class="calendar-head">
              <button id="cal-prev" class="calendar-nav" type="button">◀</button>
              <div style="display:flex; gap:8px;">
                <div class="control-stack" id="month-stack">
                  <button id="month-trigger" class="glass-trigger" type="button">
                    <span id="month-label"></span>
                    <span class="chevron">▼</span>
                  </button>
                  <div id="month-menu" class="glass-dropdown"></div>
                </div>

                <div class="control-stack" id="year-stack">
                  <button id="year-trigger" class="glass-trigger" type="button">
                    <span id="year-label"></span>
                    <span class="chevron">▼</span>
                  </button>
                  <div id="year-menu" class="glass-dropdown"></div>
                </div>
              </div>
              <button id="cal-next" class="calendar-nav" type="button">▶</button>
            </div>
            <div class="calendar-weekdays">
              <div class="calendar-weekday">Su</div>
              <div class="calendar-weekday">Mo</div>
              <div class="calendar-weekday">Tu</div>
              <div class="calendar-weekday">We</div>
              <div class="calendar-weekday">Th</div>
              <div class="calendar-weekday">Fr</div>
              <div class="calendar-weekday">Sa</div>
            </div>
            <div id="calendar-days" class="calendar-days"></div>
          </div>
        </div>
      </label>
      <label class="control-group">
        <span class="control-label">Time</span>
        <div id="time-container">
          <div id="user-time"></div>
          <div id="city-time"></div>
        </div>
      </label>
    </div>
    <div class="bottom-row">
      <button id="btn-prev-day">&#8722; Day</button>
      <input type="range" id="time-slider" min="0" max="1439" step="1" />
      <button id="btn-next-day">&#43; Day</button>
      <button id="btn-reset">Reset</button>
    </div>
    <div id="location-status"></div>
  `;
  document.body.appendChild(panel);

  const pad = (n) => String(n).padStart(2, '0');

  const userTimeEl = document.getElementById('user-time');
  const cityTimeEl = document.getElementById('city-time');
  const dateLabelEl = document.getElementById('date-label');
  const locationStatusEl = document.getElementById('location-status');
  const cityStackEl = document.getElementById('city-stack');
  const cityTriggerEl = document.getElementById('city-trigger');
  const cityLabelEl = document.getElementById('city-label');
  const cityMenuEl = document.getElementById('city-menu');
  const dateStackEl = document.getElementById('date-stack');
  const dateTriggerEl = document.getElementById('date-trigger');
  const calendarDaysEl = document.getElementById('calendar-days');
  const calPrevEl = document.getElementById('cal-prev');
  const calNextEl = document.getElementById('cal-next');
  const monthStackEl = document.getElementById('month-stack');
  const monthTriggerEl = document.getElementById('month-trigger');
  const monthLabelEl = document.getElementById('month-label');
  const monthMenuEl = document.getElementById('month-menu');
  const yearStackEl = document.getElementById('year-stack');
  const yearTriggerEl = document.getElementById('year-trigger');
  const yearLabelEl = document.getElementById('year-label');
  const yearMenuEl = document.getElementById('year-menu');
  const sheetHandleEl = document.getElementById('sheet-handle');
  const sliderEl = document.getElementById('time-slider');
  const isMobileSheetMedia = window.matchMedia('(max-width: 600px)');

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  monthMenuEl.innerHTML = monthNames.map((m, i) =>
    `<button class="glass-option" type="button" data-month="${i}">${m}</button>`
  ).join('');

  const years = [];
  for (let y = 2000; y <= 2035; y++) {
    years.push(`<button class="glass-option" type="button" data-year="${y}">${y}</button>`);
  }
  yearMenuEl.innerHTML = years.join('');

  let calendarViewYear = simulationTime.getFullYear();
  let calendarViewMonth = simulationTime.getMonth();
  let isSheetExpanded = false;
  let sheetTouchStartY = null;
  let overlayTimerIn = null;
  let overlayTimerOut = null;
  let isMonthOpen = false;
  let isYearOpen = false;

  monthMenuEl.classList.remove('open');
  yearMenuEl.classList.remove('open');

  function setSheetExpanded(expanded) {
    if (!isMobileSheetMedia.matches) {
      panel.classList.remove('collapsed', 'expanded');
      isSheetExpanded = false;
      return;
    }

    isSheetExpanded = expanded;
    panel.classList.toggle('expanded', expanded);
    panel.classList.toggle('collapsed', !expanded);

    if (!expanded) {
      closeOverlays();
    }
  }

  function syncBottomSheetMode() {
    if (isMobileSheetMedia.matches) {
      setSheetExpanded(false);
    } else {
      panel.classList.remove('collapsed', 'expanded');
      isSheetExpanded = false;
    }
  }

  function applyAdaptiveOverlayPosition(stackEl, overlayEl) {
    if (!overlayEl) return;

    const margin = 12;
    const stackRect = stackEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const cs = window.getComputedStyle(overlayEl);
    const maxHeight = parseFloat(cs.maxHeight);
    const contentHeight = overlayEl.scrollHeight;
    const overlayHeight = Number.isFinite(maxHeight) ? Math.min(contentHeight, maxHeight) : contentHeight;

    const spaceBelow = viewportHeight - stackRect.bottom - margin;
    const spaceAbove = stackRect.top - margin;
    const openUp = spaceBelow < overlayHeight && spaceAbove > spaceBelow;
    stackEl.classList.toggle('open-up', openUp);
  }

  function renderCityOptions() {
    const options = [`<button class="glass-option" type="button" data-city="auto">Use My Location</button>`];
    CITY_DATASET.forEach((city) => {
      options.push(`<button class="glass-option" type="button" data-city="${city.name}">${city.name}</button>`);
    });
    cityMenuEl.innerHTML = options.join('');
  }

  function setStackOpen(stackEl, triggerEl, overlayEl, isOpen) {
    stackEl.classList.toggle('open', isOpen);
    if (overlayEl) overlayEl.classList.toggle('open', isOpen);
    if (!isOpen) {
      stackEl.classList.remove('open-up');
    } else {
      requestAnimationFrame(() => applyAdaptiveOverlayPosition(stackEl, overlayEl));
    }
    triggerEl.setAttribute('aria-expanded', String(isOpen));

    if (stackEl === monthStackEl) isMonthOpen = isOpen;
    if (stackEl === yearStackEl) isYearOpen = isOpen;
  }

  function closeOverlays() {
    setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, false);
    setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), false);
    setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
    setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
  }

  function toPrettyDate(date) {
    return date.toLocaleDateString(undefined, {
      timeZone: currentTimezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function toOverlayDateDDMMYYYY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function renderCalendar() {
    monthLabelEl.textContent = monthNames[calendarViewMonth];
    yearLabelEl.textContent = String(calendarViewYear);
    monthMenuEl.querySelectorAll('.glass-option').forEach((el) => {
      const selected = Number.parseInt(el.dataset.month, 10) === calendarViewMonth;
      el.classList.toggle('is-selected', selected);
    });
    yearMenuEl.querySelectorAll('.glass-option').forEach((el) => {
      const selected = Number.parseInt(el.dataset.year, 10) === calendarViewYear;
      el.classList.toggle('is-selected', selected);
    });

    const firstDay = new Date(calendarViewYear, calendarViewMonth, 1);
    const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const prevMonthDays = new Date(calendarViewYear, calendarViewMonth, 0).getDate();

    calendarDaysEl.innerHTML = '';

    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ day: prevMonthDays - startWeekday + i + 1, offset: -1 });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, offset: 0 });
    }
    while (cells.length % 7 !== 0 || cells.length < 35) {
      cells.push({ day: cells.length - (startWeekday + daysInMonth) + 1, offset: 1 });
    }

    cells.forEach((cell) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      if (cell.offset !== 0) button.classList.add('muted');

      const date = new Date(calendarViewYear, calendarViewMonth + cell.offset, cell.day);
      date.setHours(0, 0, 0, 0);

      const selected = new Date(simulationTime);
      selected.setHours(0, 0, 0, 0);
      if (date.getTime() === selected.getTime()) {
        button.classList.add('selected-day');
      } else {
        button.classList.remove('selected-day');
      }

      button.textContent = String(cell.day);
      button.addEventListener('click', () => {
        simulationTime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        calendarViewYear = simulationTime.getFullYear();
        calendarViewMonth = simulationTime.getMonth();
        updateLabel();
        refreshSun();
        showCityOverlay(toOverlayDateDDMMYYYY(simulationTime));
        renderCalendar();
        setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), false);
      });
      calendarDaysEl.appendChild(button);
    });

    if (dateStackEl.classList.contains('open')) {
      applyAdaptiveOverlayPosition(dateStackEl, document.getElementById('calendar-popover'));
    }
  }

  function updateLabel() {
    const h = simulationTime.getHours();
    const m = simulationTime.getMinutes();
    const d = simulationTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    userTimeEl.textContent = `${d}  ${pad(h)}:${pad(m)}`;

    const cityDate = new Date(
      simulationTime.toLocaleString('en-US', { timeZone: currentTimezone })
    );
    const ch = pad(cityDate.getHours());
    const cm = pad(cityDate.getMinutes());
    cityTimeEl.textContent = activeCityName
      ? `${activeCityName}: ${ch}:${cm}`
      : `Local: ${ch}:${cm}`;

    // Keep slider mapped to system/local time because it controls global simulationTime.
    document.getElementById('time-slider').value = h * 60 + m;

    dateLabelEl.textContent = toPrettyDate(simulationTime);
  }

  function markCityOption(value) {
    cityMenuEl.querySelectorAll('.glass-option').forEach((el) => {
      const selected = el.dataset.city === value;
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-selected', String(selected));
    });
  }

  function updateLocationStatus() {
    let status = '';
    if (locationMode === 'manual-city' && activeCityName) {
      status = `Manual city: ${activeCityName} (${currentLat.toFixed(2)}, ${currentLon.toFixed(2)})`;
      cityLabelEl.textContent = activeCityName;
      markCityOption(activeCityName);
    } else if (locationMode === 'geolocation' && geolocationGranted) {
      status = `Using geolocation (${currentLat.toFixed(2)}, ${currentLon.toFixed(2)})`;
      cityLabelEl.textContent = 'Use My Location';
      markCityOption('auto');
    } else {
      status = `Using fallback: ${FALLBACK_LOCATION.name} (${currentLat.toFixed(2)}, ${currentLon.toFixed(2)})`;
      cityLabelEl.textContent = 'Use My Location';
      markCityOption('auto');
    }
    locationStatusEl.textContent = status;
  }

  function showCityOverlay(text) {
    if (!cityOverlayEl) return;

    cityOverlayEl.textContent = text;
    cityOverlayEl.classList.remove('show');
    if (overlayTimerIn) clearTimeout(overlayTimerIn);
    if (overlayTimerOut) clearTimeout(overlayTimerOut);

    overlayTimerIn = setTimeout(() => {
      cityOverlayEl.classList.add('show');
    }, 10);

    // ~2 s total: fade in quickly, hold briefly, then fade out.
    overlayTimerOut = setTimeout(() => {
      cityOverlayEl.classList.remove('show');
    }, 1650);
  }

  function stopPanelTogglePropagation(el, events = ['click']) {
    if (!el) return;
    events.forEach((evt) => {
      el.addEventListener(evt, (e) => e.stopPropagation(), { passive: true });
    });
  }

  document.getElementById('time-slider').addEventListener('input', (e) => {
    userControllingTime = true;
    clearTimeout(userInteractionTimeout);
    userInteractionTimeout = setTimeout(() => { userControllingTime = false; }, 10000);

    const total = parseInt(e.target.value);
    simulationTime.setHours(Math.floor(total / 60), total % 60, 0, 0);
    updateLabel();
    refreshSun();
  });

  cityTriggerEl.addEventListener('click', () => {
    if (isMobileSheetMedia.matches && !isSheetExpanded) {
      setSheetExpanded(true);
      return;
    }

    const opening = !cityStackEl.classList.contains('open');
    setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), false);
    setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, opening);
  });

  dateTriggerEl.addEventListener('click', () => {
    if (isMobileSheetMedia.matches && !isSheetExpanded) {
      setSheetExpanded(true);
      return;
    }

    const opening = !dateStackEl.classList.contains('open');
    calendarViewYear = simulationTime.getFullYear();
    calendarViewMonth = simulationTime.getMonth();
    renderCalendar();
    setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
    setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
    setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, false);
    setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), opening);
  });

  calPrevEl.addEventListener('click', () => {
    calendarViewMonth -= 1;
    if (calendarViewMonth < 0) {
      calendarViewMonth = 11;
      calendarViewYear -= 1;
    }
    renderCalendar();
  });

  calNextEl.addEventListener('click', () => {
    calendarViewMonth += 1;
    if (calendarViewMonth > 11) {
      calendarViewMonth = 0;
      calendarViewYear += 1;
    }
    renderCalendar();
  });

  monthTriggerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !isMonthOpen;
    setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
    setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, opening);
  });

  yearTriggerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !isYearOpen;
    setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
    setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, opening);
  });

  monthMenuEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-month]');
    if (!btn) return;

    calendarViewMonth = Number.parseInt(btn.dataset.month, 10);
    renderCalendar();
    setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
  });

  yearMenuEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-year]');
    if (!btn) return;

    calendarViewYear = Number.parseInt(btn.dataset.year, 10);
    renderCalendar();
    setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
  });

  cityMenuEl.addEventListener('click', (e) => {
    const option = e.target.closest('[data-city]');
    if (!option) return;
    const value = option.dataset.city;

    if (value === 'auto') {
      currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (geolocationGranted && geoLat !== null && geoLon !== null) {
        setLocationSource('geolocation', geoLat, geoLon, { smooth: true, cityName: null });
      } else {
        setLocationSource('fallback', FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, {
          smooth: true,
          cityName: FALLBACK_LOCATION.name
        });
      }
      updateLabel();
      showCityOverlay('Your Location');
      setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, false);
      return;
    }

    const city = CITY_LOCATIONS[value];
    if (!city) return;
    setLocationSource('manual-city', city.lat, city.lon, { smooth: true, cityName: value });
    const cityMeta = CITY_DATASET.find((entry) => entry.name === value);
    if (cityMeta) {
      currentTimezone = cityMeta.tz || currentTimezone;
      showCityOverlay(`${cityMeta.name}, ${cityMeta.country}`);
    }
    updateLabel();
    setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, false);
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) {
      closeOverlays();
      if (isMobileSheetMedia.matches && isSheetExpanded) {
        setSheetExpanded(false);
      }
      return;
    }

    if (!cityStackEl.contains(e.target) && cityStackEl.classList.contains('open')) {
      setStackOpen(cityStackEl, cityTriggerEl, cityMenuEl, false);
    }
    if (!dateStackEl.contains(e.target) && dateStackEl.classList.contains('open')) {
      setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), false);
    }
    if (!monthStackEl.contains(e.target) && monthStackEl.classList.contains('open')) {
      setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
    }
    if (!yearStackEl.contains(e.target) && yearStackEl.classList.contains('open')) {
      setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
    }
  });

  document.addEventListener('touchstart', (e) => {
    if (!dateStackEl.contains(e.target) && dateStackEl.classList.contains('open')) {
      setStackOpen(dateStackEl, dateTriggerEl, document.getElementById('calendar-popover'), false);
    }
    if (!monthStackEl.contains(e.target) && monthStackEl.classList.contains('open')) {
      setStackOpen(monthStackEl, monthTriggerEl, monthMenuEl, false);
    }
    if (!yearStackEl.contains(e.target) && yearStackEl.classList.contains('open')) {
      setStackOpen(yearStackEl, yearTriggerEl, yearMenuEl, false);
    }
  }, { passive: true });

  // Keep panel expansion intentional: only the sheet handle toggles in mobile mode.
  sheetHandleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isMobileSheetMedia.matches) return;
    setSheetExpanded(!isSheetExpanded);
  });

  // Prevent child control interactions from bubbling into any parent toggle logic.
  stopPanelTogglePropagation(sliderEl, ['click', 'touchstart', 'mousedown', 'pointerdown']);
  panel.querySelectorAll('input, .glass-trigger, .calendar-day, .calendar-nav, #btn-prev-day, #btn-next-day, #btn-reset').forEach((el) => {
    stopPanelTogglePropagation(el, ['click', 'touchstart', 'mousedown', 'pointerdown']);
  });

  panel.addEventListener('touchstart', (e) => {
    if (!isMobileSheetMedia.matches || !isSheetExpanded) return;
    sheetTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  panel.addEventListener('touchend', (e) => {
    if (!isMobileSheetMedia.matches || !isSheetExpanded || sheetTouchStartY === null) return;
    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - sheetTouchStartY;
    sheetTouchStartY = null;
    if (deltaY > 55) {
      setSheetExpanded(false);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    syncBottomSheetMode();
    if (cityStackEl.classList.contains('open')) {
      applyAdaptiveOverlayPosition(cityStackEl, cityMenuEl);
    }
    if (dateStackEl.classList.contains('open')) {
      applyAdaptiveOverlayPosition(dateStackEl, document.getElementById('calendar-popover'));
    }
  });

  document.getElementById('btn-prev-day').addEventListener('click', () => {
    simulationTime.setDate(simulationTime.getDate() - 1);
    updateLabel();
    refreshSun();
    showCityOverlay(toOverlayDateDDMMYYYY(simulationTime));
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    simulationTime.setDate(simulationTime.getDate() + 1);
    updateLabel();
    refreshSun();
    showCityOverlay(toOverlayDateDDMMYYYY(simulationTime));
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    const previousMode = locationMode;
    simulationTime = new Date();
    currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (geolocationGranted && geoLat !== null && geoLon !== null) {
      setLocationSource('geolocation', geoLat, geoLon, { smooth: true, cityName: null });
    } else {
      setLocationSource('fallback', FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, {
        smooth: true,
        cityName: FALLBACK_LOCATION.name
      });
    }

    if (previousMode !== 'geolocation') {
      showCityOverlay('Your Location');
    }

    updateLabel();
    updateLocationStatus();
  });

  renderCityOptions();
  syncBottomSheetMode();
  updateLabel();
  renderCalendar();
  updateLocationStatus();

  controlsApi = {
    updateLocationStatus,
    showOverlay: showCityOverlay
  };

  if (pendingOverlayMessage) {
    showCityOverlay(pendingOverlayMessage);
    pendingOverlayMessage = null;
  }

  // Advance simulation time by 1 minute every 60 s when the user is not interacting
  setInterval(() => {
    if (!userControllingTime) {
      simulationTime.setMinutes(simulationTime.getMinutes() + 1);
      updateLabel();
      refreshSun();
    }
  }, 60000);
}

// =============================================================================
// ANIMATION LOOP
// =============================================================================

function animate() {
  requestAnimationFrame(animate);
  // Keep sky/star domes centred on camera so they always surround the viewer
  latitudeGroup.position.copy(camera.position);
  skyDome.position.copy(camera.position);

  if (locationTransition.active) {
    const elapsed = performance.now() - locationTransition.startMs;
    const t = THREE.MathUtils.clamp(elapsed / locationTransition.durationMs, 0, 1);
    const eased = smoothstep01(t);
    currentLat = THREE.MathUtils.lerp(locationTransition.fromLat, locationTransition.toLat, eased);
    currentLon = THREE.MathUtils.lerp(locationTransition.fromLon, locationTransition.toLon, eased);
    refreshSun();

    if (t >= 1) {
      locationTransition.active = false;
      currentLat = locationTransition.toLat;
      currentLon = locationTransition.toLon;
      notifyControlsLocation();
    }
  }

  // Drive per-vertex twinkling and cloud drift each frame
  const now = performance.now() * 0.001;
  starMaterial.uniforms.time.value = now;
  // Combine sim-time offset (slider) with continuous real-time drift
  skyDomeMat.uniforms.time.value   = cloudSimOffset + now;
  renderer.render(scene, camera);
}

// =============================================================================
// WINDOW RESIZE
// =============================================================================

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov    = getAdaptiveFOV(aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});

// =============================================================================
// STARTUP
// =============================================================================

loadEnvironmentModel();
initGeolocation();
buildTimeUI();
animate();
