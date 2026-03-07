import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// =============================================================================
// SCENE / RENDERER / CAMERA
// =============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300000);
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
let currentLat = 12.9716;
let currentLon = 77.5946;

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
      uv += vec2(time * 0.03, time * 0.015);

      float cloud = smoothstep(0.52, 0.72, fbm(uv)) * heightMask;

      // White in daylight, warm-tinted at sunset, faded at night
      vec3 cloudColor = mix(vec3(1.0), horizonColor * 1.4, 0.25);
      cloudColor *= clamp(dot(zenithColor, vec3(0.299, 0.587, 0.114)) * 6.0, 0.0, 1.0);

      gl_FragColor = vec4(mix(skyColor, cloudColor, cloud * cloudDensity), 1.0);
    }
  `
});
const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
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
  new THREE.MeshBasicMaterial({ color: 0xffdd66 })
);
sunSphere.scale.setScalar(1.25);
scene.add(sunSphere);

// Moon — ShaderMaterial renders the lunar phase by comparing view-space surface
// normals against the sun direction (also in view space). Lambertian dot product
// with a soft smoothstep terminator; earthshine fills the dark side faintly.
const moonMaterial = new THREE.ShaderMaterial({
  uniforms: {
    sunDirection: { value: new THREE.Vector3(1, 0, 0) }
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
    varying vec3 vWorldNormal;
    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 L = normalize(sunDirection);
      float brightness = smoothstep(-0.05, 0.25, dot(N, L));
      float earthshine = 0.12; // keeps dark limb visible at twilight
      vec3 moonColor = vec3(0.85, 0.87, 0.92);
      gl_FragColor = vec4(moonColor * (brightness + earthshine), 1.0);
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
scene.add(moonGlow);

// =============================================================================
// STAR SYSTEM
// =============================================================================

// 6 000 candidates placed on a uniform sphere; the Milky Way band is simulated
// by a Gaussian density bias around the equatorial plane. Each star stores
// per-vertex size, brightness, and a random twinkle phase offset.
const starDistance = 80000;
const starPositions  = [];
const starSizes      = [];
const starBrightness = [];
const starTwinkleOff = [];

for (let i = 0; i < 6000; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const x = starDistance * Math.sin(phi) * Math.cos(theta);
  const y = starDistance * Math.cos(phi);
  const z = starDistance * Math.sin(phi) * Math.sin(theta);
  const bandStrength = Math.exp(-Math.pow(y / (starDistance * 0.35), 2) * 4.0);
  if (Math.random() < 0.4 + bandStrength * 0.6) {
    starPositions.push(x, y, z);
    const size = Math.random() * 2 + 0.5;
    starSizes.push(size);
    starBrightness.push(size * 0.6 + 0.4);
    starTwinkleOff.push(Math.random() * Math.PI * 2);
  }
}

const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position',      new THREE.Float32BufferAttribute(starPositions,  3));
starGeometry.setAttribute('size',          new THREE.Float32BufferAttribute(starSizes,       1));
starGeometry.setAttribute('brightness',    new THREE.Float32BufferAttribute(starBrightness,  1));
starGeometry.setAttribute('twinkleOffset', new THREE.Float32BufferAttribute(starTwinkleOff,  1));

// Vertex shader: per-star twinkling via sin(time + offset).
// Fragment shader: circular point disc discard + premultiplied alpha.
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
    varying float vBrightness;
    varying float vTwinkle;
    uniform float time;
    void main() {
      vBrightness = brightness;
      vTwinkle = sin(time * 1.5 + twinkleOffset) * 0.6 + 0.4;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * 18.0 * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying float vBrightness;
    varying float vTwinkle;
    uniform float starVisibility;
    void main() {
      if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
      float intensity = vBrightness * vTwinkle * starVisibility * 1.35;
      gl_FragColor = vec4(vec3(intensity), intensity);
    }
  `
});

const starGroup = new THREE.Group();
starGroup.rotation.z = 0.6; // tilt so Milky Way band runs diagonally
starGroup.add(new THREE.Points(starGeometry, starMaterial));
scene.add(starGroup);

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

  // Visibility
  sunSphere.visible  = altitude > -0.05;
  moonSphere.visible = moonPos.altitude > -0.05;
  moonGlow.visible   = moonPos.altitude > -0.05;

  // Glow halos — sun scale expands near the horizon; moon opacity scales with phase
  sunGlow.position.copy(sunSphere.position);
  sunGlow.visible = altitude > -0.05;
  const glowScale = 3500 + (1 - horizonFactor) * 2000;
  sunGlow.scale.set(glowScale, glowScale, 1);
  moonGlow.position.copy(moonSphere.position);
  moonGlowMaterial.opacity = SunCalc.getMoonIllumination(date).fraction * 0.4;

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
  starMaterial.uniforms.starVisibility.value =
    THREE.MathUtils.clamp((-altitude - 0.1) / 0.15, 0, 1);

  // Star rotation and cloud drift both tied to simulation hours
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  starGroup.rotation.y = (hours / 24) * Math.PI * 2;
  skyDomeMat.uniforms.time.value = hours * 0.05;
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
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLon = pos.coords.longitude;
      console.log('Geolocation acquired — Lat:', currentLat, 'Lon:', currentLon);
      refreshSun();
    },
    (err) => {
      console.warn('Geolocation denied, using fallback (Bangalore):', err.message);
      refreshSun();
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
    #time-controls {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 24px;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
      color: #fff;
      font-family: sans-serif;
      font-size: 13px;
      user-select: none;
      z-index: 100;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
    }
    #time-controls button {
      padding: 6px 14px;
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 8px;
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
      min-height: 36px;
    }
    #time-controls button:hover { background: rgba(255,255,255,0.28); }
    #time-slider { width: 180px; accent-color: #ffcc66; cursor: pointer; }
    #time-label  { min-width: 110px; text-align: center; opacity: 0.9; white-space: nowrap; }

    @media (max-width: 540px) {
      #time-controls {
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
        width: calc(100vw - 32px);
        bottom: 16px;
        border-radius: 14px;
      }
      #time-controls .btn-row {
        display: flex;
        gap: 8px;
        width: 100%;
        justify-content: center;
      }
      #time-controls button {
        flex: 1;
        font-size: 14px;
        padding: 10px 8px;
        min-height: 44px;
      }
      #time-slider {
        width: 100%;
        height: 6px;
        min-height: 44px;
      }
      #time-label {
        font-size: 15px;
        min-width: unset;
      }
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'time-controls';
  panel.innerHTML = `
    <div class="btn-row">
      <button id="btn-prev-day">&#8722; Day</button>
      <span id="time-label"></span>
      <button id="btn-next-day">&#43; Day</button>
      <button id="btn-reset">Reset</button>
    </div>
    <input type="range" id="time-slider" min="0" max="1439" step="1" />
  `;
  document.body.appendChild(panel);

  const pad = (n) => String(n).padStart(2, '0');

  function updateLabel() {
    const h = simulationTime.getHours();
    const m = simulationTime.getMinutes();
    const d = simulationTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    document.getElementById('time-label').textContent = `${d}  ${pad(h)}:${pad(m)}`;
    document.getElementById('time-slider').value = h * 60 + m;
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
  document.getElementById('btn-prev-day').addEventListener('click', () => {
    simulationTime.setDate(simulationTime.getDate() - 1);
    updateLabel();
    refreshSun();
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    simulationTime.setDate(simulationTime.getDate() + 1);
    updateLabel();
    refreshSun();
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    simulationTime = new Date();
    updateLabel();
    refreshSun();
  });

  updateLabel();

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
  starGroup.position.copy(camera.position);
  skyDome.position.copy(camera.position);
  // Drive per-vertex twinkling each frame
  starMaterial.uniforms.time.value = performance.now() * 0.001;
  renderer.render(scene, camera);
}

// =============================================================================
// WINDOW RESIZE
// =============================================================================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================================
// STARTUP
// =============================================================================

loadEnvironmentModel();
initGeolocation();
buildTimeUI();
animate();
