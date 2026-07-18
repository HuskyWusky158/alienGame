import * as THREE from 'three';
import './style.css';
import { buildMarsVehicleSuite } from './vehicleSuite.js';
import { buildRockGarage } from './rockGarage.js';
import { buildDrivingCourses } from './drivingCourses.js';
import { buildCaveMineTrain } from './mineTrain.js';
import { buildAlienMountainHouse } from './alienHouse.js';
import { createProceduralRockGeometry, createProceduralRockMaterial } from './proceduralRocks.js';
import { createQualityManager, QUALITY_MODES } from './core/qualityManager.js';
import { mergeBufferGeometries as mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- renderer / scene / camera ---------- */

const startupQuery = new URLSearchParams(window.location.search);
const requestedDeviceClass = startupQuery.get('device');
const isTouchDevice = requestedDeviceClass === 'mobile'
  || (requestedDeviceClass !== 'desktop' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
if (isTouchDevice) document.body.classList.add('touch-device');
const requestedQualityMode = startupQuery.get('quality');
const hasRequestedQualityOverride = QUALITY_MODES.includes(requestedQualityMode);
const qualityManager = createQualityManager({
  initialMode: hasRequestedQualityOverride ? requestedQualityMode : 'auto',
  initialAutoTier: isTouchDevice ? 'low' : 'medium',
  autoTierCeiling: isTouchDevice ? 'low' : 'medium',
  sampleWindowSeconds: 2.25,
  downshiftSamples: 2,
  upshiftSamples: 4,
  persist: !hasRequestedQualityOverride,
  storageKey: isTouchDevice ? 'alien-game:quality:mobile:v4' : 'alien-game:quality:desktop:v4',
  devicePixelRatio: window.devicePixelRatio,
});
// Explicit query parameters are a deterministic benchmark/debug override and
// must win over a previously persisted in-game preference.
if (hasRequestedQualityOverride) {
  qualityManager.setMode(requestedQualityMode, { persist: false });
}
let qualitySettings = qualityManager.settings;
window.__ALIEN_GAME_QUALITY__ = qualityManager;

const loadingScreenEl = document.getElementById('loading-screen');
const loadingProgressEl = document.getElementById('loading-progress');
const loadingStatusEl = document.getElementById('loading-status');
const loadingPercentEl = document.getElementById('loading-percent');
let loadingComplete = false;
let renderedStartupFrames = 0;

function setLoadingStage(progress, status) {
  if (!loadingScreenEl) return;
  const safeProgress = THREE.MathUtils.clamp(Math.round(progress), 0, 100);
  loadingProgressEl.style.width = `${safeProgress}%`;
  loadingStatusEl.textContent = status;
  loadingPercentEl.textContent = `${safeProgress.toString().padStart(2, '0')}%`;
}

function finishLoadingScreen() {
  if (loadingComplete || !loadingScreenEl) return;
  loadingComplete = true;
  // Loading/build work is useful to profile separately, but it should not be
  // presented as an in-game long frame or contaminate the first play window.
  if (performanceDebugEl) {
    performanceDebugTime = 0;
    performanceDebugFrames = 0;
    performanceWorstFrameMs = 0;
    performanceLongFrames = 0;
  }
  setLoadingStage(100, 'EXPEDITION READY');
  window.setTimeout(() => loadingScreenEl.classList.add('is-ready'), 180);
  window.setTimeout(() => loadingScreenEl.remove(), 1100);
}

setLoadingStage(18, 'INITIALIZING MARTIAN ATMOSPHERE');

const scene = new THREE.Scene();
const clearSpaceColor = new THREE.Color(0x02030a);
scene.background = clearSpaceColor.clone();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1600);

const renderer = new THREE.WebGLRenderer({
  // WebGL antialiasing is fixed when the context is created. Keep it for the
  // explicit High preset, while Auto/Medium favor stable frame pacing and use
  // the renderer's DPR scaling for edge quality instead.
  antialias: !isTouchDevice && qualitySettings.materialQuality === 'high',
  powerPreference: 'high-performance',
  stencil: false,
});
let currentRenderPixelRatio = qualitySettings.pixelRatio;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(currentRenderPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = qualitySettings.shadowsEnabled;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);
setLoadingStage(27, 'CALIBRATING ROVER OPTICS');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  qualityManager.setDevicePixelRatio(window.devicePixelRatio);
});

qualityManager.subscribe(({ settings }) => {
  qualitySettings = settings;
  renderer.shadowMap.enabled = settings.shadowsEnabled;
  if (Math.abs(settings.pixelRatio - currentRenderPixelRatio) > 0.001) {
    currentRenderPixelRatio = settings.pixelRatio;
    renderer.setPixelRatio(currentRenderPixelRatio);
  }
}, { emitCurrent: false });

/* ---------- tiny Mars coordinate system ---------- */

const PLANET_SCALE = 2;
const PLANET_RADIUS = 105 * PLANET_SCALE;
const MOON_RADIUS = 18;
const MOON_CENTER = new THREE.Vector3(54, -48, -285).multiplyScalar(PLANET_SCALE);
const MOON_PAD_NORMAL = MOON_CENTER.clone().negate().normalize();
const ZEPHYRA_RADIUS = 25;
const ZEPHYRA_CENTER = new THREE.Vector3(-232, 76, -318).multiplyScalar(PLANET_SCALE);
const ZEPHYRA_PAD_NORMAL = MOON_CENTER.clone().sub(ZEPHYRA_CENTER).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const START_NORMAL = new THREE.Vector3(0, 1, 0);
const playerNormal = START_NORMAL.clone();
const playerHeading = new THREE.Vector3(0, 0, -1);
const GARAGE_NORMAL = normalFromSurfaceCoords(36, 5);
const GARAGE_OUTWARD_HEADING = START_NORMAL.clone()
  .addScaledVector(GARAGE_NORMAL, -START_NORMAL.dot(GARAGE_NORMAL))
  .normalize();
const MARS_COURSE_CLEAR_ZONES = [
  { normal: normalFromSurfaceCoords(170, 145), radius: 58 },
  { normal: normalFromSurfaceCoords(-128, -2), radius: 48 },
];
const MOON_COLD_TRAP_DIRECTION = UP.clone()
  .addScaledVector(MOON_PAD_NORMAL, -UP.dot(MOON_PAD_NORMAL))
  .normalize()
  .applyAxisAngle(MOON_PAD_NORMAL, -1.32);
const MOON_COLD_TRAP_NORMAL = stepWorldNormal(MOON_PAD_NORMAL, MOON_COLD_TRAP_DIRECTION, 15.2, MOON_RADIUS);
const MOON_COLD_TRAP_RADIUS = 4.65;
const MOON_RAY_CRATER_DIRECTION = UP.clone()
  .addScaledVector(MOON_PAD_NORMAL, -UP.dot(MOON_PAD_NORMAL))
  .normalize()
  .applyAxisAngle(MOON_PAD_NORMAL, -2.68);
const MOON_RAY_CRATER_NORMAL = stepWorldNormal(MOON_PAD_NORMAL, MOON_RAY_CRATER_DIRECTION, 18.6, MOON_RADIUS);
const MOON_RAY_CRATER_RADIUS = 4.15;
const MOON_RAY_CRATER_TANGENT = tangentHeadingForNormal(MOON_RAY_CRATER_NORMAL);
const MOON_SECONDARY_CRATERS = [
  { angle: -0.2, distance: 5.9, radius: 0.82, depth: 0.52 },
  { angle: -0.06, distance: 7.7, radius: 0.64, depth: 0.4 },
  { angle: 0.12, distance: 9.4, radius: 0.96, depth: 0.58 },
  { angle: 0.25, distance: 11.3, radius: 0.56, depth: 0.34 },
  { angle: -0.15, distance: 12.8, radius: 0.72, depth: 0.44 },
].map((crater) => ({
  ...crater,
  normal: stepWorldNormal(
    MOON_RAY_CRATER_NORMAL,
    MOON_RAY_CRATER_TANGENT.clone().applyAxisAngle(MOON_RAY_CRATER_NORMAL, crater.angle),
    crater.distance,
    MOON_RADIUS
  ),
}));
const MOON_MACRO_HEADING = tangentHeadingForNormal(MOON_PAD_NORMAL);
const MOON_MACRO_FEATURES = [
  {
    kind: 'mare',
    normal: stepWorldNormal(
      MOON_PAD_NORMAL,
      MOON_MACRO_HEADING.clone().applyAxisAngle(MOON_PAD_NORMAL, 2.06),
      20.5,
      MOON_RADIUS
    ),
    radius: 10.8,
    depth: 1.18,
  },
  {
    kind: 'mare',
    normal: stepWorldNormal(
      MOON_PAD_NORMAL,
      MOON_MACRO_HEADING.clone().applyAxisAngle(MOON_PAD_NORMAL, -1.86),
      27.5,
      MOON_RADIUS
    ),
    radius: 8.7,
    depth: 0.88,
  },
  {
    kind: 'highland',
    normal: stepWorldNormal(
      MOON_PAD_NORMAL,
      MOON_MACRO_HEADING.clone().applyAxisAngle(MOON_PAD_NORMAL, -0.52),
      27,
      MOON_RADIUS
    ),
    radius: 12.6,
    amplitude: 1.12,
  },
];
function sampleMoonMacroGeology(normal, target = null) {
  const landingDistance = Math.acos(THREE.MathUtils.clamp(normal.dot(MOON_PAD_NORMAL), -1, 1)) * MOON_RADIUS;
  const landingBlend = THREE.MathUtils.smoothstep(landingDistance, 4.8, 9.2);
  const ruggedMacro = noise3(normal.x * 3.1 + 8, normal.y * 3.1 - 5, normal.z * 3.1 + 13) * 0.42;
  const blockyRegolith = noise3(normal.x * 11.8 - 4, normal.y * 11.8 + 9, normal.z * 11.8 + 2) * 0.14;
  let height = (ruggedMacro + blockyRegolith) * landingBlend;
  let mare = 0;
  let highland = 0;
  let margin = 0;
  let strongestMareDistance = Infinity;

  for (const feature of MOON_MACRO_FEATURES) {
    const distance = Math.acos(THREE.MathUtils.clamp(normal.dot(feature.normal), -1, 1)) * MOON_RADIUS;
    const u = distance / feature.radius;
    if (u >= 1.28) continue;
    const core = 1 - THREE.MathUtils.smoothstep(u, 0.08, 1);
    const edge = Math.exp(-Math.pow((u - 0.94) / 0.12, 2));
    if (feature.kind === 'mare') {
      const lavaTexture = 0.94 + noise3(normal.x * 8 + 3, normal.y * 8 - 11, normal.z * 8 + 6) * 0.06;
      height -= feature.depth * Math.pow(core, 1.18) * lavaTexture * landingBlend;
      height += edge * 0.17 * landingBlend;
      mare = Math.max(mare, core);
      margin = Math.max(margin, edge);
      if (core > 0.01) strongestMareDistance = Math.min(strongestMareDistance, distance);
    } else {
      const weathering = 0.88 + noise3(normal.x * 7 - 12, normal.y * 7 + 4, normal.z * 7 + 15) * 0.12;
      height += feature.amplitude * Math.pow(core, 1.22) * weathering * landingBlend;
      highland = Math.max(highland, core);
      margin = Math.max(margin, edge * 0.42);
    }
  }

  const ridgeNoise = 1 - Math.abs(noise3(normal.x * 6.4 + 5, normal.y * 6.4 - 7, normal.z * 6.4 + 11));
  const wrinkle = Math.pow(Math.max(0, ridgeNoise), 9) * mare * 0.5;
  height += wrinkle * landingBlend;

  if (target) {
    target.mare = mare;
    target.highland = highland;
    target.margin = margin;
    target.wrinkle = wrinkle;
    target.mareDistance = strongestMareDistance;
  }
  return height;
}

const HUBS = [
  // Close to the starting region, but isolated from the driving courses.
  { key: 'outpost', name: "Caitlin's Projects", x: 62, z: -42, color: 0x6fb8ff, trigger: 19 },
  { key: 'cavern', name: 'Crystal Outcrop', x: -144, z: -144, color: 0xb266ff, trigger: 13, hiddenWaypoint: true },
  { key: 'planetarium', name: 'Xenobiology Globe', x: 100, z: 112, color: 0x78dfff, trigger: 30 },
  { key: 'crash', name: 'Crash Site', x: -92, z: 94, color: 0xff6a4a, trigger: 13 },
  { key: 'nightfall', name: 'Crystal Cavern', x: -52, z: -42, color: 0x62e6bd, trigger: 19 },
  { key: 'home', name: "Alien's Mountain Home", x: 94, z: -18, color: 0xffc27d, trigger: 23, hiddenWaypoint: true },
];
const SURFACE_WAYPOINT_HUBS = HUBS.filter((hub) => !hub.hiddenWaypoint);

const PROJECTS = [
  {
    title: '911 Call Forecasting Dashboard',
    desc: 'Built during my OSU / Levrum internship. Predicts hourly 911 call volumes using analytics and machine learning.',
    url: 'https://www.levrum.com',
    label: 'View Company',
  },
  {
    title: 'Resilient Rise Therapy',
    desc: 'Freelance website for a licensed therapist, with service pages, telehealth info, and SEO-optimized copy. Built with Astro and Tailwind CSS.',
    url: 'https://resilient-rise.vercel.app',
    label: 'View Site',
  },
  {
    title: 'Cooking Measurement Converter',
    desc: 'Responsive web app for converting cooking measurements, with a clean UI supporting common kitchen conversions.',
    url: 'https://conversionapp.vercel.app',
    label: 'Try Live App',
  },
  {
    title: 'Web Skills Showcase',
    desc: 'A web development project demonstrating responsive design, accessibility, and modern web standards.',
    url: 'https://web-dev-project-teal.vercel.app/index.html',
    label: 'View Website',
  },
  {
    title: 'Trail First-Aid Checklist',
    desc: 'Work in progress: a hiking trip planner generating gear and first-aid checklists tailored to distance, terrain, season, and elevation. Java/Spring Boot backend, vanilla JS frontend.',
    url: 'https://trail-first-aid-checklist.vercel.app',
    label: 'Try It',
  },
].map((project) => ({
  ...project,
  preview: `https://image.thum.io/get/width/960/crop/540/noanimate/${project.url}`,
}));
const CONTACT_TERMINAL = {
  kind: 'contact',
  title: 'Caitlin Bax · Contact',
  desc: 'Email, GitHub, LinkedIn, and resume links from Caitlin’s project archive.',
  url: 'mailto:baxc1722@gmail.com',
  label: 'Email Caitlin',
  details: [
    'EMAIL · baxc1722@gmail.com',
    'GITHUB · github.com/HuskyWusky158',
    'LINKEDIN · linkedin.com/in/caitlinbax325',
    'RESUME · caitlin-portfolio-weld.vercel.app/resume.pdf',
  ],
};
const ARCHIVE_SCREENS = [...PROJECTS, CONTACT_TERMINAL];
const PROJECT_SHIP_SCALE = 2.55;

const MARS_PORT = { x: 12, z: -20, name: 'ARES–LUNA TRANSFER' };
const MARS_OASIS_NORMAL = normalFromSurfaceCoords(170, 145);
const MARS_OASIS_RADIUS_X = 43;
const MARS_OASIS_RADIUS_Z = 29;
const MARS_OASIS_REVEAL_DISTANCE = 72;
const SHUTTLE_BOARD_RADIUS = 11;
const SHUTTLE_STATUS_RADIUS = 16;
const SHUTTLE_DOCK_DURATION = 10;
const SHUTTLE_TRAVEL_DURATION = 11.5;

function normalFromSurfaceCoords(x, z) {
  const distance = Math.hypot(x, z);
  if (distance < 0.0001) return START_NORMAL.clone();
  const angle = distance / PLANET_RADIUS;
  const tangent = new THREE.Vector3(x / distance, 0, z / distance);
  return START_NORMAL.clone().multiplyScalar(Math.cos(angle)).add(tangent.multiplyScalar(Math.sin(angle))).normalize();
}

function sampleMoonColdTrap(normal, target = null) {
  const distance = Math.acos(THREE.MathUtils.clamp(normal.dot(MOON_COLD_TRAP_NORMAL), -1, 1)) * MOON_RADIUS;
  const u = distance / MOON_COLD_TRAP_RADIUS;
  const bowl = u < 1 ? Math.pow(Math.max(0, 1 - u * u), 1.48) : 0;
  const floor = 1 - THREE.MathUtils.smoothstep(distance, 0.9, 2.2);
  const rim = Math.exp(-Math.pow((u - 1) / 0.13, 2));
  const fractured = 0.92 + noise3(normal.x * 24 + 5, normal.y * 24 - 11, normal.z * 24 + 3) * 0.08;
  const height = -2.45 * bowl * fractured - floor * 0.34 + rim * 0.68;
  if (target) {
    target.distance = distance;
    target.bowl = bowl;
    target.floor = floor;
    target.rim = rim;
  }
  return height;
}

function sampleMoonRayedCrater(normal, target = null) {
  const distance = Math.acos(THREE.MathUtils.clamp(normal.dot(MOON_RAY_CRATER_NORMAL), -1, 1)) * MOON_RADIUS;
  const u = distance / MOON_RAY_CRATER_RADIUS;
  const bowl = u < 1 ? Math.pow(Math.max(0, 1 - u * u), 1.34) : 0;
  const floor = 1 - THREE.MathUtils.smoothstep(distance, 0.72, 1.7);
  const rim = Math.exp(-Math.pow((u - 1) / 0.135, 2));
  const centralPeak = Math.exp(-Math.pow(distance / 0.68, 2));
  const fractured = 0.94 + noise3(normal.x * 31 - 8, normal.y * 31 + 6, normal.z * 31 + 12) * 0.06;
  const height = -2.12 * bowl * fractured - floor * 0.18 + rim * 0.88 + centralPeak * 1.02;

  let ray = 0;
  if (distance > MOON_RAY_CRATER_RADIUS * 0.92 && distance < 15.5) {
    const tangent = normal.clone().addScaledVector(MOON_RAY_CRATER_NORMAL, -normal.dot(MOON_RAY_CRATER_NORMAL));
    if (tangent.lengthSq() > 0.000001) {
      tangent.normalize();
      const rayRight = MOON_RAY_CRATER_TANGENT.clone().cross(MOON_RAY_CRATER_NORMAL).normalize();
      const angle = Math.atan2(tangent.dot(rayRight), tangent.dot(MOON_RAY_CRATER_TANGENT));
      const primary = Math.pow(Math.max(0, Math.cos(angle * 7 + 0.42)), 14);
      const secondary = Math.pow(Math.max(0, Math.cos(angle * 11 - 1.15)), 24) * 0.58;
      const radialFade = 1 - THREE.MathUtils.smoothstep(distance, MOON_RAY_CRATER_RADIUS * 0.95, 15.5);
      ray = Math.max(primary, secondary) * radialFade;
    }
  }
  if (target) {
    target.distance = distance;
    target.bowl = bowl;
    target.floor = floor;
    target.rim = rim;
    target.centralPeak = centralPeak;
    target.ray = ray;
  }
  return height;
}

function sampleMoonSecondaryCraters(normal, target = null) {
  let height = 0;
  let strongest = 0;
  for (const crater of MOON_SECONDARY_CRATERS) {
    const distance = Math.acos(THREE.MathUtils.clamp(normal.dot(crater.normal), -1, 1)) * MOON_RADIUS;
    const u = distance / crater.radius;
    if (u < 1) {
      const bowl = Math.pow(Math.max(0, 1 - u * u), 1.38);
      height -= crater.depth * bowl;
      strongest = Math.max(strongest, bowl);
    }
    if (u < 1.34) height += crater.depth * 0.3 * Math.exp(-Math.pow((u - 1) / 0.16, 2));
  }
  if (target) target.influence = strongest;
  return height;
}

function getMoonHeight(normal) {
  return sampleMoonMacroGeology(normal)
    + sampleMoonColdTrap(normal)
    + sampleMoonRayedCrater(normal)
    + sampleMoonSecondaryCraters(normal);
}

function geodesicDistance(a, b) {
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * PLANET_RADIUS;
}

function slerpNormals(a, b, t) {
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  if (angle < 0.0001) return a.clone();
  const sinAngle = Math.sin(angle);
  return a.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinAngle).add(b.clone().multiplyScalar(Math.sin(t * angle) / sinAngle)).normalize();
}

HUBS.forEach((hub) => {
  hub.normal = normalFromSurfaceCoords(hub.x, hub.z);
});
const NIGHTFALL_CAVE = HUBS.find((hub) => hub.key === 'nightfall');
const ALIEN_MOUNTAIN_HOME = HUBS.find((hub) => hub.key === 'home');
const ALIEN_HOME_BRANCH_NORMAL = slerpNormals(
  START_NORMAL,
  HUBS.find((hub) => hub.key === 'outpost').normal,
  0.72
);
const ALIEN_HOME_APPROACH_HEADING = ALIEN_HOME_BRANCH_NORMAL.clone()
  .addScaledVector(ALIEN_MOUNTAIN_HOME.normal, -ALIEN_HOME_BRANCH_NORMAL.dot(ALIEN_MOUNTAIN_HOME.normal))
  .normalize();
const CAVE_INNER_RADIUS = 6.4;
NIGHTFALL_CAVE.heading = START_NORMAL.clone()
  .addScaledVector(NIGHTFALL_CAVE.normal, -START_NORMAL.dot(NIGHTFALL_CAVE.normal))
  .normalize();
NIGHTFALL_CAVE.right = NIGHTFALL_CAVE.heading.clone().cross(NIGHTFALL_CAVE.normal).normalize();
const CAVE_INWARD_HEADING = NIGHTFALL_CAVE.heading.clone().multiplyScalar(-1);
const CAVE_ROUTE_POINTS = [
  // The opening stays aligned with the surface before settling into a long,
  // readable grade. This makes entering the cave feel like a drive down
  // instead of a teleport between the spherical surface and the tunnel.
  new THREE.Vector3(0, 0.12, 4.4),
  new THREE.Vector3(0, -1.25, -8),
  new THREE.Vector3(3.2, -5.1, -24),
  new THREE.Vector3(-4.8, -12.4, -47),
  new THREE.Vector3(6.2, -20.2, -72),
  new THREE.Vector3(2.5, -28.5, -98),
  new THREE.Vector3(-6.5, -37.2, -126),
  new THREE.Vector3(0, -44.2, -151),
  new THREE.Vector3(0, -47, -168),
];
const CAVE_ROUTE_CURVE = new THREE.CatmullRomCurve3(CAVE_ROUTE_POINTS, false, 'centripetal', 0.45);
const CAVE_ROUTE_LENGTH = CAVE_ROUTE_CURVE.getLength();
const CAVE_CHAMBER_CENTER = new THREE.Vector3(0, -47, -207);
const CAVE_CHAMBER_RADIUS_X = 58;
const CAVE_CHAMBER_RADIUS_Z = 72;
const CAVE_TUNNEL_MAX_SPEED = 8.5;
MARS_PORT.normal = normalFromSurfaceCoords(MARS_PORT.x, MARS_PORT.z);

function hash3(x, y, z) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const x00 = THREE.MathUtils.lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), sx);
  const x10 = THREE.MathUtils.lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), sx);
  const x01 = THREE.MathUtils.lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), sx);
  const x11 = THREE.MathUtils.lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), sx);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(x00, x10, sy), THREE.MathUtils.lerp(x01, x11, sy), sz) * 2 - 1;
}

function fbm3(x, y, z) {
  let value = 0;
  let amplitude = 0.58;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave++) {
    value += noise3(x * frequency, y * frequency, z * frequency) * amplitude;
    frequency *= 2.04;
    amplitude *= 0.47;
  }
  return value;
}

const ZEPHYRA_CANYON_DIRECTION = UP.clone()
  .addScaledVector(ZEPHYRA_PAD_NORMAL, -UP.dot(ZEPHYRA_PAD_NORMAL))
  .normalize()
  .applyAxisAngle(ZEPHYRA_PAD_NORMAL, 0.72);
const ZEPHYRA_CANYON_CONTROL_NORMALS = [
  stepWorldNormal(ZEPHYRA_PAD_NORMAL, ZEPHYRA_CANYON_DIRECTION, 7.5, ZEPHYRA_RADIUS),
  stepWorldNormal(
    ZEPHYRA_PAD_NORMAL,
    ZEPHYRA_CANYON_DIRECTION.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, 0.2),
    15.5,
    ZEPHYRA_RADIUS
  ),
  stepWorldNormal(
    ZEPHYRA_PAD_NORMAL,
    ZEPHYRA_CANYON_DIRECTION.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, 0.47),
    24,
    ZEPHYRA_RADIUS
  ),
];
const ZEPHYRA_CANYON_SAMPLES = [];
for (let segmentIndex = 0; segmentIndex < ZEPHYRA_CANYON_CONTROL_NORMALS.length - 1; segmentIndex++) {
  const start = ZEPHYRA_CANYON_CONTROL_NORMALS[segmentIndex];
  const end = ZEPHYRA_CANYON_CONTROL_NORMALS[segmentIndex + 1];
  for (let sampleIndex = 0; sampleIndex < 13; sampleIndex++) {
    if (segmentIndex > 0 && sampleIndex === 0) continue;
    ZEPHYRA_CANYON_SAMPLES.push(slerpNormals(start, end, sampleIndex / 12));
  }
}
const ZEPHYRA_CANYON_NORMAL = ZEPHYRA_CANYON_CONTROL_NORMALS[1];

function sampleZephyraIonCanyon(normal, target = null) {
  let closestDot = -1;
  for (const sample of ZEPHYRA_CANYON_SAMPLES) closestDot = Math.max(closestDot, normal.dot(sample));
  const distance = Math.acos(THREE.MathUtils.clamp(closestDot, -1, 1)) * ZEPHYRA_RADIUS;
  const trench = 1 - THREE.MathUtils.smoothstep(distance, 0.38, 2.15);
  const wall = Math.exp(-Math.pow((distance - 2.35) / 0.68, 2));
  const fracturedDepth = 0.9 + noise3(normal.x * 21 + 7, normal.y * 21 - 3, normal.z * 21 + 13) * 0.1;
  const height = -3.05 * Math.pow(trench, 1.22) * fracturedDepth + wall * 0.62;
  if (target) {
    target.trench = trench;
    target.wall = wall;
    target.distance = distance;
  }
  return height;
}

function getZephyraHeight(normal) {
  const continental = fbm3(normal.x * 2.4 - 11, normal.y * 2.4 + 6, normal.z * 2.4 + 19) * 1.65;
  const crystalRidges = 1 - Math.abs(noise3(normal.x * 5.8 + 4, normal.y * 5.8 - 12, normal.z * 5.8 + 7));
  const weathering = fbm3(normal.x * 11 + 3, normal.y * 11 + 8, normal.z * 11 - 5) * 0.24;
  return continental + Math.pow(crystalRidges, 7) * 1.1 + weathering + sampleZephyraIonCanyon(normal);
}

const CRATERS = [
  { normal: normalFromSurfaceCoords(20, -34), radius: 0.19, depth: 2.8, rim: 1.25 },
  { normal: normalFromSurfaceCoords(-34, 16), radius: 0.24, depth: 3.4, rim: 1.5 },
  { normal: normalFromSurfaceCoords(16, 34), radius: 0.12, depth: 1.9, rim: 0.8 },
  { normal: new THREE.Vector3(0.72, -0.54, 0.43).normalize(), radius: 0.22, depth: 3.2, rim: 1.35 },
  { normal: new THREE.Vector3(-0.58, -0.35, -0.74).normalize(), radius: 0.28, depth: 3.8, rim: 1.6 },
  { normal: new THREE.Vector3(0.2, -0.91, -0.36).normalize(), radius: 0.16, depth: 2.5, rim: 1.0 },
];

const MARS_MACRO_LANDFORMS = [
  { key: 'tharsis', kind: 'highland', normal: normalFromSurfaceCoords(94, -18), radius: 0.38, amplitude: 5.9 },
  { key: 'hellas', kind: 'basin', normal: normalFromSurfaceCoords(-112, 76), radius: 0.34, amplitude: 7.4, rim: 1.65 },
  { key: 'elysium', kind: 'shield', normal: normalFromSurfaceCoords(70, 106), radius: 0.3, amplitude: 6.6 },
  { key: 'arabia', kind: 'highland', normal: normalFromSurfaceCoords(-28, 116), radius: 0.31, amplitude: 3.9 },
];

const MARS_IMPACT_BASIN_NORMAL = normalFromSurfaceCoords(76, -108);
const MARS_IMPACT_BASIN_RADIUS = 17.5;
const MARS_IMPACT_BASIN_TANGENT = new THREE.Vector3(1, 0, 0)
  .addScaledVector(MARS_IMPACT_BASIN_NORMAL, -MARS_IMPACT_BASIN_NORMAL.x)
  .normalize();
const MARS_IMPACT_BASIN_RIGHT = MARS_IMPACT_BASIN_TANGENT.clone().cross(MARS_IMPACT_BASIN_NORMAL).normalize();
const marsImpactDirection = new THREE.Vector3();

function sampleMarsImpactBasin(normal, target = null) {
  const distance = geodesicDistance(normal, MARS_IMPACT_BASIN_NORMAL);
  const u = distance / MARS_IMPACT_BASIN_RADIUS;
  const bowl = u < 1 ? Math.pow(Math.max(0, 1 - u * u), 1.28) : 0;
  const fractured = 0.91 + fbm3(normal.x * 19 + 7, normal.y * 19 - 12, normal.z * 19 + 4) * 0.09;
  const rim = Math.exp(-Math.pow((u - 1) / 0.105, 2));
  const innerWall = THREE.MathUtils.smoothstep(u, 0.42, 0.7) * (1 - THREE.MathUtils.smoothstep(u, 0.91, 1.03));
  const terraces = innerWall * (
    Math.exp(-Math.pow((u - 0.56) / 0.038, 2)) * 0.34
    + Math.exp(-Math.pow((u - 0.71) / 0.043, 2)) * 0.42
    + Math.exp(-Math.pow((u - 0.84) / 0.048, 2)) * 0.5
  );
  const centralPeak = Math.exp(-Math.pow(distance / 3.15, 2));
  const meltFloor = 1 - THREE.MathUtils.smoothstep(distance, 2.8, 7.2);

  let ejecta = 0;
  if (distance > MARS_IMPACT_BASIN_RADIUS * 0.9 && distance < MARS_IMPACT_BASIN_RADIUS * 3.1) {
    marsImpactDirection.copy(normal)
      .addScaledVector(MARS_IMPACT_BASIN_NORMAL, -normal.dot(MARS_IMPACT_BASIN_NORMAL));
    if (marsImpactDirection.lengthSq() > 0.000001) {
      marsImpactDirection.normalize();
      const angle = Math.atan2(
        marsImpactDirection.dot(MARS_IMPACT_BASIN_RIGHT),
        marsImpactDirection.dot(MARS_IMPACT_BASIN_TANGENT)
      );
      const primaryRays = Math.pow(Math.max(0, Math.cos(angle * 7 + 0.36)), 16);
      const secondaryRays = Math.pow(Math.max(0, Math.cos(angle * 11 - 0.92)), 26) * 0.56;
      const radialFade = 1 - THREE.MathUtils.smoothstep(
        distance,
        MARS_IMPACT_BASIN_RADIUS * 0.92,
        MARS_IMPACT_BASIN_RADIUS * 3.1
      );
      ejecta = Math.max(primaryRays, secondaryRays) * radialFade;
    }
  }

  const height = -5.65 * bowl * fractured
    + rim * 2.35
    + terraces
    + centralPeak * 3.45
    + ejecta * (0.24 + Math.max(0, noise3(normal.x * 33, normal.y * 33, normal.z * 33)) * 0.28);
  if (target) {
    target.distance = distance;
    target.bowl = bowl;
    target.rim = rim;
    target.wall = innerWall;
    target.terraces = terraces;
    target.centralPeak = centralPeak;
    target.floor = meltFloor;
    target.ejecta = ejecta;
  }
  return height;
}

const MARS_ESCARP_CENTER_NORMAL = normalFromSurfaceCoords(-34, 128);
const MARS_ESCARP_ALONG = new THREE.Vector3(1, 0, 0)
  .addScaledVector(MARS_ESCARP_CENTER_NORMAL, -MARS_ESCARP_CENTER_NORMAL.x)
  .normalize();
const MARS_ESCARP_ACROSS = MARS_ESCARP_ALONG.clone().cross(MARS_ESCARP_CENTER_NORMAL).normalize();

function sampleMarsSedimentaryEscarpment(normal, target = null) {
  const along = Math.asin(THREE.MathUtils.clamp(normal.dot(MARS_ESCARP_ALONG), -1, 1)) * PLANET_RADIUS;
  const across = Math.asin(THREE.MathUtils.clamp(normal.dot(MARS_ESCARP_ACROSS), -1, 1)) * PLANET_RADIUS;
  const alongEnvelope = 1 - THREE.MathUtils.smoothstep(Math.abs(along), 17, 25);
  const frontRise = THREE.MathUtils.smoothstep(across, -4.1, 3.5);
  const backSlope = 1 - THREE.MathUtils.smoothstep(across, 16, 28);
  const shelf = Math.max(0, alongEnvelope * frontRise * backSlope);
  const beddingSteps = (
    THREE.MathUtils.smoothstep(across, -1.4, 0.2) * 0.18
    + THREE.MathUtils.smoothstep(across, 2.2, 3.2) * 0.21
    + THREE.MathUtils.smoothstep(across, 5.1, 6.4) * 0.17
  ) * alongEnvelope * backSlope;
  const erosion = 0.93 + fbm3(normal.x * 18 + 4, normal.y * 18 - 9, normal.z * 18 + 12) * 0.07;
  const height = (5.45 * shelf + beddingSteps) * erosion;
  if (target) {
    target.along = along;
    target.across = across;
    target.influence = shelf;
    target.cliff = Math.exp(-Math.pow((across + 0.3) / 4.4, 2)) * alongEnvelope;
    target.height = height;
  }
  return height;
}

const MARS_YARDANG_CENTER_NORMAL = normalFromSurfaceCoords(118, 18);
const MARS_YARDANG_WIND = new THREE.Vector3(Math.cos(0.28), 0, Math.sin(0.28))
  .addScaledVector(MARS_YARDANG_CENTER_NORMAL, -new THREE.Vector3(Math.cos(0.28), 0, Math.sin(0.28)).dot(MARS_YARDANG_CENTER_NORMAL))
  .normalize();
const MARS_YARDANG_ACROSS = MARS_YARDANG_WIND.clone().cross(MARS_YARDANG_CENTER_NORMAL).normalize();
const MARS_YARDANG_SPACING = 9.4;

function sampleMarsYardangField(normal, target = null) {
  const along = Math.asin(THREE.MathUtils.clamp(normal.dot(MARS_YARDANG_WIND), -1, 1)) * PLANET_RADIUS;
  const across = Math.asin(THREE.MathUtils.clamp(normal.dot(MARS_YARDANG_ACROSS), -1, 1)) * PLANET_RADIUS;
  const ellipse = (along * along) / (31 * 31) + (across * across) / (24 * 24);
  const envelope = ellipse < 1 ? Math.pow(1 - THREE.MathUtils.smoothstep(ellipse, 0.28, 1), 1.18) : 0;
  const phase = (across / MARS_YARDANG_SPACING) * Math.PI * 2
    + Math.sin(along * 0.115) * 0.34
    + noise3(normal.x * 15 - 2, normal.y * 15 + 7, normal.z * 15 + 11) * 0.18;
  const ridge = Math.pow(Math.max(0, 0.5 + Math.cos(phase) * 0.5), 3.8) * envelope;
  const abrasion = 0.86 + fbm3(normal.x * 19 + 8, normal.y * 19 - 5, normal.z * 19 + 3) * 0.14;
  const height = ridge * 2.25 * abrasion;
  if (target) {
    target.along = along;
    target.across = across;
    target.influence = envelope;
    target.ridge = ridge;
    target.lee = Math.pow(Math.max(0, -Math.sin(phase)), 2.2) * envelope * (1 - Math.min(1, ridge));
  }
  return height;
}

const MARS_RIFT_CONTROL_NORMALS = [
  normalFromSurfaceCoords(-118, -48),
  normalFromSurfaceCoords(-101, -63),
  normalFromSurfaceCoords(-82, -78),
  normalFromSurfaceCoords(-60, -92),
];
const MARS_RIFT_SEGMENTS = MARS_RIFT_CONTROL_NORMALS.slice(0, -1).map((start, index) => {
  const end = MARS_RIFT_CONTROL_NORMALS[index + 1];
  return {
    start,
    end,
    greatCircleNormal: start.clone().cross(end).normalize(),
    length: Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1)),
  };
});
const marsRiftProjection = new THREE.Vector3();

const MARS_DUNE_FIELDS = [
  { key: 'arcadia', x: 46, z: 44, alongRadius: 48, acrossRadius: 32, amplitude: 2.45, wavelength: 15.5, windAngle: -0.48, phase: 0.16 },
  { key: 'aonia', x: -82, z: 72, alongRadius: 40, acrossRadius: 27, amplitude: 2.05, wavelength: 13.8, windAngle: -0.22, phase: 0.51 },
  { key: 'noctis', x: 88, z: -70, alongRadius: 44, acrossRadius: 25, amplitude: 1.85, wavelength: 12.6, windAngle: -0.72, phase: 0.78 },
].map((field) => {
  const normal = normalFromSurfaceCoords(field.x, field.z);
  const windWorld = new THREE.Vector3(Math.cos(field.windAngle), 0, Math.sin(field.windAngle));
  const wind = windWorld.addScaledVector(normal, -windWorld.dot(normal)).normalize();
  return {
    ...field,
    normal,
    wind,
    across: wind.clone().cross(normal).normalize(),
  };
});

function sampleMarsAeolianDunes(normal, target = null) {
  let duneHeight = 0;
  let strongestInfluence = 0;
  let strongestLee = 0;
  for (const field of MARS_DUNE_FIELDS) {
    const along = normal.dot(field.wind) * PLANET_RADIUS;
    const across = normal.dot(field.across) * PLANET_RADIUS;
    const ellipse = (along * along) / (field.alongRadius * field.alongRadius)
      + (across * across) / (field.acrossRadius * field.acrossRadius);
    if (ellipse >= 1) continue;
    const envelope = Math.pow(1 - THREE.MathUtils.smoothstep(ellipse, 0.18, 1), 1.18);
    const bowedCrest = Math.sin(across * 0.105 + field.phase * 8.1) * 1.55
      + Math.sin(across * 0.29 - field.phase * 3.7) * 0.42;
    const cycleValue = (along + bowedCrest) / field.wavelength + field.phase;
    const cycle = cycleValue - Math.floor(cycleValue);
    const profile = cycle < 0.72
      ? Math.pow(cycle / 0.72, 1.52)
      : Math.pow((1 - cycle) / 0.28, 0.58);
    const brokenCrescent = 0.76 + Math.sin(across * 0.23 + along * 0.035) * 0.16
      + noise3(normal.x * 19 + 4, normal.y * 19 - 7, normal.z * 19 + 11) * 0.08;
    duneHeight += field.amplitude * profile * envelope * Math.max(0.5, brokenCrescent);
    strongestInfluence = Math.max(strongestInfluence, envelope);
    if (cycle >= 0.72) {
      const leeFace = Math.sin(((cycle - 0.72) / 0.28) * Math.PI);
      strongestLee = Math.max(strongestLee, leeFace * envelope);
    }
  }
  if (target) {
    target.influence = strongestInfluence;
    target.lee = strongestLee;
  }
  return duneHeight;
}

function marsRiftDistance(normal) {
  let minimumAngle = Infinity;
  for (const segment of MARS_RIFT_SEGMENTS) {
    const planeDistance = normal.dot(segment.greatCircleNormal);
    marsRiftProjection.copy(normal).addScaledVector(segment.greatCircleNormal, -planeDistance);
    if (marsRiftProjection.lengthSq() > 0.000001) {
      marsRiftProjection.normalize();
      const fromStart = Math.acos(THREE.MathUtils.clamp(segment.start.dot(marsRiftProjection), -1, 1));
      const toEnd = Math.acos(THREE.MathUtils.clamp(marsRiftProjection.dot(segment.end), -1, 1));
      if (fromStart + toEnd <= segment.length + 0.0005) {
        minimumAngle = Math.min(minimumAngle, Math.asin(THREE.MathUtils.clamp(Math.abs(planeDistance), 0, 1)));
        continue;
      }
    }
    minimumAngle = Math.min(
      minimumAngle,
      Math.acos(THREE.MathUtils.clamp(normal.dot(segment.start), -1, 1)),
      Math.acos(THREE.MathUtils.clamp(normal.dot(segment.end), -1, 1))
    );
  }
  return minimumAngle * PLANET_RADIUS;
}

function sampleMarsMacroGeology(normal, target) {
  target.highland = 0;
  target.basin = 0;
  target.shield = 0;
  for (const feature of MARS_MACRO_LANDFORMS) {
    const angle = Math.acos(THREE.MathUtils.clamp(normal.dot(feature.normal), -1, 1));
    const influence = 1 - THREE.MathUtils.smoothstep(angle / feature.radius, 0, 1);
    if (feature.kind === 'basin') target.basin = Math.max(target.basin, influence);
    else if (feature.kind === 'shield') target.shield = Math.max(target.shield, influence);
    else target.highland = Math.max(target.highland, influence);
  }
  const riftDistance = marsRiftDistance(normal);
  target.rift = Math.exp(-Math.pow(riftDistance / 5.1, 2));
  return target;
}

function baseSurfaceHeight(normal) {
  let height = fbm3(normal.x * 2.15 + 3, normal.y * 2.15 - 7, normal.z * 2.15 + 11) * 2.75;
  height += fbm3(normal.x * 6.2 - 9, normal.y * 6.2 + 4, normal.z * 6.2) * 0.68;
  const ridgeNoise = 1 - Math.abs(noise3(normal.x * 5.1, normal.y * 5.1, normal.z * 5.1));
  height += Math.pow(ridgeNoise, 5) * 1.25;

  for (const feature of MARS_MACRO_LANDFORMS) {
    const angle = Math.acos(THREE.MathUtils.clamp(normal.dot(feature.normal), -1, 1));
    const u = angle / feature.radius;
    if (u >= 1.3) continue;
    const core = 1 - THREE.MathUtils.smoothstep(u, 0, 1);
    if (feature.kind === 'highland') {
      const weathering = 0.86 + fbm3(normal.x * 9 + 17, normal.y * 9 - 4, normal.z * 9 + 8) * 0.18;
      height += feature.amplitude * core * weathering;
    } else if (feature.kind === 'basin') {
      height -= feature.amplitude * Math.pow(core, 1.35);
      height += feature.rim * Math.exp(-Math.pow((u - 0.92) / 0.13, 2));
    } else {
      const apron = Math.exp(-u * u * 2.65);
      height += feature.amplitude * apron;
      if (u < 0.18) height -= 2.2 * Math.pow(1 - u / 0.18, 2);
    }
  }

  const riftDistance = marsRiftDistance(normal);
  height -= 4.25 * Math.exp(-Math.pow(riftDistance / 3.7, 2));
  height += 0.95 * Math.exp(-Math.pow((riftDistance - 6.2) / 2.1, 2));
  height += sampleMarsImpactBasin(normal);
  height += sampleMarsAeolianDunes(normal);
  height += sampleMarsSedimentaryEscarpment(normal);
  height += sampleMarsYardangField(normal);
  for (const crater of CRATERS) {
    const u = Math.acos(THREE.MathUtils.clamp(normal.dot(crater.normal), -1, 1)) / crater.radius;
    if (u < 1) height -= crater.depth * Math.pow(1 - u * u, 2);
    if (u < 1.3) height += crater.rim * Math.exp(-Math.pow((u - 1) / 0.13, 2));
  }
  return height;
}

const FLATTEN_CENTERS = [
  { normal: START_NORMAL, r0: 6, r1: 11 },
  { normal: GARAGE_NORMAL, r0: 15, r1: 23 },
  { normal: MARS_OASIS_NORMAL, r0: 45, r1: 55 },
  ...HUBS.map((hub) => ({
    normal: hub.normal,
    r0: hub.key === 'planetarium' ? 27 : 8,
    r1: hub.key === 'planetarium' ? 38 : 13,
  })),
  ...[-12, 12].map((distance) => ({
    normal: stepWorldNormal(NIGHTFALL_CAVE.normal, NIGHTFALL_CAVE.heading, distance, PLANET_RADIUS),
    r0: 7,
    r1: 10,
  })),
  { normal: MARS_PORT.normal, r0: 5, r1: 8 },
];
FLATTEN_CENTERS.forEach((zone) => {
  zone.height = baseSurfaceHeight(zone.normal);
});

function getSurfaceHeight(normal) {
  let height = baseSurfaceHeight(normal);
  for (const zone of FLATTEN_CENTERS) {
    const distance = geodesicDistance(normal, zone.normal);
    if (distance >= zone.r1) continue;
    const t = THREE.MathUtils.smoothstep(distance, zone.r0, zone.r1);
    height = THREE.MathUtils.lerp(zone.height, height, t);
  }
  return height;
}

function getTerrainHeight(x, z) {
  return getSurfaceHeight(normalFromSurfaceCoords(x, z));
}

function surfaceWorldPosition(normal, offset = 0) {
  return normal.clone().multiplyScalar(PLANET_RADIUS + getSurfaceHeight(normal) + offset);
}

function placeSurfaceGroup(group, normal, offset = 0) {
  group.position.copy(surfaceWorldPosition(normal, offset));
  group.quaternion.setFromUnitVectors(UP, normal);
  scene.add(group);
  return group;
}

/* ---------- space, stars & distorted sun ---------- */

let sunMaterial;
let distortedSun;
let distantMoon;
let moonSurface;
let earthriseRuntime;
let shootingStar;
let shootingStarTrailMaterial;
let shootingStarGlowMaterial;
const shootingStarStart = new THREE.Vector3(-48, -11, -203).multiplyScalar(PLANET_SCALE);
const shootingStarEnd = new THREE.Vector3(48, -34, -184).multiplyScalar(PLANET_SCALE);

function randomUnitVector() {
  const y = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function buildDistantMoon() {
  distantMoon = new THREE.Group();
  distantMoon.position.copy(MOON_CENTER);

  const moonGeometry = new THREE.IcosahedronGeometry(MOON_RADIUS, isTouchDevice ? 5 : 6);
  const moonPositions = moonGeometry.attributes.position;
  const moonColors = new Float32Array(moonPositions.count * 3);
  const normal = new THREE.Vector3();
  const baseRegolith = new THREE.Color(0xbfb5ad);
  const coldTrapRegolith = new THREE.Color(0x030508);
  const freshRimRegolith = new THREE.Color(0xd6cfc5);
  const freshEjecta = new THREE.Color(0xe4ddd2);
  const impactMelt = new THREE.Color(0x4c494b);
  const mareBasalt = new THREE.Color(0x69666a);
  const highlandAnorthosite = new THREE.Color(0xd2ccc2);
  const basinMarginRegolith = new THREE.Color(0xaaa49f);
  const wrinkleRidgeBasalt = new THREE.Color(0x535156);
  const color = new THREE.Color();
  const macroGeology = { mare: 0, highland: 0, margin: 0, wrinkle: 0, mareDistance: Infinity };
  const coldTrap = { distance: Infinity, bowl: 0, floor: 0, rim: 0 };
  const rayedCrater = { distance: Infinity, bowl: 0, floor: 0, rim: 0, centralPeak: 0, ray: 0 };
  const secondaryCrater = { influence: 0 };
  for (let index = 0; index < moonPositions.count; index++) {
    normal.fromBufferAttribute(moonPositions, index).normalize();
    const height = getMoonHeight(normal);
    sampleMoonMacroGeology(normal, macroGeology);
    sampleMoonColdTrap(normal, coldTrap);
    sampleMoonRayedCrater(normal, rayedCrater);
    sampleMoonSecondaryCraters(normal, secondaryCrater);
    moonPositions.setXYZ(
      index,
      normal.x * (MOON_RADIUS + height),
      normal.y * (MOON_RADIUS + height),
      normal.z * (MOON_RADIUS + height)
    );
    color.copy(baseRegolith)
      .lerp(mareBasalt, macroGeology.mare * 0.62)
      .lerp(highlandAnorthosite, macroGeology.highland * 0.34)
      .lerp(basinMarginRegolith, macroGeology.margin * 0.24)
      .lerp(wrinkleRidgeBasalt, Math.min(0.54, macroGeology.wrinkle * 0.82))
      .lerp(coldTrapRegolith, Math.min(1, coldTrap.bowl * 1.45 + coldTrap.floor * 0.4))
      .lerp(freshRimRegolith, coldTrap.rim * 0.48)
      .lerp(impactMelt, Math.min(0.62, rayedCrater.bowl * 0.42 + rayedCrater.floor * 0.24 + secondaryCrater.influence * 0.28))
      .lerp(freshEjecta, Math.min(0.72, rayedCrater.rim * 0.62 + rayedCrater.ray * 0.48 + rayedCrater.centralPeak * 0.36));
    moonColors[index * 3] = color.r;
    moonColors[index * 3 + 1] = color.g;
    moonColors[index * 3 + 2] = color.b;
  }
  moonGeometry.setAttribute('color', new THREE.BufferAttribute(moonColors, 3));
  moonGeometry.computeVertexNormals();
  const moon = new THREE.Mesh(
    moonGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      emissive: 0x241f25,
      emissiveIntensity: 0.22,
      flatShading: false,
    })
  );
  moonSurface = moon;
  distantMoon.add(moon);

  const craterMaterial = new THREE.MeshBasicMaterial({ color: 0x625b5d, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
  [
    { x: -5.1, y: 3.6, r: 2.4 },
    { x: 4.35, y: 5.55, r: 1.5 },
    { x: 5.85, y: -3.75, r: 2.85 },
    { x: -2.7, y: -6.45, r: 1.35 },
    { x: 0.9, y: 0.45, r: 1.12 },
  ].forEach((crater) => {
    const z = Math.sqrt(Math.max(0, MOON_RADIUS * MOON_RADIUS - crater.x * crater.x - crater.y * crater.y)) + 0.035;
    const mark = new THREE.Mesh(new THREE.CircleGeometry(crater.r, 24), craterMaterial);
    mark.position.set(crater.x, crater.y, z);
    distantMoon.add(mark);
  });
  distantMoon.lookAt(0, 0, 0);
  scene.add(distantMoon);
}

const MOON_EARTH_TANGENT = UP.clone()
  .addScaledVector(MOON_PAD_NORMAL, -UP.dot(MOON_PAD_NORMAL))
  .normalize()
  .applyAxisAngle(MOON_PAD_NORMAL, -0.92);
const MOON_EARTH_VIEW_DIRECTION = MOON_EARTH_TANGENT.clone().applyAxisAngle(MOON_PAD_NORMAL, Math.PI);
const MOON_EARTH_VIEW_NORMAL = stepWorldNormal(MOON_PAD_NORMAL, MOON_EARTH_VIEW_DIRECTION, 10.2, MOON_RADIUS);
const MOON_EARTH_VIEW_SIDE = new THREE.Vector3().crossVectors(MOON_PAD_NORMAL, MOON_EARTH_TANGENT);
const MOON_EARTH_VIEW_HEADING = MOON_EARTH_VIEW_SIDE.clone()
  .addScaledVector(MOON_EARTH_VIEW_NORMAL, -MOON_EARTH_VIEW_SIDE.dot(MOON_EARTH_VIEW_NORMAL))
  .normalize();
const MOON_EARTH_DIRECTION = MOON_EARTH_VIEW_HEADING.clone().multiplyScalar(0.98)
  .addScaledVector(MOON_EARTH_VIEW_NORMAL, -0.2)
  .normalize();

function buildEarthTextureSet() {
  const width = isTouchDevice ? 256 : 512;
  const height = width / 2;
  const surfaceCanvas = document.createElement('canvas');
  const cloudCanvas = document.createElement('canvas');
  const cityCanvas = document.createElement('canvas');
  surfaceCanvas.width = cloudCanvas.width = cityCanvas.width = width;
  surfaceCanvas.height = cloudCanvas.height = cityCanvas.height = height;
  const surfaceContext = surfaceCanvas.getContext('2d');
  const cloudContext = cloudCanvas.getContext('2d');
  const cityContext = cityCanvas.getContext('2d');
  const surfaceImage = surfaceContext.createImageData(width, height);
  const cloudImage = cloudContext.createImageData(width, height);
  const cityImage = cityContext.createImageData(width, height);
  const oceanDeep = new THREE.Color(0x062c70);
  const oceanShelf = new THREE.Color(0x1495bd);
  const landLow = new THREE.Color(0x3f6c3d);
  const landDry = new THREE.Color(0x9b7749);
  const mountain = new THREE.Color(0x746b5e);
  const ice = new THREE.Color(0xf2f6f6);
  const pixelColor = new THREE.Color();
  const longitudeDelta = (angle, center) => Math.atan2(Math.sin(angle - center), Math.cos(angle - center));

  for (let y = 0; y < height; y++) {
    const v = y / Math.max(1, height - 1);
    const latitude = (0.5 - v) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const polar = THREE.MathUtils.smoothstep(Math.abs(latitude), 1.18, 1.48);
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const longitude = (u - 0.5) * Math.PI * 2;
      const nx = cosLatitude * Math.cos(longitude);
      const ny = Math.sin(latitude);
      const nz = cosLatitude * Math.sin(longitude);
      const continentalNoise = fbm3(nx * 1.35 + 3.2, ny * 1.35 - 5.7, nz * 1.35 + 8.4)
        + noise3(nx * 3.8 - 7, ny * 3.8 + 2, nz * 3.8 + 5) * 0.21;
      const continentBlob = Math.max(
        Math.exp(-Math.pow(longitudeDelta(longitude, -1.82) / 0.42, 2) - Math.pow((latitude - 0.55) / 0.48, 2)),
        Math.exp(-Math.pow(longitudeDelta(longitude, -1.48) / 0.3, 2) - Math.pow((latitude + 0.32) / 0.62, 2)),
        Math.exp(-Math.pow(longitudeDelta(longitude, 0.1) / 0.42, 2) - Math.pow((latitude + 0.05) / 0.64, 2)),
        Math.exp(-Math.pow(longitudeDelta(longitude, 0.78) / 1.0, 2) - Math.pow((latitude - 0.56) / 0.42, 2)),
        Math.exp(-Math.pow(longitudeDelta(longitude, 2.2) / 0.38, 2) - Math.pow((latitude + 0.48) / 0.27, 2))
      );
      const elevation = continentBlob + continentalNoise * 0.34 - 0.53;
      const coast = THREE.MathUtils.smoothstep(elevation, -0.08, 0.075);
      const aridity = noise3(nx * 5.2 + 11, ny * 5.2 - 3, nz * 5.2 + 6) * 0.5 + 0.5;
      const relief = THREE.MathUtils.smoothstep(elevation, 0.18, 0.58);
      pixelColor.copy(oceanDeep).lerp(oceanShelf, coast * 0.82);
      if (elevation > 0) pixelColor.copy(landLow).lerp(landDry, aridity * 0.72).lerp(mountain, relief * 0.68);
      pixelColor.lerp(ice, polar * (0.76 + Math.max(0, elevation) * 0.22));
      const offset = (y * width + x) * 4;
      surfaceImage.data[offset] = Math.round(pixelColor.r * 255);
      surfaceImage.data[offset + 1] = Math.round(pixelColor.g * 255);
      surfaceImage.data[offset + 2] = Math.round(pixelColor.b * 255);
      surfaceImage.data[offset + 3] = 255;

      const cloudNoise = fbm3(nx * 3.2 - 13, ny * 3.2 + 4, nz * 3.2 + 9)
        + noise3(nx * 9 + 2, ny * 9 - 12, nz * 9 + 7) * 0.24;
      const stormBands = Math.sin(latitude * 13 + longitude * 1.8 + cloudNoise * 2.4) * 0.14;
      const cloudDensity = THREE.MathUtils.smoothstep(cloudNoise + stormBands, 0.02, 0.48) * (1 - polar * 0.28);
      cloudImage.data[offset] = 242;
      cloudImage.data[offset + 1] = 249;
      cloudImage.data[offset + 2] = 255;
      cloudImage.data[offset + 3] = Math.round(cloudDensity * 235);

      const cityChance = hash3(x * 0.37 + 4, y * 0.41 - 9, Math.floor(continentalNoise * 23));
      const inhabitedLatitude = 1 - THREE.MathUtils.smoothstep(Math.abs(latitude), 0.85, 1.22);
      const city = elevation > 0.04 && relief < 0.68 && cityChance > 0.992 && inhabitedLatitude > 0.1;
      cityImage.data[offset] = city ? 255 : 0;
      cityImage.data[offset + 1] = city ? 168 : 0;
      cityImage.data[offset + 2] = city ? 72 : 0;
      cityImage.data[offset + 3] = 255;
    }
  }
  surfaceContext.putImageData(surfaceImage, 0, 0);
  cloudContext.putImageData(cloudImage, 0, 0);
  cityContext.putImageData(cityImage, 0, 0);
  const surfaceTexture = new THREE.CanvasTexture(surfaceCanvas);
  const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
  const cityTexture = new THREE.CanvasTexture(cityCanvas);
  surfaceTexture.colorSpace = cloudTexture.colorSpace = cityTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.anisotropy = cloudTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return { surfaceTexture, cloudTexture, cityTexture };
}

function buildDistantEarth() {
  const group = new THREE.Group();
  group.name = 'Earthrise · distant Earth from lunar surface';
  group.position.copy(MOON_CENTER).addScaledVector(MOON_EARTH_DIRECTION, 145);
  group.visible = false;

  const spinRoot = new THREE.Group();
  spinRoot.rotation.z = THREE.MathUtils.degToRad(23.4);
  group.add(spinRoot);

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    emissive: 0xffb36a,
    emissiveIntensity: 0.86,
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    opacity: 0,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(6.35, isTouchDevice ? 40 : 64, isTouchDevice ? 24 : 40), surfaceMaterial);
  spinRoot.add(surface);

  const cloudMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    roughness: 1,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(6.46, isTouchDevice ? 40 : 64, isTouchDevice ? 24 : 40), cloudMaterial);
  spinRoot.add(clouds);

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.35);
        gl_FragColor = vec4(0.2, 0.62, 1.0, rim * 0.62 * uOpacity);
      }
    `,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(6.78, 48, 28), atmosphereMaterial);
  group.add(atmosphere);

  scene.add(group);
  return {
    group,
    spinRoot,
    surface,
    surfaceMaterial,
    clouds,
    cloudMaterial,
    atmosphere,
    atmosphereMaterial,
    textures: null,
  };
}

function ensureEarthriseTextures() {
  if (!earthriseRuntime || earthriseRuntime.textures) return;
  const textures = buildEarthTextureSet();
  earthriseRuntime.surfaceMaterial.map = textures.surfaceTexture;
  earthriseRuntime.surfaceMaterial.emissiveMap = textures.cityTexture;
  earthriseRuntime.surfaceMaterial.needsUpdate = true;
  earthriseRuntime.cloudMaterial.map = textures.cloudTexture;
  earthriseRuntime.cloudMaterial.needsUpdate = true;
  earthriseRuntime.textures = textures;
}

function buildZephyra() {
  const group = new THREE.Group();
  group.name = 'Zephyra · electric storm planet';
  group.position.copy(ZEPHYRA_CENTER);

  const geometry = new THREE.SphereGeometry(ZEPHYRA_RADIUS, isTouchDevice ? 96 : 160, isTouchDevice ? 64 : 112);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const normal = new THREE.Vector3();
  const lowland = new THREE.Color(0x142c4f);
  const mineral = new THREE.Color(0x2b8f91);
  const crystal = new THREE.Color(0x8de4d2);
  const violet = new THREE.Color(0x60419c);
  const canyonGlass = new THREE.Color(0x081523);
  const ionEdge = new THREE.Color(0x52d6d2);
  const color = new THREE.Color();
  const canyon = { trench: 0, wall: 0, distance: Infinity };
  for (let index = 0; index < positions.count; index++) {
    normal.fromBufferAttribute(positions, index).normalize();
    const height = getZephyraHeight(normal);
    const mineralVein = Math.pow(Math.max(0, noise3(normal.x * 18 + 2, normal.y * 18 - 5, normal.z * 18 + 9)), 2.2);
    sampleZephyraIonCanyon(normal, canyon);
    positions.setXYZ(index, normal.x * (ZEPHYRA_RADIUS + height), normal.y * (ZEPHYRA_RADIUS + height), normal.z * (ZEPHYRA_RADIUS + height));
    color.copy(lowland)
      .lerp(mineral, THREE.MathUtils.smoothstep(height, -1.1, 1.2) * 0.82)
      .lerp(crystal, Math.max(0, height - 0.7) * 0.18)
      .lerp(violet, mineralVein * 0.34)
      .lerp(canyonGlass, canyon.trench * 0.78)
      .lerp(ionEdge, canyon.wall * 0.34);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.08 })
  );
  group.add(surface);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(ZEPHYRA_RADIUS + 1.45, 64, 40),
    new THREE.MeshBasicMaterial({
      color: 0x6cebd9,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  group.add(atmosphere);

  const auroraMaterial = new THREE.MeshBasicMaterial({
    color: 0xa783ff,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const aurora = new THREE.Mesh(new THREE.TorusGeometry(ZEPHYRA_RADIUS + 2.2, 0.18, 8, 96), auroraMaterial);
  aurora.rotation.set(1.14, 0.38, -0.22);
  group.add(aurora);

  scene.add(group);
  return { group, surface, atmosphere, aurora, auroraMaterial };
}

function buildShootingStar() {
  shootingStar = new THREE.Group();
  const direction = shootingStarEnd.clone().sub(shootingStarStart).normalize();
  shootingStar.quaternion.setFromUnitVectors(UP, direction);

  shootingStarTrailMaterial = new THREE.MeshBasicMaterial({
    color: 0x9de9ff,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Mesh(new THREE.ConeGeometry(3.2, 88, 10, 1, true), shootingStarTrailMaterial);
  trail.position.y = -44;
  shootingStar.add(trail);

  shootingStarGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5fdff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), shootingStarGlowMaterial);
  shootingStar.add(head);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(6.4, 16, 12), shootingStarGlowMaterial.clone());
  halo.material.opacity = 0.2;
  shootingStar.add(halo);

  shootingStar.position.copy(shootingStarStart);
  scene.add(shootingStar);
}

function updateShootingStar(time) {
  const cycle = time % 10.5;
  const duration = 3.2;
  shootingStar.visible = cycle < duration;
  if (!shootingStar.visible) return;
  const progress = cycle / duration;
  const easedProgress = progress * progress * (3 - 2 * progress);
  shootingStar.position.lerpVectors(shootingStarStart, shootingStarEnd, easedProgress);
  const fade = Math.sin(progress * Math.PI);
  shootingStarTrailMaterial.opacity = fade * 0.84;
  shootingStarGlowMaterial.opacity = Math.min(1, fade * 1.8);
}

function buildSpace() {
  const starCount = isTouchDevice ? 900 : 1800;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const star = randomUnitVector().multiplyScalar((260 + Math.random() * 130) * PLANET_SCALE);
    starPositions[i * 3] = star.x;
    starPositions[i * 3 + 1] = star.y;
    starPositions[i * 3 + 2] = star.z;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xf7ecdc, size: 1.3, transparent: true, opacity: 0.92, fog: false })));

  const nebulaCount = isTouchDevice ? 240 : 520;
  const nebulaPositions = new Float32Array(nebulaCount * 3);
  for (let i = 0; i < nebulaCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = (315 + (Math.random() - 0.5) * 45) * PLANET_SCALE;
    nebulaPositions[i * 3] = Math.cos(angle) * radius;
    nebulaPositions[i * 3 + 1] = ((Math.random() - 0.5) * 38 + Math.sin(angle * 2) * 16) * PLANET_SCALE;
    nebulaPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const nebulaGeometry = new THREE.BufferGeometry();
  nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(nebulaPositions, 3));
  const nebula = new THREE.Points(nebulaGeometry, new THREE.PointsMaterial({ color: 0x7b6eb5, size: 4.4, transparent: true, opacity: 0.24, depthWrite: false, fog: false }));
  nebula.rotation.z = -0.46;
  scene.add(nebula);

  sunMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime;
      void main(){
        vec2 p=(vUv-0.5)*2.0;
        p.x += sin(p.y*44.0+uTime*2.0)*0.025 + sin(p.y*83.0-uTime)*0.01;
        p.y*=1.32;
        float r=length(p);
        float disc=1.0-smoothstep(0.3,0.34,r);
        float halo=exp(-r*3.2)*0.82;
        vec3 color=mix(vec3(1.0,0.26,0.06),vec3(1.0,0.95,0.66),disc);
        gl_FragColor=vec4(color,max(disc,halo*0.48));
      }
    `,
  });
  distortedSun = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), sunMaterial);
  distortedSun.position.set(270, 170, -470);
  scene.add(distortedSun);

  buildDistantMoon();
  earthriseRuntime = buildDistantEarth();
  // Generate this deterministic texture while the loading screen is still up.
  // Deferring it into an idle callback caused a visible mid-game frame stall.
  ensureEarthriseTextures();
  buildZephyra();
  buildShootingStar();
}
buildSpace();

const hemisphereLight = new THREE.HemisphereLight(0xf2a879, 0x120910, 0.85);
scene.add(hemisphereLight);
const sunLight = new THREE.DirectionalLight(0xffc68f, 1.8);
sunLight.position.set(270, 170, -470);
scene.add(sunLight);
const ambientLight = new THREE.AmbientLight(0x9b5970, 0.16);
scene.add(ambientLight);

// The Moon gets its own grazing solar key instead of inheriting Mars' warm,
// shadowless ambience. The light follows the active lunar area so one compact
// shadow map can resolve the alien, vehicles, and habitat silhouettes without
// redrawing the planet-scale regolith into the shadow map.
const moonSolarTangent = new THREE.Vector3(1, 0, 0)
  .addScaledVector(MOON_PAD_NORMAL, -MOON_PAD_NORMAL.x)
  .normalize()
  .applyAxisAngle(MOON_PAD_NORMAL, -0.42);
const moonSolarDirection = moonSolarTangent.clone()
  .multiplyScalar(0.965)
  .addScaledVector(MOON_PAD_NORMAL, 0.26)
  .normalize();
const moonSunTarget = new THREE.Object3D();
moonSunTarget.position.copy(MOON_CENTER).addScaledVector(MOON_PAD_NORMAL, MOON_RADIUS);
scene.add(moonSunTarget);
const moonSunLight = new THREE.DirectionalLight(0xfff2da, 0);
moonSunLight.target = moonSunTarget;
moonSunLight.castShadow = true;
moonSunLight.shadow.mapSize.set(isTouchDevice ? 512 : 1024, isTouchDevice ? 512 : 1024);
moonSunLight.shadow.camera.near = 0.5;
moonSunLight.shadow.camera.far = 105;
moonSunLight.shadow.camera.left = -20;
moonSunLight.shadow.camera.right = 20;
moonSunLight.shadow.camera.top = 20;
moonSunLight.shadow.camera.bottom = -20;
moonSunLight.shadow.bias = -0.00035;
moonSunLight.shadow.normalBias = 0.055;
moonSunLight.shadow.radius = isTouchDevice ? 1 : 2;
scene.add(moonSunLight);
const moonBounceLight = new THREE.HemisphereLight(0x9eb9d2, 0x05070d, 0);
scene.add(moonBounceLight);
const moonEarthLightTarget = new THREE.Object3D();
moonEarthLightTarget.position.copy(MOON_CENTER).addScaledVector(MOON_PAD_NORMAL, MOON_RADIUS);
scene.add(moonEarthLightTarget);
const moonEarthLight = new THREE.DirectionalLight(0x6d9fe0, 0);
moonEarthLight.position.copy(earthriseRuntime.group.position);
moonEarthLight.target = moonEarthLightTarget;
scene.add(moonEarthLight);
let moonLightingBlend = 0;

/* ---------- spherical Mars mesh ---------- */

function buildPlanet() {
  const widthSegments = isTouchDevice ? 128 : 256;
  const heightSegments = isTouchDevice ? 92 : 184;
  const geometry = new THREE.SphereGeometry(PLANET_RADIUS, widthSegments, heightSegments);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const normal = new THREE.Vector3();
  const shadow = new THREE.Color(0x5f2419);
  const dust = new THREE.Color(0xb95431);
  const sunlit = new THREE.Color(0xe28a52);
  const basalt = new THREE.Color(0x43272a);
  const highlandOchre = new THREE.Color(0xd88852);
  const oxide = new THREE.Color(0xc64c2c);
  const duneSand = new THREE.Color(0xd17a45);
  const duneLee = new THREE.Color(0x6c3021);
  const sedimentPale = new THREE.Color(0xd49362);
  const sedimentDark = new THREE.Color(0x713b2e);
  const yardangOchre = new THREE.Color(0xad5937);
  const yardangLee = new THREE.Color(0x4e251f);
  const impactRim = new THREE.Color(0xd89a71);
  const impactWall = new THREE.Color(0x5a2c26);
  const impactMelt = new THREE.Color(0x251b20);
  const impactEjecta = new THREE.Color(0xbf6948);
  const color = new THREE.Color();
  const geology = { highland: 0, basin: 0, shield: 0, rift: 0 };
  const aeolian = { influence: 0, lee: 0 };
  const escarpment = { along: 0, across: 0, influence: 0, cliff: 0, height: 0 };
  const yardang = { along: 0, across: 0, influence: 0, ridge: 0, lee: 0 };
  const impact = { distance: 0, bowl: 0, rim: 0, wall: 0, terraces: 0, centralPeak: 0, floor: 0, ejecta: 0 };
  for (let i = 0; i < positions.count; i++) {
    normal.fromBufferAttribute(positions, i).normalize();
    const height = getSurfaceHeight(normal);
    const grain = noise3(normal.x * 62, normal.y * 62, normal.z * 62) * 0.5 + 0.5;
    const altitude = THREE.MathUtils.clamp((height + 4) / 9, 0, 1);
    const oxideVein = Math.pow(Math.max(0, noise3(normal.x * 14 - 3, normal.y * 14 + 8, normal.z * 14 - 5)), 2.4);
    const strata = Math.sin(height * 3.4 + noise3(normal.x * 24, normal.y * 24, normal.z * 24) * 1.8) * 0.5 + 0.5;
    sampleMarsMacroGeology(normal, geology);
    sampleMarsAeolianDunes(normal, aeolian);
    sampleMarsSedimentaryEscarpment(normal, escarpment);
    sampleMarsYardangField(normal, yardang);
    sampleMarsImpactBasin(normal, impact);
    positions.setXYZ(i, normal.x * (PLANET_RADIUS + height), normal.y * (PLANET_RADIUS + height), normal.z * (PLANET_RADIUS + height));
    color.copy(shadow).lerp(dust, 0.42 + grain * 0.28).lerp(sunlit, altitude * 0.38);
    color.lerp(basalt, geology.basin * 0.34 + geology.rift * 0.42);
    color.lerp(highlandOchre, (geology.highland * 0.24 + geology.shield * 0.2) * (0.65 + strata * 0.35));
    color.lerp(oxide, oxideVein * 0.13);
    color.lerp(duneSand, aeolian.influence * 0.48);
    color.lerp(duneLee, aeolian.lee * 0.32);
    const beddingTone = Math.sin(height * 5.8 + escarpment.along * 0.18) * 0.5 + 0.5;
    color.lerp(sedimentDark, escarpment.cliff * (0.16 + beddingTone * 0.16));
    color.lerp(sedimentPale, escarpment.influence * (0.1 + (1 - beddingTone) * 0.12));
    color.lerp(yardangOchre, yardang.ridge * 0.38);
    color.lerp(yardangLee, yardang.lee * 0.32);
    color.lerp(impactWall, impact.wall * 0.52 + impact.bowl * 0.08);
    color.lerp(impactMelt, impact.floor * 0.62);
    color.lerp(impactRim, impact.rim * 0.52 + impact.terraces * 0.2);
    color.lerp(impactEjecta, impact.ejecta * 0.42);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const planet = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  scene.add(planet);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + 2.5, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vNormal; varying vec3 vView; void main(){ vec4 world=modelMatrix*vec4(position,1.0); vNormal=normalize(mat3(modelMatrix)*normal); vView=normalize(cameraPosition-world.xyz); gl_Position=projectionMatrix*viewMatrix*world; }`,
      fragmentShader: `varying vec3 vNormal; varying vec3 vView; void main(){ float rim=pow(1.0-abs(dot(vNormal,vView)),2.7); gl_FragColor=vec4(0.9,0.22,0.08,rim*0.38); }`,
    })
  );
  scene.add(atmosphere);
}
buildPlanet();
setLoadingStage(44, 'SCULPTING MARTIAN TERRAIN');

/* ---------- dust shell, devils & rocks ---------- */

function makeDustTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,211,162,0.72)');
  gradient.addColorStop(0.34, 'rgba(229,146,91,0.34)');
  gradient.addColorStop(1, 'rgba(190,92,52,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const dustTexture = makeDustTexture();
const airborneDustCount = isTouchDevice ? 320 : 650;
const airborneDustPositions = new Float32Array(airborneDustCount * 3);
for (let i = 0; i < airborneDustCount; i++) {
  const normal = randomUnitVector();
  const position = normal.clone().multiplyScalar(PLANET_RADIUS + getSurfaceHeight(normal) + 0.5 + Math.random() * 4.2);
  airborneDustPositions[i * 3] = position.x;
  airborneDustPositions[i * 3 + 1] = position.y;
  airborneDustPositions[i * 3 + 2] = position.z;
}
const airborneDustGeometry = new THREE.BufferGeometry();
airborneDustGeometry.setAttribute('position', new THREE.BufferAttribute(airborneDustPositions, 3));
const airborneDust = new THREE.Points(
  airborneDustGeometry,
  new THREE.PointsMaterial({ map: dustTexture, color: 0xe98d58, size: 0.7, transparent: true, opacity: 0.26, depthWrite: false })
);
scene.add(airborneDust);

function buildAeolianSaltation() {
  const count = isTouchDevice ? 210 : 420;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const grains = [];
  const paleDust = new THREE.Color(0xe7a06f);
  const ironDust = new THREE.Color(0xb85b38);
  const grainColor = new THREE.Color();
  let seed = 0x5a17a7e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let index = 0; index < count; index++) {
    const field = MARS_DUNE_FIELDS[Math.floor(random() * MARS_DUNE_FIELDS.length)];
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 0.88;
    const along = Math.cos(angle) * field.alongRadius * radius;
    const across = Math.sin(angle) * field.acrossRadius * radius;
    const alongNormal = stepWorldNormal(field.normal, field.wind, along, PLANET_RADIUS);
    const normal = stepWorldNormal(alongNormal, field.across, across, PLANET_RADIUS);
    const wind = field.wind.clone().addScaledVector(normal, -field.wind.dot(normal)).normalize();
    grains.push({
      normal,
      axis: normal.clone().cross(wind).normalize(),
      surfaceRadius: PLANET_RADIUS + getSurfaceHeight(normal),
      phase: random(),
      liftPhase: random() * Math.PI * 2,
      speed: 1.4 + random() * 3.8,
      path: 2.2 + random() * 4.8,
    });
    grainColor.copy(ironDust).lerp(paleDust, random() * 0.72);
    colors[index * 3] = grainColor.r;
    colors[index * 3 + 1] = grainColor.g;
    colors[index * 3 + 2] = grainColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: dustTexture,
      vertexColors: true,
      size: isTouchDevice ? 0.52 : 0.42,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
  );
  points.name = 'Wind-driven dune saltation';
  scene.add(points);
  return { points, grains, positions };
}

const aeolianSaltation = buildAeolianSaltation();
const saltationNormal = new THREE.Vector3();

function updateAeolianSaltation(time) {
  aeolianSaltation.grains.forEach((grain, index) => {
    const cycle = (grain.phase + time * grain.speed / grain.path) % 1;
    const travel = (cycle - 0.5) * grain.path;
    saltationNormal.copy(grain.normal).applyAxisAngle(grain.axis, travel / PLANET_RADIUS).normalize();
    const ballisticArc = Math.pow(Math.sin(cycle * Math.PI), 2.4);
    const flutter = Math.sin(time * 8.5 + grain.liftPhase) * 0.08;
    const radius = grain.surfaceRadius + 0.18 + ballisticArc * 0.78 + flutter;
    const offset = index * 3;
    aeolianSaltation.positions[offset] = saltationNormal.x * radius;
    aeolianSaltation.positions[offset + 1] = saltationNormal.y * radius;
    aeolianSaltation.positions[offset + 2] = saltationNormal.z * radius;
  });
  aeolianSaltation.points.geometry.attributes.position.needsUpdate = true;
}
updateAeolianSaltation(0);

const MARS_DUST_FRONT_START = normalFromSurfaceCoords(-92, -34);
const MARS_DUST_FRONT_END = normalFromSurfaceCoords(98, 46);
const marsDustFrontNormal = MARS_DUST_FRONT_START.clone();
const marsDustFrontHeading = new THREE.Vector3();
const marsDustFog = new THREE.FogExp2(0x9b4b2f, 0);
const clearSunColor = new THREE.Color(0xffc68f);
const stormSunColor = new THREE.Color(0xff7b45);
const clearHemisphereSky = new THREE.Color(0xf2a879);
const stormHemisphereSky = new THREE.Color(0x9b4a31);
const clearHemisphereGround = new THREE.Color(0x120910);
const stormHemisphereGround = new THREE.Color(0x3b1711);
const stormSkyColor = new THREE.Color(0x5c2118);
let marsDustStormBlend = 0;
let marsDustStormWasNear = false;

function buildMarsDustFront() {
  const group = new THREE.Group();
  group.name = 'Moving regional Mars dust front';
  const count = isTouchDevice ? 280 : 520;
  const positions = new Float32Array(count * 3);
  const seeds = [];
  let seed = 0xd057f20;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < count; index++) {
    const heightBias = Math.pow(random(), 1.65);
    seeds.push({
      x: (random() - 0.5) * 58,
      y: 0.35 + heightBias * 16,
      z: (random() - 0.5) * (5 + heightBias * 10),
      speed: 2.8 + random() * 5.6,
      phase: random() * Math.PI * 2,
      swirl: 0.35 + random() * 1.4,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const curtainMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float sideFade = smoothstep(0.0, 0.13, vUv.x) * smoothstep(0.0, 0.13, 1.0 - vUv.x);
        float groundFade = smoothstep(0.0, 0.12, vUv.y);
        float topFade = 1.0 - smoothstep(0.58, 1.0, vUv.y);
        float broadNoise = sin(vUv.x * 18.0 + uTime * 0.42) * sin(vUv.y * 13.0 - uTime * 0.27);
        float fineNoise = sin(vUv.x * 47.0 - vUv.y * 29.0 + uTime * 0.63);
        float density = 0.15 + broadNoise * 0.042 + fineNoise * 0.022;
        gl_FragColor = vec4(vec3(0.64, 0.25, 0.12), max(0.0, density) * sideFade * groundFade * topFade);
      }
    `,
  });
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(70, 30), curtainMaterial);
  curtain.name = 'Regional dust front leading curtain';
  curtain.position.set(0, 13.2, 0.8);
  group.add(curtain);
  const material = new THREE.PointsMaterial({
    map: dustTexture,
    color: 0xc97043,
    size: isTouchDevice ? 1.45 : 1.18,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  group.add(particles);
  scene.add(group);
  return { group, curtain, curtainMaterial, particles, material, positions, seeds };
}

const marsDustFront = buildMarsDustFront();

function updateMarsDustFront(dt, time, activeMarsNormal) {
  const travelCycle = (time / 82) % 2;
  const routeProgress = travelCycle <= 1 ? travelCycle : 2 - travelCycle;
  marsDustFrontNormal.copy(slerpNormals(MARS_DUST_FRONT_START, MARS_DUST_FRONT_END, routeProgress));
  marsDustFrontHeading.copy(MARS_DUST_FRONT_END)
    .addScaledVector(marsDustFrontNormal, -MARS_DUST_FRONT_END.dot(marsDustFrontNormal))
    .normalize();
  if (travelCycle > 1) marsDustFrontHeading.multiplyScalar(-1);
  marsDustFront.group.position.copy(surfaceWorldPosition(marsDustFrontNormal, 0.12));
  marsDustFront.group.quaternion.copy(surfaceVehicleQuaternion(marsDustFrontNormal, marsDustFrontHeading));

  marsDustFront.seeds.forEach((grain, index) => {
    const x = ((grain.x + time * grain.speed + 29) % 58) - 29;
    const y = Math.max(0.18, grain.y + Math.sin(time * grain.swirl + grain.phase) * (0.24 + grain.y * 0.035));
    const z = grain.z + Math.sin(time * (0.7 + grain.swirl * 0.2) + grain.phase) * (0.7 + grain.y * 0.06);
    const offset = index * 3;
    marsDustFront.positions[offset] = x;
    marsDustFront.positions[offset + 1] = y;
    marsDustFront.positions[offset + 2] = z;
  });
  marsDustFront.particles.geometry.attributes.position.needsUpdate = true;
  marsDustFront.curtainMaterial.uniforms.uTime.value = time;
  marsDustFront.material.opacity = 0.18 + (Math.sin(time * 0.9) * 0.5 + 0.5) * 0.1;

  let targetBlend = 0;
  if (activeMarsNormal) {
    const distance = geodesicDistance(activeMarsNormal, marsDustFrontNormal);
    targetBlend = 1 - THREE.MathUtils.smoothstep(distance, 12, 56);
  }
  marsDustStormBlend = THREE.MathUtils.damp(marsDustStormBlend, targetBlend, 2.6, dt);
  const atmosphereBlend = activeMarsNormal ? marsDustStormBlend * (1 - caveDarkness) : 0;

  sunLight.color.lerpColors(clearSunColor, stormSunColor, atmosphereBlend);
  hemisphereLight.color.lerpColors(clearHemisphereSky, stormHemisphereSky, atmosphereBlend);
  hemisphereLight.groundColor.lerpColors(clearHemisphereGround, stormHemisphereGround, atmosphereBlend);
  scene.background.copy(clearSpaceColor).lerp(stormSkyColor, atmosphereBlend * 0.88);
  if (atmosphereBlend > 0.01) {
    marsDustFog.density = THREE.MathUtils.lerp(0.0015, 0.022, atmosphereBlend);
    scene.fog = marsDustFog;
  } else if (scene.fog === marsDustFog) {
    scene.fog = null;
  }
  if (targetBlend > 0.46 && !marsDustStormWasNear) {
    marsDustStormWasNear = true;
    showBanner('REGIONAL DUST FRONT ARRIVING · VISIBILITY FALLING');
  } else if (targetBlend < 0.06 && marsDustStormWasNear) {
    marsDustStormWasNear = false;
    showBanner('DUST FRONT PASSED · HORIZON CLEARING');
  }
}

const dustDevils = [];
function buildDustDevils() {
  [{ x: 38, z: -8 }, { x: -36, z: 30 }].forEach((location, devilIndex) => {
    const count = isTouchDevice ? 38 : 66;
    const positions = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const y = Math.random() * 9;
      const radius = 0.25 + y * 0.09 + Math.random() * 0.45;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds.push({ y, radius, angle, speed: 0.7 + Math.random() * 1.2 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: dustTexture, color: 0xd77b49, size: 1.0, transparent: true, opacity: 0.3, depthWrite: false }));
    placeSurfaceGroup(points, normalFromSurfaceCoords(location.x, location.z));
    dustDevils.push({ points, seeds, phase: devilIndex * 2.1 });
  });
}
buildDustDevils();

const obstacles = [];
function addCollider(x, z, radius) {
  obstacles.push({ normal: normalFromSurfaceCoords(x, z), radius });
}

function buildRocks() {
  const count = isTouchDevice ? 72 : 128;
  const rockArchetypes = ['basalt', 'dusted', 'ventifact', 'breccia', 'sedimentary', 'basalt'];
  const rockGeometries = rockArchetypes.map((archetype, index) => createProceduralRockGeometry({
    THREE,
    seed: 0x4d415253 + index * 7919,
    detail: isTouchDevice ? 1 : 2,
    archetype,
    ruggedness: 0.92 + (index % 3) * 0.12,
  }));
  const material = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0x4d415253,
    roughness: 0.96,
    bumpScale: isTouchDevice ? 0.045 : 0.075,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xc77a4d,
    dustStrength: 0.3,
  });
  const rockPalette = [0x85503d, 0x995a3f, 0xa76645, 0xb2734f, 0x77483b, 0x9e674c];
  const contactShadowRecords = [];
  const align = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  const chunkCount = isTouchDevice ? 10 : 16;
  const chunks = Array.from({ length: chunkCount }, (_, index) => {
    const y = 1 - ((index + 0.5) * 2) / chunkCount;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return {
      direction: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
      rocks: [],
    };
  });
  let seed = 0x4d415253;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const randomRockNormal = () => {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  };
  let placed = 0;
  while (placed < count) {
    const normal = randomRockNormal();
    if (geodesicDistance(normal, START_NORMAL) < 12) continue;
    if (geodesicDistance(normal, GARAGE_NORMAL) < 21) continue;
    if (MARS_COURSE_CLEAR_ZONES.some((zone) => geodesicDistance(normal, zone.normal) < zone.radius)) continue;
    if (HUBS.some((hub) => geodesicDistance(normal, hub.normal) < 11)) continue;
    if (geodesicDistance(normal, NIGHTFALL_CAVE.normal) < 25) continue;
    if (geodesicDistance(normal, MARS_PORT.normal) < 8) continue;
    const scale = 0.28 + Math.pow(random(), 2) * 1.75;
    const position = surfaceWorldPosition(normal, scale * 0.3);
    align.setFromUnitVectors(UP, normal);
    yaw.setFromAxisAngle(UP, random() * Math.PI * 2);
    const quaternion = align.clone().multiply(yaw);
    const rockScale = new THREE.Vector3(
      scale * (0.72 + random() * 0.55),
      scale * (0.55 + random() * 0.55),
      scale
    );
    let chunkIndex = 0;
    let closestDirection = -Infinity;
    for (let index = 0; index < chunks.length; index++) {
      const direction = normal.dot(chunks[index].direction);
      if (direction > closestDirection) {
        closestDirection = direction;
        chunkIndex = index;
      }
    }
    const color = new THREE.Color(rockPalette[Math.floor(random() * rockPalette.length)]);
    color.offsetHSL((random() - 0.5) * 0.018, (random() - 0.5) * 0.08, (random() - 0.5) * 0.055);
    chunks[chunkIndex].rocks.push({ position, quaternion, scale: rockScale, color });
    contactShadowRecords.push({
      position: surfaceWorldPosition(normal, 0.028),
      quaternion: quaternion.clone(),
      scaleX: rockScale.x * 0.86,
      scaleZ: rockScale.z * 0.86,
    });
    if (scale > 1.18) obstacles.push({ normal: normal.clone(), radius: scale * 0.82 });
    placed++;
  }

  const group = new THREE.Group();
  group.name = 'Mars rock field · spatially culled chunks';
  const dummy = new THREE.Object3D();
  const chunkCenter = new THREE.Vector3();
  const localPosition = new THREE.Vector3();
  chunks.forEach((chunk, chunkIndex) => {
    if (chunk.rocks.length === 0) return;
    chunkCenter.set(0, 0, 0);
    chunk.rocks.forEach((rock) => chunkCenter.add(rock.position));
    chunkCenter.multiplyScalar(1 / chunk.rocks.length);

    const chunkGeometry = rockGeometries[chunkIndex % rockGeometries.length].clone();
    const baseRadius = chunkGeometry.boundingSphere.radius;
    const mesh = new THREE.InstancedMesh(chunkGeometry, material, chunk.rocks.length);
    mesh.name = `Mars rock field · spatial chunk ${chunkIndex + 1}`;
    mesh.position.copy(chunkCenter);
    let boundsRadius = 0;
    chunk.rocks.forEach((rock, index) => {
      localPosition.copy(rock.position).sub(chunkCenter);
      dummy.position.copy(localPosition);
      dummy.quaternion.copy(rock.quaternion);
      dummy.scale.copy(rock.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, rock.color);
      boundsRadius = Math.max(
        boundsRadius,
        localPosition.length() + baseRadius * Math.max(rock.scale.x, rock.scale.y, rock.scale.z)
      );
    });
    chunkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundsRadius + 0.05);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const contactShadowGeometry = new THREE.CircleGeometry(1, isTouchDevice ? 12 : 18);
  contactShadowGeometry.rotateX(-Math.PI / 2);
  const contactShadows = new THREE.InstancedMesh(
    contactShadowGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x1d0d0a,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    contactShadowRecords.length
  );
  contactShadows.name = 'Mars rocks · shared soft contact shadows';
  contactShadowRecords.forEach((shadow, index) => {
    dummy.position.copy(shadow.position);
    dummy.quaternion.copy(shadow.quaternion);
    dummy.scale.set(shadow.scaleX, 1, shadow.scaleZ);
    dummy.updateMatrix();
    contactShadows.setMatrixAt(index, dummy.matrix);
  });
  contactShadows.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  contactShadows.instanceMatrix.needsUpdate = true;
  contactShadows.frustumCulled = false;
  group.add(contactShadows);
  scene.add(group);
  return group;
}
const marsRockField = buildRocks();

/* ---------- Arabia Terra sedimentary escarpment ---------- */

let marsEscarpmentDiscovered = false;
let marsEscarpmentProximity = 0;

function buildMarsSedimentaryEscarpment() {
  const group = new THREE.Group();
  group.name = 'Mars · Arabia Terra sedimentary escarpment';
  scene.add(group);

  const layerMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0xa7abed5,
    roughness: 0.99,
    bumpScale: 0.045,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xd08a5b,
    dustStrength: 0.18,
  });
  const segmentCount = isTouchDevice ? 7 : 10;
  const layerCount = isTouchDevice ? 4 : 6;
  const layers = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xa7abed5,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'sedimentary',
      ruggedness: 0.72,
    }),
    layerMaterial,
    segmentCount * layerCount
  );
  layers.name = 'Exposed horizontal sandstone beds';
  const dummy = new THREE.Object3D();
  const localAlong = new THREE.Vector3();
  const localAcross = new THREE.Vector3();
  const faceHeading = new THREE.Vector3();
  const layerColor = new THREE.Color();
  let instance = 0;
  for (let segment = 0; segment < segmentCount; segment++) {
    const alongDistance = THREE.MathUtils.lerp(-19.5, 19.5, segment / Math.max(1, segmentCount - 1));
    const alongNormal = stepWorldNormal(MARS_ESCARP_CENTER_NORMAL, MARS_ESCARP_ALONG, alongDistance, PLANET_RADIUS);
    localAcross.copy(MARS_ESCARP_ACROSS).addScaledVector(alongNormal, -MARS_ESCARP_ACROSS.dot(alongNormal)).normalize();
    const faceNormal = stepWorldNormal(alongNormal, localAcross, -2.7, PLANET_RADIUS);
    localAlong.copy(MARS_ESCARP_ALONG).addScaledVector(faceNormal, -MARS_ESCARP_ALONG.dot(faceNormal)).normalize();
    faceHeading.copy(faceNormal).cross(localAlong).normalize();
    for (let layer = 0; layer < layerCount; layer++) {
      const altitude = 0.58 + layer * (4.75 / Math.max(1, layerCount - 1));
      dummy.position.copy(surfaceWorldPosition(faceNormal, altitude));
      dummy.quaternion.copy(surfaceVehicleQuaternion(faceNormal, faceHeading));
      dummy.scale.set(
        4.45,
        0.18 + (layer % 3) * 0.075,
        0.58 + ((segment + layer) % 3) * 0.11
      );
      dummy.updateMatrix();
      layers.setMatrixAt(instance, dummy.matrix);
      layerColor.setHSL(
        0.035 + layer * 0.005,
        0.52 + (segment % 2) * 0.06,
        0.29 + layer * 0.044 + ((segment + layer) % 2) * 0.025
      );
      layers.setColorAt(instance, layerColor);
      instance += 1;
    }
  }
  layers.instanceMatrix.needsUpdate = true;
  if (layers.instanceColor) layers.instanceColor.needsUpdate = true;
  group.add(layers);

  const talusCount = isTouchDevice ? 34 : 62;
  const talus = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xa7ab1a,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'sedimentary',
    }),
    createProceduralRockMaterial({
      THREE,
      color: 0xffffff,
      seed: 0xa7ab1a,
      roughness: 0.98,
      bumpScale: 0.065,
      textureSize: isTouchDevice ? 64 : 96,
      dustColor: 0xc77a4d,
      dustStrength: 0.27,
    }),
    talusCount
  );
  talus.name = 'Angular talus apron';
  let seed = 0xa7ab1a;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const align = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  for (let index = 0; index < talusCount; index++) {
    const alongDistance = (random() - 0.5) * 42;
    const acrossDistance = -4.2 - Math.pow(random(), 0.72) * 10.8;
    const alongNormal = stepWorldNormal(MARS_ESCARP_CENTER_NORMAL, MARS_ESCARP_ALONG, alongDistance, PLANET_RADIUS);
    localAcross.copy(MARS_ESCARP_ACROSS).addScaledVector(alongNormal, -MARS_ESCARP_ACROSS.dot(alongNormal)).normalize();
    const normal = stepWorldNormal(alongNormal, localAcross, acrossDistance, PLANET_RADIUS);
    const scale = 0.18 + Math.pow(random(), 2.1) * 1.05;
    dummy.position.copy(surfaceWorldPosition(normal, scale * 0.24));
    align.setFromUnitVectors(UP, normal);
    yaw.setFromAxisAngle(UP, random() * Math.PI * 2);
    dummy.quaternion.copy(align).multiply(yaw);
    dummy.scale.set(scale * (0.8 + random() * 0.65), scale * (0.42 + random() * 0.38), scale);
    dummy.updateMatrix();
    talus.setMatrixAt(index, dummy.matrix);
    layerColor.setHSL(0.025 + random() * 0.025, 0.4 + random() * 0.16, 0.29 + random() * 0.13);
    talus.setColorAt(index, layerColor);
  }
  talus.instanceMatrix.needsUpdate = true;
  if (talus.instanceColor) talus.instanceColor.needsUpdate = true;
  group.add(talus);

  const capMaterial = createProceduralRockMaterial({
    THREE,
    color: 0x4d2924,
    seed: 0xa7abc4f,
    roughness: 0.96,
    bumpScale: 0.055,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xc47a50,
    dustStrength: 0.2,
  });
  const capstones = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xa7abc4f,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'sedimentary',
      ruggedness: 0.86,
    }),
    capMaterial,
    segmentCount
  );
  for (let segment = 0; segment < segmentCount; segment++) {
    const alongDistance = THREE.MathUtils.lerp(-19.5, 19.5, segment / Math.max(1, segmentCount - 1));
    const alongNormal = stepWorldNormal(MARS_ESCARP_CENTER_NORMAL, MARS_ESCARP_ALONG, alongDistance, PLANET_RADIUS);
    localAcross.copy(MARS_ESCARP_ACROSS).addScaledVector(alongNormal, -MARS_ESCARP_ACROSS.dot(alongNormal)).normalize();
    const capNormal = stepWorldNormal(alongNormal, localAcross, 3.8, PLANET_RADIUS);
    localAlong.copy(MARS_ESCARP_ALONG).addScaledVector(capNormal, -MARS_ESCARP_ALONG.dot(capNormal)).normalize();
    faceHeading.copy(capNormal).cross(localAlong).normalize();
    dummy.position.copy(surfaceWorldPosition(capNormal, 0.16));
    dummy.quaternion.copy(surfaceVehicleQuaternion(capNormal, faceHeading));
    dummy.scale.set(4.5, 0.32 + (segment % 2) * 0.12, 1.15);
    dummy.updateMatrix();
    capstones.setMatrixAt(segment, dummy.matrix);
  }
  capstones.instanceMatrix.needsUpdate = true;
  group.add(capstones);

  const landmarkLabel = makeLabelSprite('ARABIA TERRACE · EXPOSED STRATA', '#f0a36f');
  landmarkLabel.position.copy(surfaceWorldPosition(MARS_ESCARP_CENTER_NORMAL, 9.1));
  landmarkLabel.scale.set(6.3, 1.08, 1);
  scene.add(landmarkLabel);

  return { group, layers, layerMaterial, talus, capstones, landmarkLabel };
}

const marsEscarpmentRuntime = buildMarsSedimentaryEscarpment();

function updateMarsSedimentaryEscarpment(dt, time, activeMarsNormal) {
  let targetProximity = 0;
  if (activeMarsNormal) {
    const distance = geodesicDistance(activeMarsNormal, MARS_ESCARP_CENTER_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 8, 25);
    if (!marsEscarpmentDiscovered && distance < 12.5) {
      marsEscarpmentDiscovered = true;
      showBanner('ARABIA TERRACE DISCOVERED · ANCIENT SEDIMENTARY BEDS');
    }
  }
  marsEscarpmentProximity = THREE.MathUtils.damp(marsEscarpmentProximity, targetProximity, 5, dt);
  marsEscarpmentRuntime.landmarkLabel.material.opacity = 0.46 + Math.sin(time * 0.82) * 0.07 + marsEscarpmentProximity * 0.32;
}

/* ---------- Medusae Fossae yardang field ---------- */

let marsYardangDiscovered = false;
let marsYardangProximity = 0;

function buildMarsYardangField() {
  const group = new THREE.Group();
  group.name = 'Mars · Medusae Fossae wind-carved yardang field';
  scene.add(group);

  const ridgeCount = 5;
  const segmentCount = isTouchDevice ? 5 : 7;
  const outcropCount = ridgeCount * segmentCount;
  const outcropGeometry = createProceduralRockGeometry({
    THREE,
    seed: 0x7a2da9,
    detail: isTouchDevice ? 1 : 2,
    archetype: 'ventifact',
  });
  const outcropMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0x7a2da9,
    roughness: 0.94,
    bumpScale: 0.055,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xbe7249,
    dustStrength: 0.25,
  });
  const outcrops = new THREE.InstancedMesh(outcropGeometry, outcropMaterial, outcropCount);
  outcrops.name = 'Streamlined indurated yardang crests';
  const dummy = new THREE.Object3D();
  const localWind = new THREE.Vector3();
  const localAcross = new THREE.Vector3();
  const instanceColor = new THREE.Color();
  let instance = 0;
  for (let ridgeIndex = 0; ridgeIndex < ridgeCount; ridgeIndex++) {
    const acrossDistance = (ridgeIndex - (ridgeCount - 1) * 0.5) * MARS_YARDANG_SPACING;
    for (let segment = 0; segment < segmentCount; segment++) {
      const alongDistance = THREE.MathUtils.lerp(-25, 25, segment / Math.max(1, segmentCount - 1))
        + Math.sin(ridgeIndex * 2.17 + segment * 1.31) * 0.48;
      const alongNormal = stepWorldNormal(MARS_YARDANG_CENTER_NORMAL, MARS_YARDANG_WIND, alongDistance, PLANET_RADIUS);
      localAcross.copy(MARS_YARDANG_ACROSS).addScaledVector(alongNormal, -MARS_YARDANG_ACROSS.dot(alongNormal)).normalize();
      const meander = Math.sin(segment * 1.91 + ridgeIndex * 2.3) * 0.42;
      const normal = stepWorldNormal(alongNormal, localAcross, acrossDistance + meander, PLANET_RADIUS);
      localWind.copy(MARS_YARDANG_WIND).addScaledVector(normal, -MARS_YARDANG_WIND.dot(normal)).normalize();
      localWind.applyAxisAngle(normal, Math.sin(segment * 2.13 + ridgeIndex) * 0.045);
      const fieldFade = 1 - Math.pow(Math.abs(alongDistance) / 31, 1.8);
      const height = 0.2 + Math.max(0, fieldFade) * (0.18 + ((ridgeIndex + segment) % 3) * 0.07);
      dummy.position.copy(surfaceWorldPosition(normal, height * 0.2 + 0.025));
      dummy.quaternion.copy(surfaceVehicleQuaternion(normal, localWind));
      dummy.scale.set(
        0.72 + ((ridgeIndex + segment) % 2) * 0.22,
        height,
        2.55 + Math.max(0, fieldFade) * 1.25 + (segment % 2) * 0.28
      );
      dummy.updateMatrix();
      outcrops.setMatrixAt(instance, dummy.matrix);
      outcrops.setColorAt(instance, instanceColor.setHSL(0.035 + ridgeIndex * 0.006, 0.38, 0.3 + segment * 0.012));
      instance += 1;
    }
  }
  outcrops.instanceMatrix.needsUpdate = true;
  if (outcrops.instanceColor) outcrops.instanceColor.needsUpdate = true;
  group.add(outcrops);

  const dustCount = isTouchDevice ? 34 : 64;
  const dustMaterial = new THREE.MeshStandardMaterial({
    color: 0x54271f,
    roughness: 1,
    transparent: true,
    opacity: 0.54,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const leeDust = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), dustMaterial, dustCount);
  leeDust.name = 'Fine dust trapped in yardang lee wakes';
  let seed = 0x7a2da9;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < dustCount; index++) {
    const ridgeIndex = index % ridgeCount;
    const alongDistance = -23 + random() * 50;
    const acrossDistance = (ridgeIndex - (ridgeCount - 1) * 0.5) * MARS_YARDANG_SPACING
      + MARS_YARDANG_SPACING * (0.24 + random() * 0.22);
    const alongNormal = stepWorldNormal(MARS_YARDANG_CENTER_NORMAL, MARS_YARDANG_WIND, alongDistance, PLANET_RADIUS);
    localAcross.copy(MARS_YARDANG_ACROSS).addScaledVector(alongNormal, -MARS_YARDANG_ACROSS.dot(alongNormal)).normalize();
    const normal = stepWorldNormal(alongNormal, localAcross, acrossDistance, PLANET_RADIUS);
    localWind.copy(MARS_YARDANG_WIND).addScaledVector(normal, -MARS_YARDANG_WIND.dot(normal)).normalize();
    dummy.position.copy(surfaceWorldPosition(normal, 0.035));
    dummy.quaternion.copy(surfaceVehicleQuaternion(normal, localWind));
    dummy.scale.set(0.18 + random() * 0.34, 1, 0.85 + Math.pow(random(), 0.72) * 2.45);
    dummy.updateMatrix();
    leeDust.setMatrixAt(index, dummy.matrix);
    leeDust.setColorAt(index, instanceColor.setHSL(0.025, 0.5 + random() * 0.12, 0.17 + random() * 0.08));
  }
  leeDust.instanceMatrix.needsUpdate = true;
  if (leeDust.instanceColor) leeDust.instanceColor.needsUpdate = true;
  group.add(leeDust);

  const landmarkLabel = makeLabelSprite('MEDUSAE YARDANGS · WIND SCULPTED', '#df8b59');
  landmarkLabel.position.copy(surfaceWorldPosition(MARS_YARDANG_CENTER_NORMAL, 7.2));
  landmarkLabel.scale.set(6.1, 1.05, 1);
  scene.add(landmarkLabel);

  return { group, outcrops, outcropMaterial, leeDust, dustMaterial, landmarkLabel };
}

const marsYardangRuntime = buildMarsYardangField();

function updateMarsYardangField(dt, time, activeMarsNormal) {
  let targetProximity = 0;
  if (activeMarsNormal) {
    const distance = geodesicDistance(activeMarsNormal, MARS_YARDANG_CENTER_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 11, 32);
    if (!marsYardangDiscovered && distance < 15.5) {
      marsYardangDiscovered = true;
      showBanner('MEDUSAE YARDANGS DISCOVERED · PREVAILING WIND RECORDED');
    }
  }
  marsYardangProximity = THREE.MathUtils.damp(marsYardangProximity, targetProximity, 5, dt);
  marsYardangRuntime.dustMaterial.opacity = 0.42 + Math.sin(time * 0.7) * 0.04 + marsYardangProximity * 0.1;
  marsYardangRuntime.landmarkLabel.material.opacity = 0.45 + Math.sin(time * 0.78) * 0.07 + marsYardangProximity * 0.34;
}

/* ---------- Daedalia complex impact basin ---------- */

let marsImpactBasinDiscovered = false;
let marsImpactBasinProximity = 0;

function buildMarsImpactBasin() {
  const group = new THREE.Group();
  group.name = 'Mars · Daedalia complex impact basin';
  scene.add(group);

  let seed = 0xdaeda11a;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  const radialDirection = new THREE.Vector3();
  const ringHeading = new THREE.Vector3();

  const brecciaMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0xdaeda11a,
    roughness: 0.98,
    bumpScale: 0.07,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xd09367,
    dustStrength: 0.2,
  });
  const rimCount = isTouchDevice ? 42 : 76;
  const rimBlocks = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xdaeda11a,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'breccia',
    }),
    brecciaMaterial,
    rimCount
  );
  rimBlocks.name = 'Shock-fractured rim breccia';
  for (let index = 0; index < rimCount; index++) {
    const angle = index * (Math.PI * 2 / rimCount) + (random() - 0.5) * 0.1;
    radialDirection.copy(MARS_IMPACT_BASIN_TANGENT).applyAxisAngle(MARS_IMPACT_BASIN_NORMAL, angle);
    const distance = MARS_IMPACT_BASIN_RADIUS * (0.94 + random() * 0.16);
    const normal = stepWorldNormal(MARS_IMPACT_BASIN_NORMAL, radialDirection, distance, PLANET_RADIUS);
    const scale = 0.32 + Math.pow(random(), 1.5) * 1.05;
    dummy.position.copy(surfaceWorldPosition(normal, scale * 0.22));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.24);
    dummy.scale.set(scale * (0.72 + random() * 0.65), scale * (0.5 + random() * 0.52), scale);
    dummy.updateMatrix();
    rimBlocks.setMatrixAt(index, dummy.matrix);
    rimBlocks.setColorAt(index, instanceColor.setHSL(0.025 + random() * 0.025, 0.34 + random() * 0.14, 0.3 + random() * 0.14));
  }
  rimBlocks.instanceMatrix.needsUpdate = true;
  if (rimBlocks.instanceColor) rimBlocks.instanceColor.needsUpdate = true;
  group.add(rimBlocks);

  const ledgeMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0xdaeda1ed,
    roughness: 0.99,
    bumpScale: 0.05,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xd09367,
    dustStrength: 0.24,
  });
  const ledgeCount = isTouchDevice ? 36 : 60;
  const terraceLedges = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xdaeda1ed,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'sedimentary',
      ruggedness: 0.82,
    }),
    ledgeMaterial,
    ledgeCount
  );
  terraceLedges.name = 'Slumped concentric crater-wall terraces';
  const terraceBands = [0.56, 0.71, 0.84];
  for (let index = 0; index < ledgeCount; index++) {
    const band = terraceBands[index % terraceBands.length];
    const angle = index * 2.39996 + random() * 0.16;
    radialDirection.copy(MARS_IMPACT_BASIN_TANGENT).applyAxisAngle(MARS_IMPACT_BASIN_NORMAL, angle);
    const distance = MARS_IMPACT_BASIN_RADIUS * (band + (random() - 0.5) * 0.035);
    const normal = stepWorldNormal(MARS_IMPACT_BASIN_NORMAL, radialDirection, distance, PLANET_RADIUS);
    ringHeading.copy(radialDirection).cross(normal).normalize();
    dummy.position.copy(surfaceWorldPosition(normal, 0.08));
    dummy.quaternion.copy(surfaceVehicleQuaternion(normal, ringHeading));
    dummy.scale.set(0.5 + random() * 0.42, 0.1 + random() * 0.12, 1.15 + random() * 1.25);
    dummy.updateMatrix();
    terraceLedges.setMatrixAt(index, dummy.matrix);
    terraceLedges.setColorAt(index, instanceColor.setHSL(0.03, 0.38 + random() * 0.1, 0.31 + band * 0.1 + random() * 0.055));
  }
  terraceLedges.instanceMatrix.needsUpdate = true;
  if (terraceLedges.instanceColor) terraceLedges.instanceColor.needsUpdate = true;
  group.add(terraceLedges);

  const ejectaMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0xdaedaec7,
    roughness: 0.97,
    bumpScale: 0.06,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xc77b54,
    dustStrength: 0.22,
  });
  const ejectaCount = isTouchDevice ? 52 : 92;
  const ejectaBlocks = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xdaedaec7,
      detail: 1,
      archetype: 'breccia',
    }),
    ejectaMaterial,
    ejectaCount
  );
  ejectaBlocks.name = 'Ballistic ejecta ray fragments';
  for (let index = 0; index < ejectaCount; index++) {
    const rayIndex = index % 7;
    const angle = (rayIndex * Math.PI * 2 - 0.36) / 7 + (random() - 0.5) * (0.06 + random() * 0.12);
    radialDirection.copy(MARS_IMPACT_BASIN_TANGENT).applyAxisAngle(MARS_IMPACT_BASIN_NORMAL, angle);
    const radialFactor = 1.08 + Math.pow(random(), 0.72) * 1.88;
    const distance = MARS_IMPACT_BASIN_RADIUS * radialFactor;
    const normal = stepWorldNormal(MARS_IMPACT_BASIN_NORMAL, radialDirection, distance, PLANET_RADIUS);
    const scale = (0.16 + Math.pow(random(), 2.15) * 0.92) / Math.pow(radialFactor, 0.52);
    dummy.position.copy(surfaceWorldPosition(normal, scale * 0.2));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.scale.set(scale * (0.65 + random() * 0.8), scale * (0.38 + random() * 0.48), scale);
    dummy.updateMatrix();
    ejectaBlocks.setMatrixAt(index, dummy.matrix);
    ejectaBlocks.setColorAt(index, instanceColor.setHSL(0.027 + random() * 0.018, 0.38 + random() * 0.14, 0.3 + random() * 0.13));
  }
  ejectaBlocks.instanceMatrix.needsUpdate = true;
  if (ejectaBlocks.instanceColor) ejectaBlocks.instanceColor.needsUpdate = true;
  group.add(ejectaBlocks);

  const meltMaterial = new THREE.MeshStandardMaterial({
    color: 0x20171a,
    emissive: 0x180706,
    emissiveIntensity: 0.18,
    metalness: 0.18,
    roughness: 0.58,
    transparent: true,
    opacity: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const meltCount = isTouchDevice ? 6 : 10;
  const meltPatches = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
    meltMaterial,
    meltCount
  );
  meltPatches.name = 'Dark impact-melt remnants';
  for (let index = 0; index < meltCount; index++) {
    const angle = random() * Math.PI * 2;
    radialDirection.copy(MARS_IMPACT_BASIN_TANGENT).applyAxisAngle(MARS_IMPACT_BASIN_NORMAL, angle);
    const distance = 2.7 + random() * 4.4;
    const normal = stepWorldNormal(MARS_IMPACT_BASIN_NORMAL, radialDirection, distance, PLANET_RADIUS);
    dummy.position.copy(surfaceWorldPosition(normal, 0.045));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI);
    dummy.scale.set(0.75 + random() * 1.5, 1, 0.34 + random() * 0.8);
    dummy.updateMatrix();
    meltPatches.setMatrixAt(index, dummy.matrix);
  }
  meltPatches.instanceMatrix.needsUpdate = true;
  group.add(meltPatches);

  const peakMaterial = new THREE.MeshStandardMaterial({ color: 0x512d29, roughness: 0.92, flatShading: true });
  const peakCount = isTouchDevice ? 7 : 12;
  const peakOutcrops = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), peakMaterial, peakCount);
  peakOutcrops.name = 'Uplifted central rebound peak bedrock';
  for (let index = 0; index < peakCount; index++) {
    const angle = index * 2.39996;
    radialDirection.copy(MARS_IMPACT_BASIN_TANGENT).applyAxisAngle(MARS_IMPACT_BASIN_NORMAL, angle);
    const distance = index === 0 ? 0 : 0.55 + random() * 2.15;
    const normal = stepWorldNormal(MARS_IMPACT_BASIN_NORMAL, radialDirection, distance, PLANET_RADIUS);
    const height = index === 0 ? 2.1 : 0.65 + random() * 1.4;
    dummy.position.copy(surfaceWorldPosition(normal, height * 0.44));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.18);
    dummy.scale.set(0.24 + height * 0.18, height, 0.24 + height * 0.18);
    dummy.updateMatrix();
    peakOutcrops.setMatrixAt(index, dummy.matrix);
    peakOutcrops.setColorAt(index, instanceColor.setHSL(0.018 + random() * 0.025, 0.28 + random() * 0.16, 0.16 + random() * 0.13));
  }
  peakOutcrops.instanceMatrix.needsUpdate = true;
  if (peakOutcrops.instanceColor) peakOutcrops.instanceColor.needsUpdate = true;
  group.add(peakOutcrops);

  const landmarkLabel = makeLabelSprite('DAEDALIA BASIN · COMPLEX IMPACT CRATER', '#e8a071');
  landmarkLabel.position.copy(surfaceWorldPosition(MARS_IMPACT_BASIN_NORMAL, 9.6));
  landmarkLabel.scale.set(6.6, 1.08, 1);
  scene.add(landmarkLabel);

  return { group, rimBlocks, terraceLedges, ejectaBlocks, meltPatches, meltMaterial, peakOutcrops, landmarkLabel };
}

const marsImpactBasinRuntime = buildMarsImpactBasin();

function updateMarsImpactBasin(dt, time, activeMarsNormal) {
  let targetProximity = 0;
  if (activeMarsNormal) {
    const distance = geodesicDistance(activeMarsNormal, MARS_IMPACT_BASIN_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 12, 38);
    if (!marsImpactBasinDiscovered && distance < 22) {
      marsImpactBasinDiscovered = true;
      showBanner('DAEDALIA BASIN DISCOVERED · COMPLEX IMPACT STRUCTURE');
    }
  }
  marsImpactBasinProximity = THREE.MathUtils.damp(marsImpactBasinProximity, targetProximity, 5, dt);
  marsImpactBasinRuntime.meltMaterial.emissiveIntensity = 0.12 + Math.sin(time * 0.38) * 0.025;
  marsImpactBasinRuntime.landmarkLabel.material.opacity = 0.46 + Math.sin(time * 0.74) * 0.07 + marsImpactBasinProximity * 0.34;
}

/* ---------- dirt pathways & spawn signs ---------- */

const marsTrailMeshes = [];

function buildTrailRibbon(hub, halfWidth, lateralOffset, lift, color, opacity = 1, startNormal = START_NORMAL) {
  const distance = geodesicDistance(startNormal, hub.normal);
  const steps = Math.max(24, Math.ceil(distance / 0.72));
  const vertices = [];
  const colors = [];
  const indices = [];
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const trailColor = new THREE.Color(color);
  const variedColor = new THREE.Color();
  for (let index = 0; index <= steps; index++) {
    const routeRatio = index / steps;
    const normal = slerpNormals(startNormal, hub.normal, routeRatio);
    forward.copy(hub.normal).addScaledVector(normal, -hub.normal.dot(normal)).normalize();
    right.crossVectors(forward, normal).normalize();
    const edgeNoise = Math.sin(index * 1.73 + hub.x * 0.013) * 0.12 + Math.sin(index * 0.47 + hub.z * 0.021) * 0.08;
    [-1, 1].forEach((side) => {
      const sideDistance = lateralOffset + side * halfWidth * (1 + edgeNoise * side);
      const sideNormal = stepWorldNormal(normal, right, sideDistance, PLANET_RADIUS);
      const position = surfaceWorldPosition(sideNormal, lift);
      vertices.push(position.x, position.y, position.z);
      variedColor.copy(trailColor).multiplyScalar(0.86 + ((index * 17 + (side > 0 ? 5 : 1)) % 9) * 0.018);
      colors.push(variedColor.r, variedColor.g, variedColor.b);
    });
    if (index < steps) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  scene.add(mesh);
  marsTrailMeshes.push(mesh);
  return mesh;
}

function buildDirtPath(hub, startNormal = START_NORMAL) {
  buildTrailRibbon(hub, 1.55, 0, 0.11, 0x7f3824, 0.96, startNormal);
  buildTrailRibbon(hub, 0.15, -0.72, 0.145, 0x3f211c, 0.78, startNormal);
  buildTrailRibbon(hub, 0.15, 0.72, 0.145, 0x3f211c, 0.78, startNormal);
}
SURFACE_WAYPOINT_HUBS.forEach((hub) => buildDirtPath(hub));
// The mountain home branches from the projects trail instead of cutting
// through the motor cavern on a direct line from the shared trailhead.
buildDirtPath(ALIEN_MOUNTAIN_HOME, ALIEN_HOME_BRANCH_NORMAL);

function buildTrailheadPlaza() {
  const group = new THREE.Group();
  group.name = 'Shared Mars trailhead · player spawn';
  placeSurfaceGroup(group, START_NORMAL, 0.105);
  const packedDirt = new THREE.Mesh(
    new THREE.CircleGeometry(7.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x78341f, roughness: 1, metalness: 0 })
  );
  packedDirt.rotation.x = -Math.PI / 2;
  group.add(packedDirt);
  const centerMark = new THREE.Mesh(
    new THREE.RingGeometry(1.45, 1.72, 28),
    new THREE.MeshBasicMaterial({ color: 0xe18b58, transparent: true, opacity: 0.54, side: THREE.DoubleSide })
  );
  centerMark.rotation.x = -Math.PI / 2;
  centerMark.position.y = 0.018;
  group.add(centerMark);
  const shuttleNotice = makeLabelSprite('SHUTTLE ARRIVES IN 10 SECONDS', '#ffe0a8');
  shuttleNotice.name = 'Central trailhead shuttle arrival notice';
  shuttleNotice.position.set(0, 4.35, 0);
  shuttleNotice.scale.set(8.6, 1.22, 1);
  group.add(shuttleNotice);
  return group;
}

const trailheadPlaza = buildTrailheadPlaza();

function makeLabelSprite(text, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.font = '800 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 9;
  ctx.fillStyle = colorHex;
  ctx.fillText(text, 180, 40, 340);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(4.8, 1.05, 1);
  return sprite;
}

const drivingCourses = buildDrivingCourses({
  planetRadius: PLANET_RADIUS,
  normalFromCoords: normalFromSurfaceCoords,
  surfacePosition: surfaceWorldPosition,
  makeLabelSprite,
  isTouchDevice,
});
scene.add(drivingCourses.root);
const xenobiologyTrailHub = HUBS.find((hub) => hub.key === 'planetarium');
const oasisBranchNormal = slerpNormals(START_NORMAL, xenobiologyTrailHub.normal, 0.72);
const oasisApproachDirection = oasisBranchNormal.clone()
  .addScaledVector(MARS_OASIS_NORMAL, -oasisBranchNormal.dot(MARS_OASIS_NORMAL))
  .normalize();
const oasisTrailNormal = stepWorldNormal(MARS_OASIS_NORMAL, oasisApproachDirection, 33.5, PLANET_RADIUS);
const oasisPathTarget = {
  x: 170,
  z: 145,
  normal: oasisTrailNormal,
};
// The direct branch-to-oasis great circle cuts through the Xenobiology
// Globe's 27 m foundation. Wrap the trail around the outside of the globe
// as a gradual arc, maintaining at least 40 m of center clearance so the full
// dirt ribbon stays visibly separate from the building.
const globeToOasisDirection = MARS_OASIS_NORMAL.clone()
  .addScaledVector(xenobiologyTrailHub.normal, -MARS_OASIS_NORMAL.dot(xenobiologyTrailHub.normal))
  .normalize();
const globeOasisRight = globeToOasisDirection.clone().cross(xenobiologyTrailHub.normal).normalize();
const oasisBypassTargets = [-2.25, -1.7, -1.15, -0.6].map((angle, index) => {
  const bypassDirection = globeToOasisDirection.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(globeOasisRight, Math.sin(angle))
    .normalize();
  return {
    x: 116 + index * 14,
    z: 122 + index * 9,
    normal: stepWorldNormal(xenobiologyTrailHub.normal, bypassDirection, 46, PLANET_RADIUS),
  };
});
let oasisSegmentStart = oasisBranchNormal;
[...oasisBypassTargets, oasisPathTarget].forEach((target) => {
  buildDirtPath(target, oasisSegmentStart);
  oasisSegmentStart = target.normal;
});

const oasisForward = oasisApproachDirection.clone();
const oasisRight = oasisForward.clone().cross(MARS_OASIS_NORMAL).normalize();
const oasisMapDirection = new THREE.Vector3();
const oasisInverseDirection = new THREE.Vector3();
const OASIS_SWIM_ENTER_RATIO = 0.92;
const OASIS_SWIM_EXIT_RATIO = 1.01;
const OASIS_BOAT_LIMIT_RATIO = 0.86;
const OASIS_BOAT_BOARD_RADIUS = 6.4;
function oasisNormalAt(x, z, target = new THREE.Vector3()) {
  const distance = Math.hypot(x, z);
  if (distance < 0.0001) return target.copy(MARS_OASIS_NORMAL);
  oasisMapDirection.copy(oasisRight).multiplyScalar(x)
    .addScaledVector(oasisForward, z)
    .normalize();
  const angle = distance / PLANET_RADIUS;
  return target.copy(MARS_OASIS_NORMAL).multiplyScalar(Math.cos(angle))
    .addScaledVector(oasisMapDirection, Math.sin(angle))
    .normalize();
}

function oasisWaterRatio(normal) {
  const centerDot = THREE.MathUtils.clamp(normal.dot(MARS_OASIS_NORMAL), -1, 1);
  const angle = Math.acos(centerDot);
  if (angle < 0.00001) return 0;
  oasisInverseDirection.copy(normal)
    .addScaledVector(MARS_OASIS_NORMAL, -centerDot)
    .normalize();
  const distance = angle * PLANET_RADIUS;
  const x = oasisInverseDirection.dot(oasisRight) * distance;
  const z = oasisInverseDirection.dot(oasisForward) * distance;
  return Math.hypot(x / MARS_OASIS_RADIUS_X, z / MARS_OASIS_RADIUS_Z);
}

function buildOasisSkiff() {
  const root = new THREE.Group();
  root.name = 'Nebula Oasis driveable skiff';
  const visual = new THREE.Group();
  root.add(visual);

  const hullMaterial = stdMat(0x4a245f, {
    roughness: 0.42,
    metalness: 0.18,
    emissive: 0x1e0b34,
    emissiveIntensity: 0.46,
    side: THREE.DoubleSide,
  });
  const trimMaterial = stdMat(0x76f5e5, {
    roughness: 0.28,
    metalness: 0.68,
    emissive: 0x1d8278,
    emissiveIntensity: 0.92,
  });
  const deckMaterial = stdMat(0xd18a59, { roughness: 0.82, metalness: 0.02 });
  const darkMaterial = stdMat(0x17232d, { roughness: 0.48, metalness: 0.72 });

  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    hullMaterial
  );
  hull.name = 'Skiff curved displacement hull';
  hull.position.y = 0.58;
  hull.scale.set(1.48, 0.86, 3.35);
  visual.add(hull);

  const innerDeck = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.16, 4.65), deckMaterial);
  innerDeck.position.y = 0.58;
  visual.add(innerDeck);
  [-1, 1].forEach((side) => {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 5.4, 10), trimMaterial);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(side * 1.28, 0.8, 0.15);
    visual.add(rail);
  });
  [-0.72, 0.72].forEach((z) => {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.48), deckMaterial);
    bench.position.set(0, 0.94, z);
    visual.add(bench);
  });

  const bowGlow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.08, 12), trimMaterial);
  bowGlow.rotation.x = -Math.PI / 2;
  bowGlow.position.set(0, 0.68, -3.32);
  visual.add(bowGlow);

  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.82, 0.62), darkMaterial);
  motor.position.set(0, 1.03, 2.48);
  visual.add(motor);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 8), trimMaterial);
  tiller.rotation.x = Math.PI / 2;
  tiller.rotation.z = -0.18;
  tiller.position.set(0.28, 1.34, 1.86);
  visual.add(tiller);
  const propeller = new THREE.Group();
  propeller.position.set(0, 0.18, 2.86);
  [0, Math.PI / 2].forEach((rotation) => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.08), trimMaterial);
    blade.rotation.z = rotation;
    propeller.add(blade);
  });
  visual.add(propeller);

  const navLight = new THREE.PointLight(0x75fff1, 1.8, 9, 2);
  navLight.position.set(0, 1.05, -2.7);
  navLight.castShadow = false;
  visual.add(navLight);

  const seat = new THREE.Group();
  seat.position.set(0, 0.96, 0.72);
  visual.add(seat);

  const wakeMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8fff4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const wakes = [-1, 1].map((side) => {
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 4.8), wakeMaterial.clone());
    wake.rotation.x = -Math.PI / 2;
    wake.rotation.z = side * 0.17;
    wake.position.set(side * 0.62, 0.13, 3.65);
    visual.add(wake);
    return wake;
  });

  const label = makeLabelSprite('OASIS SKIFF · PRESS E', '#9effef');
  label.position.set(0, 4.15, 0);
  label.scale.set(5.8, 0.82, 1);
  root.add(label);

  const normal = oasisNormalAt(0, MARS_OASIS_RADIUS_Z * 0.82);
  const heading = MARS_OASIS_NORMAL.clone()
    .addScaledVector(normal, -MARS_OASIS_NORMAL.dot(normal))
    .normalize();
  root.position.copy(surfaceWorldPosition(normal, 0.48));
  root.quaternion.copy(surfaceVehicleQuaternion(normal, heading));
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = true;
  });

  return { root, visual, seat, propeller, wakes, label, navLight, normal, heading };
}

function buildOasisParrot() {
  const root = new THREE.Group();
  root.name = 'Free-flying Nebula Oasis space parrot';
  root.scale.setScalar(0.62);
  const visual = new THREE.Group();
  root.add(visual);

  const emerald = stdMat(0x29b66f, { emissive: 0x0c4f35, emissiveIntensity: 0.48, roughness: 0.62, flatShading: true });
  const lime = stdMat(0x9ee85d, { emissive: 0x2f6f22, emissiveIntensity: 0.5, roughness: 0.58, flatShading: true });
  const scarlet = stdMat(0xe44b4f, { emissive: 0x6f171f, emissiveIntensity: 0.46, roughness: 0.56, flatShading: true });
  const cobalt = stdMat(0x3676df, { emissive: 0x173f8a, emissiveIntensity: 0.58, roughness: 0.5, flatShading: true });
  const gold = stdMat(0xffc44d, { emissive: 0x8a4b12, emissiveIntensity: 0.45, roughness: 0.54, flatShading: true });
  const ivory = stdMat(0xf5ead1, { roughness: 0.72, flatShading: true });
  const dark = stdMat(0x09121a, { roughness: 0.48, flatShading: true });

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 1), emerald);
  body.name = 'Parrot emerald body';
  body.scale.set(0.86, 1.03, 1.42);
  visual.add(body);

  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(0.61, 1), scarlet);
  chest.name = 'Parrot scarlet chest';
  chest.scale.set(0.72, 0.9, 0.46);
  chest.position.set(0, -0.16, -0.72);
  visual.add(chest);

  const head = new THREE.Group();
  head.name = 'Parrot animated head';
  head.position.set(0, 0.52, -1.18);
  visual.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.63, 1), lime);
  skull.scale.set(0.94, 1.02, 0.98);
  head.add(skull);
  const face = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), gold);
  face.scale.set(0.7, 0.78, 0.3);
  face.position.set(0, -0.08, -0.52);
  head.add(face);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.68, 7), ivory);
  beak.name = 'Parrot hooked ivory beak';
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, -0.12, -0.94);
  beak.scale.set(1, 1, 0.72);
  head.add(beak);
  [-1, 1].forEach((side) => {
    const eyePatch = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 7), ivory);
    eyePatch.scale.set(0.34, 0.78, 0.42);
    eyePatch.position.set(side * 0.52, 0.18, -0.42);
    head.add(eyePatch);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), dark);
    eye.position.set(side * 0.57, 0.2, -0.48);
    head.add(eye);
  });

  const wingPivots = [];
  [-1, 1].forEach((side) => {
    const wingPivot = new THREE.Group();
    wingPivot.name = side < 0 ? 'Parrot left flapping wing' : 'Parrot right flapping wing';
    wingPivot.position.set(side * 0.43, 0.16, -0.03);
    visual.add(wingPivot);
    const primary = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cobalt);
    primary.position.set(side * 1.05, 0, 0.08);
    primary.scale.set(1.52, 0.13, 0.76);
    wingPivot.add(primary);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.72, 11, 7), emerald);
    shoulder.position.set(side * 0.48, 0.03, -0.18);
    shoulder.scale.set(1.18, 0.2, 0.82);
    wingPivot.add(shoulder);
    const wingTip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.55, 6), scarlet);
    wingTip.rotation.z = side * -Math.PI / 2;
    wingTip.position.set(side * 2.1, -0.02, 0.34);
    wingTip.scale.set(0.7, 1, 0.42);
    wingPivot.add(wingTip);
    wingPivots.push({ root: wingPivot, side });
  });

  const tailFeathers = [];
  [
    { x: -0.3, color: scarlet, length: 2.45, yaw: -0.12 },
    { x: 0, color: cobalt, length: 2.9, yaw: 0 },
    { x: 0.3, color: scarlet, length: 2.45, yaw: 0.12 },
  ].forEach((feather, index) => {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.25, feather.length, 6), feather.color);
    tail.name = `Parrot tail feather ${index + 1}`;
    tail.rotation.x = Math.PI / 2;
    tail.rotation.y = feather.yaw;
    tail.position.set(feather.x, -0.18, 1.55 + feather.length * 0.34);
    tail.scale.set(0.72, 1, 0.42);
    visual.add(tail);
    tailFeathers.push(tail);
  });

  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
  });

  return {
    root,
    visual,
    head,
    wingPivots,
    tailFeathers,
    angle: 4.5,
    speed: 0.17,
    radiusX: MARS_OASIS_RADIUS_X * 0.52,
    radiusZ: MARS_OASIS_RADIUS_Z * 0.52,
    altitude: 6.4,
    normal: new THREE.Vector3(),
    nextNormal: new THREE.Vector3(),
    heading: new THREE.Vector3(),
  };
}

function buildOasisLake() {
  const root = new THREE.Group();
  root.name = 'Nebula Oasis · living alien lake';
  const waterSegments = isTouchDevice ? 56 : 80;
  const waterRings = isTouchDevice ? 4 : 6;
  const waterPositions = [];
  const waterIndices = [];
  const waterNormal = new THREE.Vector3();
  waterPositions.push(...surfaceWorldPosition(MARS_OASIS_NORMAL, 0.16).toArray());
  for (let ring = 1; ring <= waterRings; ring++) {
    const ringRatio = ring / waterRings;
    for (let segment = 0; segment < waterSegments; segment++) {
      const angle = (segment / waterSegments) * Math.PI * 2;
      const edgeWobble = 1 + Math.sin(angle * 5 + 0.4) * 0.018 + Math.sin(angle * 9 - 0.8) * 0.012;
      const x = Math.cos(angle) * MARS_OASIS_RADIUS_X * ringRatio * edgeWobble;
      const z = Math.sin(angle) * MARS_OASIS_RADIUS_Z * ringRatio * edgeWobble;
      oasisNormalAt(x, z, waterNormal);
      waterPositions.push(...surfaceWorldPosition(waterNormal, 0.16 + Math.sin(angle * 3) * 0.012).toArray());
    }
  }
  for (let segment = 0; segment < waterSegments; segment++) {
    waterIndices.push(0, 1 + segment, 1 + ((segment + 1) % waterSegments));
  }
  for (let ring = 2; ring <= waterRings; ring++) {
    const innerStart = 1 + (ring - 2) * waterSegments;
    const outerStart = 1 + (ring - 1) * waterSegments;
    for (let segment = 0; segment < waterSegments; segment++) {
      const next = (segment + 1) % waterSegments;
      waterIndices.push(
        innerStart + segment,
        outerStart + segment,
        innerStart + next,
        outerStart + segment,
        outerStart + next,
        innerStart + next
      );
    }
  }
  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
  waterGeometry.setIndex(waterIndices);
  waterGeometry.computeVertexNormals();
  waterGeometry.computeBoundingSphere();
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x159b9d,
    emissive: 0x063f48,
    emissiveIntensity: 0.42,
    transparent: true,
    opacity: 0.78,
    transmission: 0.12,
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.62,
    clearcoatRoughness: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.name = 'Nebula Oasis spherical water surface';
  water.renderOrder = 2;
  root.add(water);

  const shorelinePoints = [];
  const innerShorelinePoints = [];
  for (let segment = 0; segment < waterSegments; segment++) {
    const angle = (segment / waterSegments) * Math.PI * 2;
    const wobble = 1 + Math.sin(angle * 5 + 0.4) * 0.018 + Math.sin(angle * 9 - 0.8) * 0.012;
    oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * wobble,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * wobble,
      waterNormal
    );
    shorelinePoints.push(surfaceWorldPosition(waterNormal, 0.26));
    oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * 0.965 * wobble,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * 0.965 * wobble,
      waterNormal
    );
    innerShorelinePoints.push(surfaceWorldPosition(waterNormal, 0.24));
  }
  const shorelineCurve = new THREE.CatmullRomCurve3(shorelinePoints, true, 'centripetal', 0.5);
  const shoreline = new THREE.Mesh(
    new THREE.TubeGeometry(shorelineCurve, waterSegments, 0.42, 7, true),
    stdMat(0xd39d71, { roughness: 0.86, emissive: 0x4d2217, emissiveIntensity: 0.28 })
  );
  shoreline.name = 'Nebula Oasis crystalline shoreline';
  root.add(shoreline);
  const foamCurve = new THREE.CatmullRomCurve3(innerShorelinePoints, true, 'centripetal', 0.5);
  const foam = new THREE.Mesh(
    new THREE.TubeGeometry(foamCurve, waterSegments, 0.11, 6, true),
    new THREE.MeshBasicMaterial({ color: 0x9cfff1, transparent: true, opacity: 0.72, toneMapped: false })
  );
  root.add(foam);

  const sparkleCount = isTouchDevice ? 55 : 95;
  const sparklePositions = new Float32Array(sparkleCount * 3);
  for (let index = 0; index < sparkleCount; index++) {
    const angle = index * 2.399963;
    const radius = Math.sqrt(((index * 47) % 101) / 100) * 0.88;
    const x = Math.cos(angle) * MARS_OASIS_RADIUS_X * radius;
    const z = Math.sin(angle) * MARS_OASIS_RADIUS_Z * radius;
    oasisNormalAt(x, z, waterNormal);
    const position = surfaceWorldPosition(waterNormal, 0.24 + (index % 5) * 0.012);
    sparklePositions[index * 3] = position.x;
    sparklePositions[index * 3 + 1] = position.y;
    sparklePositions[index * 3 + 2] = position.z;
  }
  const sparkleGeometry = new THREE.BufferGeometry();
  sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  const sparkleMaterial = new THREE.PointsMaterial({
    color: 0xb8fff5,
    size: isTouchDevice ? 0.24 : 0.18,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
  root.add(sparkles);

  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.25, 1.45, 7);
  const trunkMaterial = stdMat(0x714a2d, { roughness: 0.9, emissive: 0x241309, emissiveIntensity: 0.18 });
  const frondGeometry = new THREE.SphereGeometry(0.72, 10, 7);
  const frondMaterials = [
    stdMat(0x2f9a58, { emissive: 0x0c3d23, emissiveIntensity: 0.34, roughness: 0.66 }),
    stdMat(0x67bd59, { emissive: 0x214f1b, emissiveIntensity: 0.3, roughness: 0.62 }),
  ];
  const palmCount = isTouchDevice ? 12 : 20;
  for (let palmIndex = 0; palmIndex < palmCount; palmIndex++) {
    const angle = (palmIndex / palmCount) * Math.PI * 2 + Math.sin(palmIndex * 4.7) * 0.08;
    const radial = 1.12 + (palmIndex % 3) * 0.045;
    const normal = oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * radial,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * radial
    );
    const palm = new THREE.Group();
    palm.name = `Space palm ${palmIndex + 1}`;
    placeSurfaceGroup(palm, normal, 0.12);
    palm.rotation.y = angle + palmIndex * 0.37;
    const bend = Math.sin(palmIndex * 2.1) * 0.48;
    for (let segment = 0; segment < 5; segment++) {
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      const progress = segment / 4;
      trunk.position.set(bend * progress * progress, 0.72 + segment * 1.25, Math.cos(palmIndex) * progress * 0.16);
      trunk.rotation.z = -bend * 0.07;
      trunk.scale.setScalar(1 - progress * 0.11);
      palm.add(trunk);
    }
    const crownX = bend;
    const crownY = 6.45;
    for (let leafIndex = 0; leafIndex < 8; leafIndex++) {
      const leafAngle = (leafIndex / 8) * Math.PI * 2 + palmIndex * 0.21;
      const frond = new THREE.Mesh(frondGeometry, frondMaterials[(leafIndex + palmIndex) % 2]);
      frond.position.set(crownX + Math.cos(leafAngle) * 1.3, crownY + Math.sin(leafIndex * 1.8) * 0.22, Math.sin(leafAngle) * 1.3);
      frond.scale.set(0.5, 0.12, 2.25);
      frond.rotation.y = leafAngle;
      frond.rotation.z = Math.sin(leafAngle) * 0.28;
      palm.add(frond);
    }
    for (let fruitIndex = 0; fruitIndex < 3; fruitIndex++) {
      const fruit = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 9, 7),
        stdMat(fruitIndex % 2 ? 0xff7fcb : 0x77f5ff, { emissive: fruitIndex % 2 ? 0x8f255f : 0x236d8a, emissiveIntensity: 0.9 })
      );
      fruit.position.set(crownX + (fruitIndex - 1) * 0.24, crownY - 0.52, 0.1 + Math.sin(fruitIndex * 2.2) * 0.2);
      palm.add(fruit);
    }
    root.add(palm);
  }

  // A second, instanced palm belt makes the lake read as a sheltered oasis
  // instead of an exposed pool. The dense outer canopy also naturally blocks
  // most views of the water until the trail reaches the grove.
  const grovePalmCount = isTouchDevice ? 24 : 42;
  const groveTrunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.4, 0.62, 7.25, 7),
    trunkMaterial,
    grovePalmCount
  );
  groveTrunks.name = 'Nebula Oasis dense outer palm grove trunks';
  const groveFrondsPerPalm = isTouchDevice ? 6 : 7;
  const groveFronds = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.72, 9, 6),
    stdMat(0xffffff, { emissive: 0x143e20, emissiveIntensity: 0.3, roughness: 0.66 }),
    grovePalmCount * groveFrondsPerPalm
  );
  groveFronds.name = 'Nebula Oasis dense outer palm canopy';
  const groveDummy = new THREE.Object3D();
  const groveAlign = new THREE.Quaternion();
  const groveYaw = new THREE.Quaternion();
  const grovePalmQuaternion = new THREE.Quaternion();
  const groveBase = new THREE.Vector3();
  const groveCrown = new THREE.Vector3();
  const groveLeafOffset = new THREE.Vector3();
  const groveFrondColors = [0x247b43, 0x36a653, 0x5fbd57, 0x7fc75f];
  for (let palmIndex = 0; palmIndex < grovePalmCount; palmIndex++) {
    const angle = (palmIndex / grovePalmCount) * Math.PI * 2 + Math.sin(palmIndex * 3.71) * 0.11;
    const radial = 1.055 + (palmIndex % 6) * 0.034;
    const normal = oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * radial,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * radial
    );
    const heightScale = 0.82 + (palmIndex % 7) * 0.048;
    groveBase.copy(surfaceWorldPosition(normal, 0.08));
    groveAlign.setFromUnitVectors(UP, normal);
    groveYaw.setFromAxisAngle(UP, angle + Math.sin(palmIndex * 1.9) * 0.34);
    grovePalmQuaternion.copy(groveAlign).multiply(groveYaw);
    groveDummy.position.copy(groveBase).addScaledVector(normal, 3.63 * heightScale);
    groveDummy.quaternion.copy(grovePalmQuaternion);
    groveDummy.scale.set(0.78 + (palmIndex % 3) * 0.08, heightScale, 0.78 + ((palmIndex + 1) % 3) * 0.07);
    groveDummy.updateMatrix();
    groveTrunks.setMatrixAt(palmIndex, groveDummy.matrix);

    groveCrown.copy(groveBase).addScaledVector(normal, 7.25 * heightScale);
    for (let leafIndex = 0; leafIndex < groveFrondsPerPalm; leafIndex++) {
      const leafAngle = (leafIndex / groveFrondsPerPalm) * Math.PI * 2 + palmIndex * 0.31;
      groveLeafOffset.set(Math.cos(leafAngle) * 1.55, 0, Math.sin(leafAngle) * 1.55)
        .applyQuaternion(grovePalmQuaternion);
      groveDummy.position.copy(groveCrown).add(groveLeafOffset).addScaledVector(normal, Math.sin(leafIndex * 2.2) * 0.16);
      groveYaw.setFromAxisAngle(UP, leafAngle + palmIndex * 0.31);
      groveDummy.quaternion.copy(groveAlign).multiply(groveYaw);
      groveDummy.scale.set(0.68, 0.15, 3.05 + (leafIndex % 3) * 0.25);
      groveDummy.updateMatrix();
      const frondIndex = palmIndex * groveFrondsPerPalm + leafIndex;
      groveFronds.setMatrixAt(frondIndex, groveDummy.matrix);
      groveFronds.setColorAt(frondIndex, new THREE.Color(groveFrondColors[(palmIndex + leafIndex) % groveFrondColors.length]));
    }
  }
  groveTrunks.instanceMatrix.needsUpdate = true;
  groveFronds.instanceMatrix.needsUpdate = true;
  if (groveFronds.instanceColor) groveFronds.instanceColor.needsUpdate = true;
  groveTrunks.castShadow = false;
  groveFronds.castShadow = false;
  root.add(groveTrunks, groveFronds);

  const oasisShrubCount = isTouchDevice ? 68 : 118;
  const oasisShrubs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.74, 8, 5),
    stdMat(0xffffff, { emissive: 0x12351d, emissiveIntensity: 0.24, roughness: 0.82, flatShading: true }),
    oasisShrubCount
  );
  oasisShrubs.name = 'Nebula Oasis dense shoreline undergrowth';
  const shrubColors = [0x286d3e, 0x3c8b49, 0x599f4b, 0x2f785f];
  for (let shrubIndex = 0; shrubIndex < oasisShrubCount; shrubIndex++) {
    const angle = shrubIndex * 2.399963 + Math.sin(shrubIndex * 1.27) * 0.12;
    const radial = 1.005 + (shrubIndex % 13) * 0.021;
    const normal = oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * radial,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * radial
    );
    groveDummy.position.copy(surfaceWorldPosition(normal, 0.3 + (shrubIndex % 4) * 0.055));
    groveDummy.quaternion.setFromUnitVectors(UP, normal);
    groveDummy.scale.set(
      1.05 + (shrubIndex % 5) * 0.17,
      0.28 + ((shrubIndex + 2) % 5) * 0.065,
      1.12 + ((shrubIndex + 4) % 5) * 0.16
    );
    groveDummy.updateMatrix();
    oasisShrubs.setMatrixAt(shrubIndex, groveDummy.matrix);
    oasisShrubs.setColorAt(shrubIndex, new THREE.Color(shrubColors[shrubIndex % shrubColors.length]));
  }
  oasisShrubs.instanceMatrix.needsUpdate = true;
  if (oasisShrubs.instanceColor) oasisShrubs.instanceColor.needsUpdate = true;
  root.add(oasisShrubs);

  const flowerCount = isTouchDevice ? 42 : 78;
  const stemGeometry = new THREE.CylinderGeometry(0.022, 0.034, 0.52, 5);
  const bloomGeometry = new THREE.DodecahedronGeometry(0.15, 0);
  const stems = new THREE.InstancedMesh(stemGeometry, stdMat(0x5cffb1, { roughness: 0.62 }), flowerCount);
  const blooms = new THREE.InstancedMesh(
    bloomGeometry,
    stdMat(0xffffff, { emissive: 0x552266, emissiveIntensity: 0.72, roughness: 0.42 }),
    flowerCount
  );
  const flowerDummy = new THREE.Object3D();
  const flowerColors = [0xff63c8, 0x8c7bff, 0x66ffe1, 0xffd66b, 0xd87cff];
  for (let flowerIndex = 0; flowerIndex < flowerCount; flowerIndex++) {
    const angle = flowerIndex * 2.399963 + Math.sin(flowerIndex * 0.91) * 0.16;
    const radial = 1.03 + (flowerIndex % 7) * 0.027;
    const normal = oasisNormalAt(
      Math.cos(angle) * MARS_OASIS_RADIUS_X * radial,
      Math.sin(angle) * MARS_OASIS_RADIUS_Z * radial
    );
    flowerDummy.position.copy(surfaceWorldPosition(normal, 0.34));
    flowerDummy.quaternion.setFromUnitVectors(UP, normal);
    flowerDummy.scale.setScalar(0.82 + (flowerIndex % 5) * 0.08);
    flowerDummy.updateMatrix();
    stems.setMatrixAt(flowerIndex, flowerDummy.matrix);
    flowerDummy.position.copy(surfaceWorldPosition(normal, 0.68 + (flowerIndex % 3) * 0.08));
    flowerDummy.rotation.y = flowerIndex * 1.7;
    flowerDummy.updateMatrix();
    blooms.setMatrixAt(flowerIndex, flowerDummy.matrix);
    blooms.setColorAt(flowerIndex, new THREE.Color(flowerColors[flowerIndex % flowerColors.length]));
  }
  stems.instanceMatrix.needsUpdate = true;
  blooms.instanceMatrix.needsUpdate = true;
  if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
  stems.name = 'Nebula Oasis flower stems';
  blooms.name = 'Nebula Oasis luminous flowers';
  root.add(stems, blooms);

  const swimmers = [];
  const swimmerColors = [0xff6dc6, 0x7effdd, 0x9c7bff, 0xffc65c, 0x5bd9ff, 0xff7a68];
  for (let swimmerIndex = 0; swimmerIndex < 6; swimmerIndex++) {
    const swimmer = new THREE.Group();
    swimmer.name = swimmerIndex % 3 === 2 ? 'Crystalline lake ray' : 'Nebula lake swimmer';
    const color = swimmerColors[swimmerIndex];
    const accent = swimmerColors[(swimmerIndex + 2) % swimmerColors.length];
    const bodyMaterial = stdMat(color, { emissive: color, emissiveIntensity: 0.72, roughness: 0.34 });
    const accentMaterial = stdMat(accent, { emissive: accent, emissiveIntensity: 0.92, roughness: 0.28 });
    const wings = [];
    let tail;
    if (swimmerIndex % 3 === 2) {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), bodyMaterial);
      body.scale.set(1.35, 0.18, 0.92);
      swimmer.add(body);
      [-1, 1].forEach((side) => {
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 8), accentMaterial);
        wing.position.x = side * 0.72;
        wing.scale.set(1.18, 0.09, 0.65);
        swimmer.add(wing);
        wings.push({ mesh: wing, side });
      });
      tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.45, 6), bodyMaterial);
      tail.position.z = 1.15;
      tail.rotation.x = Math.PI / 2;
      swimmer.add(tail);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 11), bodyMaterial);
      body.scale.set(0.62, 0.48, 1.35);
      swimmer.add(body);
      tail = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.82, 5), accentMaterial);
      tail.position.z = 0.92;
      tail.rotation.x = -Math.PI / 2;
      swimmer.add(tail);
      [-1, 1].forEach((side) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), stdMat(0x07121a, { roughness: 0.5 }));
        eye.position.set(side * 0.2, 0.12, -0.58);
        swimmer.add(eye);
      });
    }
    root.add(swimmer);
    swimmers.push({
      root: swimmer,
      tail,
      wings,
      angle: (swimmerIndex / 6) * Math.PI * 2,
      speed: 0.16 + swimmerIndex * 0.022,
      radiusX: MARS_OASIS_RADIUS_X * (0.3 + (swimmerIndex % 3) * 0.16),
      radiusZ: MARS_OASIS_RADIUS_Z * (0.36 + (swimmerIndex % 2) * 0.2),
      phase: swimmerIndex * 1.31,
      normal: new THREE.Vector3(),
      nextNormal: new THREE.Vector3(),
      heading: new THREE.Vector3(),
    });
  }

  const butterflies = [];
  const butterflyCount = isTouchDevice ? 8 : 14;
  for (let butterflyIndex = 0; butterflyIndex < butterflyCount; butterflyIndex++) {
    const butterfly = new THREE.Group();
    butterfly.name = 'Free-flying space butterfly';
    butterfly.scale.setScalar(1.45);
    const bodyMaterial = stdMat(0x25143e, { emissive: 0x6f2ba8, emissiveIntensity: 0.62, roughness: 0.46 });
    const wingColor = flowerColors[butterflyIndex % flowerColors.length];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 7), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    butterfly.add(body);
    const wings = [];
    [-1, 1].forEach((side) => {
      const wing = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 7),
        new THREE.MeshBasicMaterial({ color: wingColor, transparent: true, opacity: 0.76, depthWrite: false, toneMapped: false })
      );
      wing.position.x = side * 0.22;
      wing.scale.set(1.15, 0.1, 0.78);
      wing.rotation.z = side * 0.5;
      butterfly.add(wing);
      wings.push({ mesh: wing, side });
    });
    root.add(butterfly);
    butterflies.push({
      root: butterfly,
      wings,
      angle: (butterflyIndex / butterflyCount) * Math.PI * 2,
      speed: 0.12 + (butterflyIndex % 5) * 0.025,
      radiusX: MARS_OASIS_RADIUS_X * (0.72 + (butterflyIndex % 4) * 0.08),
      radiusZ: MARS_OASIS_RADIUS_Z * (0.72 + (butterflyIndex % 3) * 0.09),
      altitude: 2.2 + (butterflyIndex % 5) * 0.62,
      phase: butterflyIndex * 1.47,
      normal: new THREE.Vector3(),
      nextNormal: new THREE.Vector3(),
      heading: new THREE.Vector3(),
    });
  }

  const parrot = buildOasisParrot();
  root.add(parrot.root);

  const boat = buildOasisSkiff();
  root.add(boat.root);

  const swimRipple = new THREE.Group();
  swimRipple.name = 'Alien swimming surface ripples';
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: 0xb7fff4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const rippleRings = [
    new THREE.Mesh(new THREE.RingGeometry(0.72, 0.86, 30), rippleMaterial.clone()),
    new THREE.Mesh(new THREE.RingGeometry(1.08, 1.17, 34), rippleMaterial.clone()),
  ];
  rippleRings.forEach((ring) => {
    ring.rotation.x = -Math.PI / 2;
    swimRipple.add(ring);
  });
  swimRipple.visible = false;
  root.add(swimRipple);

  const label = makeLabelSprite('NEBULA OASIS · LIVING LAKE', '#9effe7');
  const labelNormal = oasisNormalAt(0, -MARS_OASIS_RADIUS_Z * 1.12);
  label.position.copy(surfaceWorldPosition(labelNormal, 7.8));
  label.scale.set(8.8, 1.12, 1);
  root.add(label);
  root.visible = false;
  scene.add(root);
  return { root, water, waterMaterial, foam, sparkleMaterial, sparkles, swimmers, butterflies, parrot, boat, swimRipple, rippleRings };
}

const oasisLake = buildOasisLake();

function updateOasisLake(dt, time) {
  const oasisViewerNormal = currentWorld !== 'mars'
    ? null
    : travelMode === 'boating'
      ? oasisLake.boat.normal
      : travelMode === 'walking'
        ? footNormal
        : travelMode === 'driving' && caveTravelZone === 'surface' ? playerNormal : null;
  const oasisRevealDistance = oasisViewerNormal
    ? geodesicDistance(oasisViewerNormal, MARS_OASIS_NORMAL)
    : Infinity;
  // The oasis is geographically close to the Xenobiology Globe, but it sits
  // outside the sealed habitat and cannot contribute to interior views. It is
  // also highly detailed and includes transmissive water, so letting this
  // updater re-enable it would defeat the interior streaming boundary.
  const oasisShouldReveal = !xenobiologyInteriorCullActive
    && oasisRevealDistance <= MARS_OASIS_REVEAL_DISTANCE;
  if (oasisLake.root.visible !== oasisShouldReveal) oasisLake.root.visible = oasisShouldReveal;
  if (!oasisShouldReveal) return;

  oasisLake.waterMaterial.emissiveIntensity = 0.38 + Math.sin(time * 0.72) * 0.07;
  oasisLake.waterMaterial.opacity = 0.75 + Math.sin(time * 0.46) * 0.03;
  oasisLake.foam.material.opacity = 0.58 + Math.sin(time * 1.35) * 0.16;
  oasisLake.sparkleMaterial.opacity = 0.54 + Math.sin(time * 1.9) * 0.2;
  oasisLake.sparkleMaterial.size = (isTouchDevice ? 0.24 : 0.18) * (0.88 + Math.sin(time * 1.2) * 0.12);

  const swimmingNow = travelMode === 'walking' && currentWorld === 'mars' && alienSwimming;
  oasisLake.swimRipple.visible = swimmingNow;
  if (swimmingNow) {
    oasisLake.swimRipple.position.copy(surfaceWorldPosition(footNormal, 0.285));
    oasisLake.swimRipple.quaternion.setFromUnitVectors(UP, footNormal);
    oasisLake.rippleRings.forEach((ring, index) => {
      const pulse = (time * (0.62 + index * 0.11) + index * 0.48) % 1;
      const scale = 0.72 + pulse * 1.35 + Math.min(0.4, Math.abs(footSpeed) * 0.05);
      ring.scale.setScalar(scale);
      ring.material.opacity = (1 - pulse) * (0.34 + Math.min(0.28, Math.abs(footSpeed) * 0.035));
    });
  }

  if (travelMode !== 'boating') {
    const boat = oasisLake.boat;
    boat.root.position.copy(surfaceWorldPosition(boat.normal, 0.48 + Math.sin(time * 1.75) * 0.055));
    boat.root.quaternion.copy(surfaceVehicleQuaternion(boat.normal, boat.heading));
    boat.visual.rotation.x = THREE.MathUtils.damp(boat.visual.rotation.x, Math.sin(time * 2.4) * 0.012, 3.5, dt);
    boat.visual.rotation.z = THREE.MathUtils.damp(boat.visual.rotation.z, Math.sin(time * 1.6) * 0.014, 3.5, dt);
    boat.propeller.rotation.z += dt * 1.2;
    boat.label.visible = true;
    boat.wakes.forEach((wake) => {
      wake.material.opacity = THREE.MathUtils.damp(wake.material.opacity, 0, 6, dt);
    });
  }

  oasisLake.swimmers.forEach((swimmer, swimmerIndex) => {
    swimmer.angle = (swimmer.angle + dt * swimmer.speed) % (Math.PI * 2);
    const x = Math.cos(swimmer.angle) * swimmer.radiusX;
    const z = Math.sin(swimmer.angle) * swimmer.radiusZ;
    const nextAngle = swimmer.angle + 0.025;
    oasisNormalAt(x, z, swimmer.normal);
    oasisNormalAt(
      Math.cos(nextAngle) * swimmer.radiusX,
      Math.sin(nextAngle) * swimmer.radiusZ,
      swimmer.nextNormal
    );
    swimmer.heading.copy(swimmer.nextNormal)
      .addScaledVector(swimmer.normal, -swimmer.nextNormal.dot(swimmer.normal))
      .normalize();
    const swimLift = 0.3 + Math.sin(time * 1.7 + swimmer.phase) * 0.055;
    swimmer.root.position.copy(swimmer.normal)
      .multiplyScalar(PLANET_RADIUS + getSurfaceHeight(swimmer.normal) + swimLift);
    orientSurfaceRoot(swimmer.root, swimmer.normal, swimmer.heading);
    swimmer.root.rotation.z += Math.sin(time * 1.45 + swimmer.phase) * 0.002;
    swimmer.tail.rotation.y = Math.sin(time * 6.4 + swimmer.phase) * 0.38;
    swimmer.wings.forEach((wing) => {
      wing.mesh.rotation.z = wing.side * (0.12 + Math.sin(time * 3.2 + swimmerIndex) * 0.13);
    });
  });

  oasisLake.butterflies.forEach((butterfly) => {
    butterfly.angle = (butterfly.angle + dt * butterfly.speed) % (Math.PI * 2);
    const wobble = Math.sin(time * 0.9 + butterfly.phase) * 2.2;
    const x = Math.cos(butterfly.angle) * (butterfly.radiusX + wobble);
    const z = Math.sin(butterfly.angle) * (butterfly.radiusZ + wobble * 0.55);
    const nextAngle = butterfly.angle + 0.03;
    oasisNormalAt(x, z, butterfly.normal);
    oasisNormalAt(
      Math.cos(nextAngle) * butterfly.radiusX,
      Math.sin(nextAngle) * butterfly.radiusZ,
      butterfly.nextNormal
    );
    butterfly.heading.copy(butterfly.nextNormal)
      .addScaledVector(butterfly.normal, -butterfly.nextNormal.dot(butterfly.normal))
      .normalize();
    const altitude = butterfly.altitude + Math.sin(time * 2.1 + butterfly.phase) * 0.48;
    butterfly.root.position.copy(butterfly.normal)
      .multiplyScalar(PLANET_RADIUS + getSurfaceHeight(butterfly.normal) + altitude);
    orientSurfaceRoot(butterfly.root, butterfly.normal, butterfly.heading);
    butterfly.root.rotation.z += Math.sin(time * 1.8 + butterfly.phase) * 0.003;
    butterfly.wings.forEach((wing) => {
      wing.mesh.rotation.z = wing.side * (0.3 + Math.sin(time * 17 + butterfly.phase) * 0.28);
    });
  });

  const parrot = oasisLake.parrot;
  parrot.angle = (parrot.angle + dt * parrot.speed) % (Math.PI * 2);
  const parrotRadiusPulse = Math.sin(time * 0.42) * 2.4;
  const parrotX = Math.cos(parrot.angle) * (parrot.radiusX + parrotRadiusPulse);
  const parrotZ = Math.sin(parrot.angle) * (parrot.radiusZ + parrotRadiusPulse * 0.45);
  const parrotNextAngle = parrot.angle + 0.025;
  oasisNormalAt(parrotX, parrotZ, parrot.normal);
  oasisNormalAt(
    Math.cos(parrotNextAngle) * parrot.radiusX,
    Math.sin(parrotNextAngle) * parrot.radiusZ,
    parrot.nextNormal
  );
  parrot.heading.copy(parrot.nextNormal)
    .addScaledVector(parrot.normal, -parrot.nextNormal.dot(parrot.normal))
    .normalize();
  const parrotAltitude = parrot.altitude + Math.sin(time * 0.86) * 1.25 + Math.sin(time * 2.1) * 0.22;
  parrot.root.position.copy(parrot.normal)
    .multiplyScalar(PLANET_RADIUS + getSurfaceHeight(parrot.normal) + parrotAltitude);
  orientSurfaceRoot(parrot.root, parrot.normal, parrot.heading);
  parrot.visual.position.y = Math.sin(time * 2.1) * 0.08;
  parrot.visual.rotation.z = -0.16 - Math.sin(parrot.angle * 2) * 0.2;
  parrot.visual.rotation.x = Math.sin(time * 0.72) * 0.055;
  const wingBeat = Math.sin(time * 7.4);
  parrot.wingPivots.forEach((wing) => {
    wing.root.rotation.z = wing.side * (0.16 + wingBeat * 0.74);
    wing.root.rotation.x = Math.sin(time * 3.7 + wing.side) * 0.05;
  });
  parrot.tailFeathers.forEach((tail, index) => {
    tail.rotation.y = (index - 1) * 0.12 + Math.sin(time * 2.9 + index * 0.7) * 0.08;
  });
  parrot.head.rotation.y = Math.sin(time * 1.5) * 0.14;
  parrot.head.rotation.x = Math.sin(time * 2.2) * 0.045;
}

let drivingCoursePrompt = '';
let activeDrivingCourse = null;

function makeWoodSignTexture(text) {
  const designWidth = 1024;
  const designHeight = 256;
  const canvas = document.createElement('canvas');
  // These signs sit beside the spawn trails and can enter the frustum during
  // the first few walking steps. A 1024x256 mipmapped canvas caused a cold GPU
  // upload right on that movement frame. Draw at half resolution and use a
  // single linear level; the physical sign never needs the extra texels.
  canvas.width = designWidth / 2;
  canvas.height = designHeight / 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(0.5, 0.5);
  const fontSize = text.length > 22 ? 94 : text.length > 16 ? 108 : 126;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(20, 7, 2, 0.95)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = '#241006';
  ctx.lineWidth = 24;
  ctx.strokeText(text, designWidth / 2, designHeight / 2 + 3, 960);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff7df';
  ctx.lineWidth = 5;
  ctx.strokeText(text, designWidth / 2, designHeight / 2 + 3, 960);
  ctx.fillStyle = '#fff1bc';
  ctx.fillText(text, designWidth / 2, designHeight / 2 + 3, 960);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function buildSignposts() {
  const signposts = SURFACE_WAYPOINT_HUBS.map((hub) => ({
    hub,
    target: hub.normal,
    label: hub.key === 'crash' ? 'CRASHED SATELLITE' : hub.name,
  }));
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2817, roughness: 0.96, flatShading: true });
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x92582d,
    emissive: 0x251107,
    emissiveIntensity: 0.24,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const nailMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4239, metalness: 0.7, roughness: 0.5 });
  signposts.forEach(({ hub, target, label: signLabel }) => {
    const group = new THREE.Group();
    const signDistance = 7.5;
    const trailDistance = geodesicDistance(START_NORMAL, target);
    const pathNormal = slerpNormals(START_NORMAL, target, signDistance / trailDistance);
    const towardDestination = target.clone().addScaledVector(pathNormal, -target.dot(pathNormal)).normalize();
    const pathRight = towardDestination.clone().cross(pathNormal).normalize();
    const boardWidth = THREE.MathUtils.clamp(3.35 + signLabel.length * 0.12, 4.2, 6.4);
    // Keep the full board beyond the packed-dirt trail while its face remains
    // aimed at approaching drivers. Longer landmark names get more shoulder room.
    const shoulderDistance = boardWidth * 0.5 + 1.45;
    const normal = stepWorldNormal(pathNormal, pathRight, shoulderDistance, PLANET_RADIUS);
    const approachNormal = slerpNormals(START_NORMAL, target, Math.max(0, signDistance - 3.2) / trailDistance);
    // Face the traveler coming up this exact dirt ribbon rather than a fixed
    // spawn camera. Each sign is now readable from its own approach trail.
    const signViewDirection = approachNormal.clone()
      .addScaledVector(normal, -approachNormal.dot(normal))
      .normalize();
    const boardRight = normal.clone().cross(signViewDirection).normalize();
    // Aim the arrow directly from the roadside shoulder toward this sign's
    // dirt ribbon. Projecting the distant destination onto the board could
    // flip the arrow when the board was viewed at an oblique angle.
    const directionToPath = pathNormal.clone().addScaledVector(normal, -pathNormal.dot(normal)).normalize();
    const trailFacingSide = directionToPath.dot(boardRight) >= 0 ? 1 : -1;
    const arrowSide = trailFacingSide;
    // Stop the support below the lettering instead of running it through the
    // middle of the words on the sign face.
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.62, 0.28), postMaterial);
    pole.position.y = 0.8;
    pole.rotation.z = (hub.x + hub.z) * 0.00022;
    group.add(pole);
    const arrowHeadLength = 0.92;
    const halfWidth = boardWidth * 0.5;
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-halfWidth * arrowSide, -0.48);
    arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, -0.48);
    arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, -0.68);
    arrowShape.lineTo(halfWidth * arrowSide, 0);
    arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, 0.68);
    arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, 0.48);
    arrowShape.lineTo(-halfWidth * arrowSide, 0.48);
    arrowShape.closePath();
    const boardGeometry = new THREE.ShapeGeometry(arrowShape, 1);
    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.position.set(0, 2.16, 0);
    group.add(board);
    const letteringWidth = boardWidth - arrowHeadLength - 0.28;
    const letteringGeometry = new THREE.PlaneGeometry(letteringWidth, 0.78);
    const letteringMaterial = new THREE.MeshBasicMaterial({
      map: makeWoodSignTexture(signLabel),
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    });
    const lettering = new THREE.Mesh(letteringGeometry, letteringMaterial);
    const letteringCenterX = -arrowHeadLength * 0.48 * arrowSide;
    lettering.position.set(letteringCenterX, 2.16, 0.02);
    group.add(lettering);
    const backLettering = new THREE.Mesh(letteringGeometry, letteringMaterial);
    backLettering.position.set(letteringCenterX, 2.16, -0.02);
    backLettering.rotation.y = Math.PI;
    group.add(backLettering);
    [-1, 1].forEach((side) => {
      const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8), nailMaterial);
      nail.rotation.x = Math.PI / 2;
      nail.position.set(letteringCenterX + side * (letteringWidth * 0.44), 2.16, 0.025);
      group.add(nail);
    });
    placeSurfaceGroup(group, normal);
    const signOrientation = new THREE.Matrix4().makeBasis(boardRight, normal, signViewDirection);
    group.quaternion.setFromRotationMatrix(signOrientation);
    marsSignposts.push(group);
  });
}
const marsSignposts = [];
buildSignposts();

function buildOasisBranchSign() {
  const group = new THREE.Group();
  group.name = 'Wooden OASIS LAKE branch sign';
  const incomingDirection = xenobiologyTrailHub.normal.clone()
    .addScaledVector(oasisBranchNormal, -xenobiologyTrailHub.normal.dot(oasisBranchNormal))
    .normalize();
  const incomingRight = incomingDirection.clone().cross(oasisBranchNormal).normalize();
  const oasisDirection = oasisBypassTargets[0].normal.clone()
    .addScaledVector(oasisBranchNormal, -oasisBypassTargets[0].normal.dot(oasisBranchNormal))
    .normalize();
  const oasisSide = oasisDirection.dot(incomingRight) >= 0 ? 1 : -1;
  const signNormal = stepWorldNormal(oasisBranchNormal, incomingRight, oasisSide * -4.7, PLANET_RADIUS);
  const priorNormal = slerpNormals(START_NORMAL, xenobiologyTrailHub.normal, 0.68);
  const signViewDirection = priorNormal.clone()
    .addScaledVector(signNormal, -priorNormal.dot(signNormal))
    .normalize();
  const boardRight = signNormal.clone().cross(signViewDirection).normalize();
  const oasisDirectionAtSign = oasisBypassTargets[0].normal.clone()
    .addScaledVector(signNormal, -oasisBypassTargets[0].normal.dot(signNormal))
    .normalize();
  const arrowSide = oasisDirectionAtSign.dot(boardRight) >= 0 ? 1 : -1;

  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2817, roughness: 0.96, flatShading: true });
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x92582d,
    emissive: 0x251107,
    emissiveIntensity: 0.24,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.62, 0.28), postMaterial);
  pole.position.y = 0.8;
  group.add(pole);

  const boardWidth = 5.4;
  const arrowHeadLength = 1.02;
  const halfWidth = boardWidth * 0.5;
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-halfWidth * arrowSide, -0.5);
  arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, -0.5);
  arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, -0.72);
  arrowShape.lineTo(halfWidth * arrowSide, 0);
  arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, 0.72);
  arrowShape.lineTo((halfWidth - arrowHeadLength) * arrowSide, 0.5);
  arrowShape.lineTo(-halfWidth * arrowSide, 0.5);
  arrowShape.closePath();
  const board = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), boardMaterial);
  board.position.y = 2.16;
  group.add(board);

  const letteringWidth = boardWidth - arrowHeadLength - 0.32;
  const letteringMaterial = new THREE.MeshBasicMaterial({
    map: makeWoodSignTexture('OASIS LAKE'),
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
  });
  const letteringCenterX = -arrowHeadLength * 0.48 * arrowSide;
  [0.022, -0.022].forEach((z, index) => {
    const lettering = new THREE.Mesh(new THREE.PlaneGeometry(letteringWidth, 0.8), letteringMaterial);
    lettering.position.set(letteringCenterX, 2.16, z);
    if (index === 1) lettering.rotation.y = Math.PI;
    group.add(lettering);
  });

  placeSurfaceGroup(group, signNormal);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(boardRight, signNormal, signViewDirection));
  marsSignposts.push(group);
}
buildOasisBranchSign();

function buildMountainHomeBranchSign() {
  const group = new THREE.Group();
  group.name = 'Wooden mountain-home branch arrow';
  const outpostHub = HUBS.find((hub) => hub.key === 'outpost');
  const incoming = outpostHub.normal.clone()
    .addScaledVector(ALIEN_HOME_BRANCH_NORMAL, -outpostHub.normal.dot(ALIEN_HOME_BRANCH_NORMAL))
    .normalize();
  const pathRight = incoming.clone().cross(ALIEN_HOME_BRANCH_NORMAL).normalize();
  const towardHome = ALIEN_MOUNTAIN_HOME.normal.clone()
    .addScaledVector(ALIEN_HOME_BRANCH_NORMAL, -ALIEN_MOUNTAIN_HOME.normal.dot(ALIEN_HOME_BRANCH_NORMAL))
    .normalize();
  const homeSide = towardHome.dot(pathRight) >= 0 ? 1 : -1;
  const signNormal = stepWorldNormal(ALIEN_HOME_BRANCH_NORMAL, pathRight, homeSide * -4.8, PLANET_RADIUS);
  const approachNormal = slerpNormals(START_NORMAL, outpostHub.normal, 0.64);
  const viewDirection = approachNormal.clone().addScaledVector(signNormal, -approachNormal.dot(signNormal)).normalize();
  const boardRight = signNormal.clone().cross(viewDirection).normalize();
  const directionAtSign = ALIEN_MOUNTAIN_HOME.normal.clone()
    .addScaledVector(signNormal, -ALIEN_MOUNTAIN_HOME.normal.dot(signNormal))
    .normalize();
  const arrowSide = directionAtSign.dot(boardRight) >= 0 ? 1 : -1;
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x492717, roughness: 0.98, flatShading: true });
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x8d542d,
    emissive: 0x241006,
    emissiveIntensity: 0.22,
    roughness: 0.93,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.64, 0.28), postMaterial);
  post.position.y = 0.82;
  group.add(post);
  const width = 6.1;
  const half = width * 0.5;
  const head = 1.05;
  const shape = new THREE.Shape();
  shape.moveTo(-half * arrowSide, -0.5);
  shape.lineTo((half - head) * arrowSide, -0.5);
  shape.lineTo((half - head) * arrowSide, -0.72);
  shape.lineTo(half * arrowSide, 0);
  shape.lineTo((half - head) * arrowSide, 0.72);
  shape.lineTo((half - head) * arrowSide, 0.5);
  shape.lineTo(-half * arrowSide, 0.5);
  shape.closePath();
  const board = new THREE.Mesh(new THREE.ShapeGeometry(shape), boardMaterial);
  board.position.y = 2.18;
  group.add(board);
  const textMaterial = new THREE.MeshBasicMaterial({
    map: makeWoodSignTexture('MOUNTAIN HOME'),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const textX = -head * 0.48 * arrowSide;
  [0.022, -0.022].forEach((z, index) => {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width - head - 0.3, 0.8), textMaterial);
    face.position.set(textX, 2.18, z);
    if (index) face.rotation.y = Math.PI;
    group.add(face);
  });
  placeSurfaceGroup(group, signNormal);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(boardRight, signNormal, viewDirection));
  marsSignposts.push(group);
}
buildMountainHomeBranchSign();

/* ---------- hub builders ---------- */

function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts });
}

function collectQualitySensitiveMaterials(root, excludedMaterials = null) {
  const entries = [];
  const visited = new Set();
  root.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (visited.has(material) || excludedMaterials?.has(material)) return;
      visited.add(material);
      if (material.transmission > 0 || (material.transparent && material.side === THREE.DoubleSide)) {
        entries.push({
          material,
          transmission: material.transmission || 0,
          forceSinglePass: material.forceSinglePass,
        });
      }
    });
  });
  return entries;
}

function applyQualitySensitiveMaterials(entries, useHighQuality) {
  entries.forEach((entry) => {
    const nextTransmission = useHighQuality ? entry.transmission : 0;
    const nextForceSinglePass = useHighQuality ? entry.forceSinglePass : true;
    if (entry.material.transmission !== nextTransmission) {
      entry.material.transmission = nextTransmission;
      entry.material.needsUpdate = true;
    }
    entry.material.forceSinglePass = nextForceSinglePass;
  });
}

const lowDetailProxyMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  emissive: 0x071014,
  emissiveIntensity: 0.18,
});

/**
 * Flattens a small articulated model into one vertex-coloured mesh. The rich
 * children remain available for explicit High mode; Auto/Medium/Low render the
 * proxy to avoid dozens of draw calls per creature.
 */
function buildLowDetailProxy(root, name, includeMesh = null) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const relativeMatrix = new THREE.Matrix4();
  const bakedColor = new THREE.Color();
  const emissiveColor = new THREE.Color();
  const pieces = [];
  const originals = [];

  root.traverse((child) => {
    if (child === root || !child.isMesh || !child.geometry || (includeMesh && !includeMesh(child))) return;
    originals.push(child);
    // Dynamic instanced appendages are intentionally omitted from the proxy.
    if (child.isInstancedMesh) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (!material) return;
    child.updateWorldMatrix(true, false);
    relativeMatrix.multiplyMatrices(inverseRoot, child.matrixWorld);
    let source = child.geometry.clone();
    if (source.index) {
      const nonIndexed = source.toNonIndexed();
      source.dispose();
      source = nonIndexed;
    }
    source.applyMatrix4(relativeMatrix);
    if (!source.attributes.normal) source.computeVertexNormals();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position.clone());
    geometry.setAttribute('normal', source.attributes.normal.clone());
    const count = source.attributes.position.count;
    const colors = new Float32Array(count * 3);
    bakedColor.copy(material.color || new THREE.Color(0xffffff));
    if (material.emissive) {
      emissiveColor.copy(material.emissive).multiplyScalar(Math.min(0.28, (material.emissiveIntensity || 0) * 0.12));
      bakedColor.add(emissiveColor);
    }
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = bakedColor.r;
      colors[index * 3 + 1] = bakedColor.g;
      colors[index * 3 + 2] = bakedColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(geometry);
    source.dispose();
  });

  const merged = pieces.length ? mergeGeometries(pieces, false) : null;
  pieces.forEach((geometry) => geometry.dispose());
  if (!merged) return null;
  merged.computeBoundingSphere();
  const proxy = new THREE.Mesh(merged, lowDetailProxyMaterial);
  proxy.name = `${name} · batched low-detail proxy`;
  proxy.visible = false;
  root.add(proxy);
  return { proxy, originals };
}

function setLowDetailProxyEnabled(runtime, enabled) {
  const lowDetail = runtime?.lowDetail;
  if (!lowDetail || lowDetail.proxy.visible === enabled) return;
  lowDetail.proxy.visible = enabled;
  lowDetail.originals.forEach((mesh) => { mesh.visible = !enabled; });
}

function makeProjectScreenTexture(project, index) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 432;
  const ctx = canvas.getContext('2d');
  if (project.kind === 'contact') {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#123b43');
    gradient.addColorStop(1, '#09121d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(111, 235, 255, 0.72)';
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.fillStyle = '#eaffff';
    ctx.font = '900 39px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CAITLIN BAX · CONTACT', 42, 54, 680);
    project.details.forEach((detail, detailIndex) => {
      ctx.fillStyle = detailIndex === 0 ? '#98fff0' : '#c6e9f1';
      ctx.font = detailIndex === 0 ? '800 24px monospace' : '700 20px monospace';
      ctx.fillText(detail, 42, 125 + detailIndex * 57, 680);
    });
    ctx.fillStyle = 'rgba(156, 244, 255, 0.86)';
    ctx.font = '900 20px monospace';
    ctx.fillText('CLICK TERMINAL TO EMAIL CAITLIN', 42, 382, 680);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const hues = [190, 155, 32, 274, 8, 45];
  const hue = hues[index % hues.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `hsl(${hue} 62% 16%)`);
  gradient.addColorStop(1, `hsl(${(hue + 52) % 360} 58% 7%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = `hsla(${hue} 95% 72% / 0.55)`;
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = `hsla(${hue} 90% 65% / 0.18)`;
  ctx.fillRect(42, 98, 684, 205);
  for (let row = 0; row < 4; row++) {
    ctx.fillStyle = `hsla(${hue + row * 12} 90% ${58 + row * 4}% / ${0.34 + row * 0.08})`;
    ctx.fillRect(72, 128 + row * 42, 180 + ((index * 97 + row * 83) % 410), 20);
  }
  ctx.fillStyle = '#f3fbff';
  ctx.font = '900 38px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(project.title.toUpperCase(), 42, 58, 680);
  ctx.fillStyle = `hsl(${hue} 94% 78%)`;
  ctx.font = '800 21px monospace';
  ctx.fillText(new URL(project.url).hostname.toUpperCase(), 42, 346, 680);
  ctx.fillStyle = 'rgba(223, 245, 255, 0.7)';
  ctx.font = '700 17px monospace';
  ctx.fillText('CLICK SCREEN TO OPEN LIVE SITE', 42, 390, 680);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildResearchOutpost(hub) {
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);
  const trailApproachWorld = START_NORMAL.clone()
    .addScaledVector(hub.normal, -START_NORMAL.dot(hub.normal))
    .normalize();
  const trailApproachLocal = trailApproachWorld.applyQuaternion(group.quaternion.clone().invert()).normalize();
  const entranceYaw = Math.atan2(-trailApproachLocal.z, trailApproachLocal.x);

  const hull = stdMat(0x68747a, { metalness: 0.82, roughness: 0.38, flatShading: true });
  const scorchedHull = stdMat(0x292c2c, { metalness: 0.62, roughness: 0.72, flatShading: true });
  const exposedInterior = stdMat(0x080b0d, { metalness: 0.28, roughness: 0.82 });
  const cockpitGlass = new THREE.MeshPhysicalMaterial({
    color: 0x8defff,
    emissive: 0x0b5268,
    emissiveIntensity: 0.38,
    transparent: true,
    opacity: 0.16,
    transmission: 0.48,
    thickness: 0.28,
    roughness: 0.08,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(7.8, 64),
    new THREE.MeshBasicMaterial({ color: 0x180705, transparent: true, opacity: 0.62, depthWrite: false })
  );
  scorch.rotation.x = -Math.PI / 2;
  const shipScaleRatio = PROJECT_SHIP_SCALE / 1.75;
  scorch.scale.set(1.45 * shipScaleRatio, 0.72 * shipScaleRatio, 1);
  scorch.position.set(-0.7, 0.025, 1.25);
  group.add(scorch);

  for (let i = 0; i < 6; i++) {
    const trenchGeometry = new THREE.CircleGeometry(2.35 + (i % 3) * 0.34, 28);
    trenchGeometry.rotateX(-Math.PI / 2);
    const trench = new THREE.Mesh(
      trenchGeometry,
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x260b07 : 0x35110b,
        transparent: true,
        opacity: 0.48 + i * 0.025,
        depthWrite: false,
      })
    );
    trench.rotation.y = -0.52 + Math.sin(i * 2.7) * 0.07;
    trench.scale.set(1.22 + i * 0.04, 1, 0.42 + (i % 2) * 0.09);
    trench.position.set(2.2 + i * 1.45, 0.052 + i * 0.001, 2.6 + i * 1.05 + Math.sin(i * 1.8) * 0.32);
    group.add(trench);
  }

  const saucer = new THREE.Group();
  saucer.name = 'Caitlin Projects · downed extraterrestrial craft';
  saucer.position.set(-0.45, 0.72, 0.15);
  // Local +X is the broken hatch and recovery-ramp side. Aim it directly at
  // the incoming dirt trail so players naturally walk into the entrance.
  saucer.rotation.set(-0.045, entranceYaw, 0.075);
  saucer.scale.setScalar(PROJECT_SHIP_SCALE);
  group.add(saucer);

  const lowerDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.75, 3.75, 1.05, 48, 2), scorchedHull);
  lowerDisc.position.y = 0.58;
  saucer.add(lowerDisc);
  const upperDisc = new THREE.Mesh(new THREE.CylinderGeometry(3.95, 5.55, 0.92, 48, 2), hull);
  upperDisc.position.y = 1.46;
  saucer.add(upperDisc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.15, 0.33, 10, 64), hull);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.18;
  saucer.add(rim);

  for (let i = 0; i < 14; i++) {
    if (i === 2 || i === 3) continue;
    const angle = (i / 14) * Math.PI * 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.12, 0.62), i % 4 === 0 ? scorchedHull : hull);
    panel.position.set(Math.cos(angle) * 4.72, 1.64 + Math.sin(i * 3.7) * 0.11, Math.sin(angle) * 4.72);
    panel.rotation.y = -angle;
    panel.rotation.z = Math.sin(i * 2.1) * 0.045;
    saucer.add(panel);
  }

  const breach = new THREE.Mesh(new THREE.SphereGeometry(1.18, 9, 7), exposedInterior);
  breach.position.set(4.25, 1.24, 0);
  breach.scale.set(0.76, 1.28, 1.62);
  saucer.add(breach);
  const breachGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 18),
    new THREE.MeshBasicMaterial({ color: 0x58dfff, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  breachGlow.position.set(4.9, 1.24, 0);
  breachGlow.rotation.y = Math.PI / 2;
  saucer.add(breachGlow);

  for (let i = 0; i < 7; i++) {
    const tornPlate = new THREE.Mesh(new THREE.ConeGeometry(0.45 + (i % 3) * 0.15, 1.45 + (i % 2) * 0.5, 3), scorchedHull);
    tornPlate.position.set(4.35 + Math.sin(i * 2.4) * 0.9, 1.18 + Math.cos(i * 1.7) * 0.72, Math.sin(i * 3.1) * 0.9);
    tornPlate.rotation.set(i * 0.53, i * 0.81, i * 0.37);
    saucer.add(tornPlate);
  }

  // Build one continuous ramp from the transformed hatch position to the dirt
  // trail. Its final section follows the spherical terrain instead of using a
  // flat tangent-plane box that can visibly float over the curved planet.
  group.updateMatrixWorld(true);
  const rampHatchWorld = saucer.localToWorld(new THREE.Vector3(4.9, 0.92, 0));
  const rampStartNormal = rampHatchWorld.clone().normalize();
  const rampEndNormal = stepWorldNormal(hub.normal, trailApproachWorld, 34, PLANET_RADIUS);
  const rampHatchSurface = surfaceWorldPosition(rampStartNormal);
  const rampStartLift = Math.max(0.3, rampHatchWorld.clone().sub(rampHatchSurface).dot(rampStartNormal));
  const rampForwardStart = rampEndNormal.clone()
    .addScaledVector(rampStartNormal, -rampEndNormal.dot(rampStartNormal))
    .normalize();
  const rampArcAngle = Math.acos(THREE.MathUtils.clamp(rampStartNormal.dot(rampEndNormal), -1, 1));
  const apronVertices = [];
  const apronIndices = [];
  const apronSteps = 26;
  for (let index = 0; index <= apronSteps; index++) {
    const routeRatio = index / apronSteps;
    const apronNormal = slerpNormals(rampStartNormal, rampEndNormal, routeRatio);
    const apronForward = rampEndNormal.clone().addScaledVector(apronNormal, -rampEndNormal.dot(apronNormal)).normalize();
    const apronRight = apronForward.clone().cross(apronNormal).normalize();
    const terrainContact = THREE.MathUtils.smoothstep(routeRatio, 0, 0.46);
    const rampLift = THREE.MathUtils.lerp(rampStartLift, 0.16, terrainContact);
    [-1, 1].forEach((side) => {
      const edgeNormal = stepWorldNormal(apronNormal, apronRight, side * 2.15, PLANET_RADIUS);
      const edgePosition = surfaceWorldPosition(edgeNormal, rampLift);
      apronVertices.push(edgePosition.x, edgePosition.y, edgePosition.z);
    });
    if (index < apronSteps) {
      const vertexOffset = index * 2;
      apronIndices.push(vertexOffset, vertexOffset + 2, vertexOffset + 1, vertexOffset + 2, vertexOffset + 3, vertexOffset + 1);
    }
  }
  const apronGeometry = new THREE.BufferGeometry();
  apronGeometry.setAttribute('position', new THREE.Float32BufferAttribute(apronVertices, 3));
  apronGeometry.setIndex(apronIndices);
  apronGeometry.computeVertexNormals();
  const rampMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a5153,
    metalness: 0.68,
    roughness: 0.64,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const rampApron = new THREE.Mesh(apronGeometry, rampMaterial);
  rampApron.name = 'Project ship ramp · continuous hatch-to-trail surface';
  scene.add(rampApron);
  const rampSurface = {
    startNormal: rampStartNormal,
    endNormal: rampEndNormal,
    forwardStart: rampForwardStart,
    arcAngle: rampArcAngle,
    startLift: rampStartLift,
    endLift: 0.16,
    halfWidth: 2.15,
  };

  const rimLights = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const color = i % 5 === 0 ? 0xff5b35 : 0x68dfff;
    const lightMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: i % 4 === 0 ? 0.08 : 1.6,
      roughness: 0.18,
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 7), lightMaterial);
    marker.position.set(Math.cos(angle) * 5.18, 1.22, Math.sin(angle) * 5.18);
    saucer.add(marker);
    rimLights.push({ marker, material: lightMaterial, phase: i * 0.73, damaged: i % 4 === 0 });
  }

  const interiorLight = new THREE.PointLight(0x54dfff, 3.6, 15, 2);
  interiorLight.position.set(5.25, 1.5, 0);
  saucer.add(interiorLight);

  const rampLabel = makeLabelSprite('OPEN HATCH · WALK INSIDE', '#c8f8ff');
  rampLabel.position.set(6.35, 2.65, 0);
  rampLabel.scale.set(3.2, 0.44, 1);
  saucer.add(rampLabel);

  const interiorGallery = new THREE.Group();
  interiorGallery.name = "Caitlin's project archive · crashed UFO interior";
  const galleryYaw = Math.atan2(trailApproachLocal.x, trailApproachLocal.z);
  interiorGallery.position.set(0, 2.9, 0);
  interiorGallery.rotation.y = galleryYaw;
  interiorGallery.visible = true;
  group.add(interiorGallery);

  const cabinFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(11.72, 11.92, 0.4, 52),
    stdMat(0x111a22, { metalness: 0.78, roughness: 0.38, emissive: 0x07141d, emissiveIntensity: 0.46 })
  );
  cabinFloor.position.y = 0;
  interiorGallery.add(cabinFloor);
  const canopyRadius = 12.28;
  const canopyVerticalScale = 0.79;
  const canopyGap = 0.5;
  const glassCanopy = new THREE.Mesh(
    new THREE.SphereGeometry(
      canopyRadius,
      64,
      30,
      Math.PI / 2 + canopyGap / 2,
      Math.PI * 2 - canopyGap,
      0,
      Math.PI / 2
    ),
    cockpitGlass
  );
  glassCanopy.position.y = 0.14;
  glassCanopy.scale.y = canopyVerticalScale;
  glassCanopy.renderOrder = 5;
  interiorGallery.add(glassCanopy);
  const canopyCollar = new THREE.Mesh(
    new THREE.TorusGeometry(11.94, 0.42, 10, 72),
    stdMat(0x3b4b52, { metalness: 0.9, roughness: 0.26, emissive: 0x0b303b, emissiveIntensity: 0.5 })
  );
  canopyCollar.rotation.x = Math.PI / 2;
  canopyCollar.position.y = 0.3;
  interiorGallery.add(canopyCollar);

  const ribMaterial = stdMat(0x31444d, { metalness: 0.86, roughness: 0.28, emissive: 0x0b2027, emissiveIntensity: 0.45 });
  for (let ribIndex = 0; ribIndex < 8; ribIndex++) {
    if (ribIndex === 4) continue;
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(canopyRadius + 0.04, 0.06, 6, 72, Math.PI),
      ribMaterial
    );
    rib.position.y = 0.14;
    rib.scale.y = canopyVerticalScale;
    rib.rotation.y = (ribIndex / 8) * Math.PI;
    interiorGallery.add(rib);
  }
  [6.35].forEach((height) => {
    const sphereHeight = height / canopyVerticalScale;
    const latitudeRadius = Math.sqrt(canopyRadius * canopyRadius - sphereHeight * sphereHeight);
    const latitudeRib = new THREE.Mesh(new THREE.TorusGeometry(latitudeRadius, 0.06, 6, 80), ribMaterial);
    latitudeRib.rotation.x = Math.PI / 2;
    latitudeRib.position.y = height + 0.14;
    interiorGallery.add(latitudeRib);
  });
  const canopyCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.72, 0.42, 24),
    stdMat(0x27383f, { metalness: 0.9, roughness: 0.24, emissive: 0x28d9ff, emissiveIntensity: 0.46 })
  );
  canopyCrown.position.y = canopyRadius * canopyVerticalScale + 0.18;
  interiorGallery.add(canopyCrown);
  for (let finIndex = 0; finIndex < 6; finIndex++) {
    const angle = (finIndex / 6) * Math.PI * 2;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.28, 3.8),
      finIndex % 2 ? hull : scorchedHull
    );
    fin.position.set(Math.cos(angle) * 11.85, -0.02, Math.sin(angle) * 11.85);
    fin.rotation.y = -angle;
    interiorGallery.add(fin);
  }

  const archiveTitle = makeLabelSprite("CAITLIN'S PROJECT ARCHIVE · SELECT A SCREEN", '#b8f7ff');
  archiveTitle.position.set(0, 8.15, -4.9);
  archiveTitle.scale.set(9.4, 0.84, 1);
  interiorGallery.add(archiveTitle);

  const projectScreens = [];
  const screenLayout = [
    { x: -6.6, y: 4.72, z: -6.9, yaw: 0.34 },
    { x: 0, y: 4.92, z: -8.45, yaw: 0 },
    { x: 6.6, y: 4.72, z: -6.9, yaw: -0.34 },
    { x: -6.6, y: 1.82, z: -6.9, yaw: 0.34 },
    { x: 0, y: 1.72, z: -8.45, yaw: 0 },
    { x: 6.6, y: 1.82, z: -6.9, yaw: -0.34 },
  ];
  ARCHIVE_SCREENS.forEach((project, index) => {
    const slot = screenLayout[index];
    const screenRig = new THREE.Group();
    screenRig.position.set(slot.x, slot.y, slot.z);
    screenRig.rotation.y = slot.yaw;
    interiorGallery.add(screenRig);
    const frameColor = index % 2 === 0 ? 0x64e8ff : 0xb087ff;
    const frameMaterial = stdMat(0x192831, {
      metalness: 0.82,
      roughness: 0.3,
      emissive: frameColor,
      emissiveIntensity: 0.32,
    });
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(4.08, 2.38, 0.2),
      frameMaterial
    );
    screenRig.add(frame);
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: makeProjectScreenTexture(project, index),
      toneMapped: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.74, 2.04), screenMaterial);
    screen.position.z = 0.112;
    screen.userData.projectScreenIndex = index;
    screenRig.add(screen);
    const statusLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: frameColor, toneMapped: false })
    );
    statusLight.position.set(1.82, -1.03, 0.14);
    screenRig.add(statusLight);
    projectScreens.push({
      project,
      screen,
      material: screenMaterial,
      frameMaterial,
      statusLight,
      loaded: false,
    });
  });

  const consoleDesk = new THREE.Mesh(
    new THREE.BoxGeometry(8.4, 0.3, 1.7),
    stdMat(0x15232b, { metalness: 0.76, roughness: 0.38, emissive: 0x092029, emissiveIntensity: 0.5 })
  );
  consoleDesk.position.set(0, 0.2, -2.8);
  consoleDesk.rotation.x = -0.08;
  interiorGallery.add(consoleDesk);
  const archiveLight = new THREE.PointLight(0x73eaff, 3.9, 26, 2);
  archiveLight.position.set(0, 5.8, 2.4);
  interiorGallery.add(archiveLight);
  const violetFill = new THREE.PointLight(0xa77cff, 3.2, 22, 2);
  violetFill.position.set(-7.5, 3.1, -1.8);
  interiorGallery.add(violetFill);
  const entryFrame = new THREE.Group();
  entryFrame.name = 'Open project archive hatch frame';
  entryFrame.position.set(0, 0, 10.9);
  interiorGallery.add(entryFrame);
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.5, 0.34), ribMaterial);
    post.position.set(side * 2.05, 2.25, 0);
    entryFrame.add(post);
  });
  const header = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.28, 0.34), ribMaterial);
  header.position.y = 4.46;
  entryFrame.add(header);
  const entryGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.05, 4.12),
    new THREE.MeshBasicMaterial({ color: 0x49dfff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
  );
  entryGlow.position.y = 2.22;
  entryFrame.add(entryGlow);
  const interiorCameraAnchor = new THREE.Object3D();
  interiorCameraAnchor.position.set(0, 4.2, 8.8);
  interiorGallery.add(interiorCameraAnchor);
  const interiorLookAnchor = new THREE.Object3D();
  interiorLookAnchor.position.set(0, 3.4, -6.2);
  interiorGallery.add(interiorLookAnchor);

  const smokeCount = 34;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeBases = new Float32Array(smokeCount * 3);
  const smokeSpeeds = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) {
    const x = 4.3 + (Math.random() - 0.5) * 1.5;
    const y = 1.8 + Math.random() * 4.8;
    const z = (Math.random() - 0.5) * 1.5;
    smokePositions[i * 3] = smokeBases[i * 3] = x;
    smokePositions[i * 3 + 1] = smokeBases[i * 3 + 1] = y;
    smokePositions[i * 3 + 2] = smokeBases[i * 3 + 2] = z;
    smokeSpeeds[i] = 0.28 + Math.random() * 0.48;
  }
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smoke = new THREE.Points(
    smokeGeometry,
    new THREE.PointsMaterial({ map: dustTexture, color: 0x544746, size: 1.2, transparent: true, opacity: 0.34, depthWrite: false })
  );
  saucer.add(smoke);

  const sparks = [];
  for (let i = 0; i < 9; i++) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.055 + (i % 3) * 0.025, 6, 4),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb15c : 0x78efff, toneMapped: false })
    );
    saucer.add(spark);
    sparks.push({ mesh: spark, phase: i * 1.37, radius: 0.45 + (i % 4) * 0.22 });
  }

  for (let i = 0; i < 11; i++) {
    const angle = i * 2.21;
    const distance = 6.7 + (i % 5) * 1.05;
    const scale = 0.35 + (i % 4) * 0.2;
    const debris = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), i % 3 === 0 ? scorchedHull : hull);
    debris.position.set(Math.cos(angle) * distance, scale * 0.38, Math.sin(angle) * distance + 1.2);
    debris.rotation.set(angle, i * 0.67, i * 1.11);
    group.add(debris);
    if (i < 5) addCollider(hub.x + debris.position.x, hub.z + debris.position.z, scale * 0.72);
  }

  const archiveLabel = makeLabelSprite("DOWNED UFO · CAITLIN'S PROJECTS", '#9eeaff');
  archiveLabel.position.set(0, 7.35, -0.3);
  archiveLabel.scale.set(7.1, 1.1, 1);
  group.add(archiveLabel);

  addCollider(hub.x, hub.z, 6.8 * PROJECT_SHIP_SCALE);
  return {
    group, saucer, rimLights, interiorLight, smoke, smokeBases, smokeSpeeds, sparks, breachGlow,
    interiorGallery, glassCanopy, canopyCrown, interiorCameraAnchor, interiorLookAnchor,
    entryFrame, projectScreens, archiveLight, archiveLabel, rampApron, rampSurface,
  };
}

function buildCrystalCavern(hub) {
  const baseY = getTerrainHeight(hub.x, hub.z);
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);

  const angleToSpawn = Math.atan2(-hub.x, -hub.z);
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(6, 1.1, 8, 24, Math.PI),
    stdMat(0x8a6aa8, { roughness: 0.6 })
  );
  arch.rotation.x = Math.PI / 2;
  arch.rotation.z = Math.PI;
  arch.rotation.y = angleToSpawn;
  arch.position.y = 0.2;
  group.add(arch);

  const crystalMaterials = [];
  const crystalCount = 7;
  for (let i = 0; i < crystalCount; i++) {
    const a = (i / crystalCount) * Math.PI * 2 + Math.random() * 0.3;
    const r = 4 + Math.random() * 4.5;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r;
    const h = 2.5 + Math.random() * 5.5;
    const mat = stdMat(0xb266ff, { emissive: 0xb266ff, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1 });
    crystalMaterials.push(mat);
    const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.6 + Math.random() * 0.5, h, 6), mat);
    crystal.position.set(dx, h / 2, dz);
    crystal.rotation.y = Math.random() * Math.PI;
    group.add(crystal);
    if (h > 5) addCollider(hub.x + dx, hub.z + dz, 0.9);
  }

  const light = new THREE.PointLight(0xb266ff, 2.2, 30);
  light.position.y = 3;
  group.add(light);

  return { group, crystalMaterials };
}

function buildMarsXenobiologyGlobe(hub) {
  const group = new THREE.Group();
  group.name = 'Ares Xenobiology Globe · extraterrestrial specimen conservatory';
  placeSurfaceGroup(group, hub.normal);

  const globeRadius = 27.2;
  const globeCenterY = 13.7;
  const globeVerticalScale = 0.96;
  const sharedGeometry = {
    habitatBase: new THREE.BoxGeometry(4.55, 0.58, 4.55),
    habitatSubstrate: new THREE.BoxGeometry(3.85, 0.15, 3.85),
    habitatDisplayRing: new THREE.RingGeometry(1.28, 1.62, 32),
    habitatGlass: new THREE.BoxGeometry(4.35, 4.55, 4.35),
    habitatCanopy: new THREE.CylinderGeometry(1.72, 1.72, 0.13, 24),
    habitatPlaqueBacking: new THREE.BoxGeometry(0.12, 1.08, 3.2),
    habitatPlaque: new THREE.PlaneGeometry(3.02, 0.88),
    snakeSegment: new THREE.SphereGeometry(1, 14, 10),
    creatureTailSegment: new THREE.SphereGeometry(1, 10, 8),
    monkeyTailSegment: new THREE.SphereGeometry(1, 10, 8),
    wallFishBody: new THREE.SphereGeometry(0.48, 12, 9),
    wallFishTail: new THREE.ConeGeometry(0.38, 0.72, 5),
    wallFishDorsal: new THREE.ConeGeometry(0.16, 0.5, 5),
    aquariumFishBody: new THREE.SphereGeometry(0.52, 16, 12),
    aquariumFishTail: new THREE.ConeGeometry(0.42, 0.78, 5),
    aquariumFishEye: new THREE.SphereGeometry(0.075, 9, 7),
    aquariumFishFin: new THREE.ConeGeometry(0.17, 0.48, 5),
    aquariumFishCrest: new THREE.ConeGeometry(0.18, 0.58, 5),
    squidTentacleSegment: new THREE.SphereGeometry(1, 9, 7),
  };
  const sharedSpecimenDarkMaterial = stdMat(0x091012, { roughness: 0.72, metalness: 0.16 });
  const sharedTigerCheekMaterial = stdMat(0xffd6a0, { roughness: 0.62 });
  const trailApproachWorld = START_NORMAL.clone()
    .addScaledVector(hub.normal, -START_NORMAL.dot(hub.normal))
    .normalize();
  const trailApproachLocal = trailApproachWorld.applyQuaternion(group.quaternion.clone().invert()).normalize();
  const entranceYaw = Math.atan2(trailApproachLocal.x, trailApproachLocal.z);
  const foundationMaterial = stdMat(0x15262c, {
    metalness: 0.78,
    roughness: 0.38,
    emissive: 0x071b21,
    emissiveIntensity: 0.48,
  });
  const frameMaterial = stdMat(0x78aeb8, {
    metalness: 0.86,
    roughness: 0.24,
    emissive: 0x123d48,
    emissiveIntensity: 0.78,
  });
  const globeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x83e7ef,
    emissive: 0x0b3940,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.15,
    transmission: 0.34,
    thickness: 0.38,
    roughness: 0.1,
    metalness: 0.03,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(25.7, 26.25, 0.66, 72), foundationMaterial);
  floor.position.y = 0.33;
  group.add(floor);
  const foundationRing = new THREE.Mesh(new THREE.TorusGeometry(25.95, 0.58, 10, 104), frameMaterial);
  foundationRing.rotation.x = Math.PI / 2;
  foundationRing.position.y = 0.7;
  group.add(foundationRing);

  const globe = new THREE.Mesh(new THREE.SphereGeometry(globeRadius, 60, 34), globeMaterial);
  globe.position.y = globeCenterY;
  globe.scale.y = globeVerticalScale;
  globe.renderOrder = 5;
  group.add(globe);
  const globeRibs = [];
  for (let index = 0; index < 12; index++) {
    const meridian = new THREE.Mesh(new THREE.TorusGeometry(globeRadius + 0.05, 0.105, 6, 96), frameMaterial);
    meridian.position.y = globeCenterY;
    meridian.scale.y = globeVerticalScale;
    meridian.rotation.y = (index / 12) * Math.PI;
    group.add(meridian);
    globeRibs.push(meridian);
  }
  [-17.2, -8.6, 0, 8.6, 17.2].forEach((latitude) => {
    const radius = Math.sqrt(globeRadius * globeRadius - latitude * latitude);
    const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.105, 6, 96), frameMaterial);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = globeCenterY + latitude * globeVerticalScale;
    group.add(rib);
    globeRibs.push(rib);
  });

  const entrance = new THREE.Group();
  entrance.position.set(trailApproachLocal.x * 25.25, 4.18, trailApproachLocal.z * 25.25);
  entrance.rotation.y = entranceYaw;
  group.add(entrance);
  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(3.62, 40),
    new THREE.MeshBasicMaterial({
      color: 0x17474b,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  entrance.add(portal);
  const portalFrame = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.38, 10, 48), frameMaterial);
  portalFrame.position.z = 0.04;
  entrance.add(portalFrame);
  const entranceLabel = makeLabelSprite('ENTER · XENOBIOLOGY GLOBE', '#a5fff0');
  entranceLabel.position.set(0, 4.76, 0.12);
  entranceLabel.scale.set(6.8, 0.8, 1);
  entrance.add(entranceLabel);

  const detailGroup = new THREE.Group();
  detailGroup.name = 'Xenobiology Globe · proximity-streamed interior detail';
  detailGroup.visible = false;
  group.add(detailGroup);
  const interiorWalkway = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.12, 46), foundationMaterial);
  interiorWalkway.position.set(trailApproachLocal.x * 1.2, 0.67, trailApproachLocal.z * 1.2);
  interiorWalkway.rotation.y = entranceYaw;
  detailGroup.add(interiorWalkway);

  const specimenSpecs = [
    { name: 'SPACE SNAKE · KEPLER-186F', type: 'snake', color: 0x55f2c3, accent: 0xb483ff, substrate: 0x174a3d },
    { name: 'MOON BUNNY · PROXIMA B', type: 'bunny', color: 0xb7dfff, accent: 0xff9ee5, substrate: 0x38444d },
    { name: 'NEBULA CAT · TRAPPIST-1E', type: 'cat', color: 0x9b79ff, accent: 0x78efff, substrate: 0x2f2348 },
    { name: 'VOID BEE · WASP-96B', type: 'bee', color: 0xf3c64f, accent: 0x8f6cff, substrate: 0x312740 },
    { name: 'CLOUD JELLY · K2-18B', type: 'jelly', color: 0x73dfff, accent: 0xff91df, substrate: 0x17394c },
    { name: 'CRYSTAL SNAIL · TOI-700D', type: 'snail', color: 0xb5ffeb, accent: 0x65a2ff, substrate: 0x263758 },
    { name: 'SOLAR BUTTERFLY · HD 189733B', type: 'butterfly', color: 0xff7edb, accent: 0x76f7ff, substrate: 0x352342 },
    { name: 'COMET TIGER · GLIESE 667CC', type: 'tiger', color: 0xff9d38, accent: 0x69f5ff, substrate: 0x3a281d },
  ];
  const creatureRuntimes = [];

  function createSpecimenCreature(spec, specimenIndex) {
    const creature = new THREE.Group();
    creature.name = spec.name;
    const bodyMaterial = stdMat(spec.color, {
      roughness: spec.type === 'jelly' ? 0.18 : 0.48,
      metalness: spec.type === 'cat' ? 0.22 : 0.08,
      emissive: spec.color,
      emissiveIntensity: 0.34,
      transparent: spec.type === 'jelly',
      opacity: spec.type === 'jelly' ? 0.72 : 1,
    });
    const accentMaterial = stdMat(spec.accent, {
      roughness: 0.32,
      emissive: spec.accent,
      emissiveIntensity: 0.72,
    });
    const darkMaterial = sharedSpecimenDarkMaterial;
    const wings = [];
    const segments = [];
    const ears = [];
    const tailSegments = [];
    let body;

    if (spec.type === 'jelly') {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), bodyMaterial);
      body.position.y = 1.18;
      body.scale.set(1, 0.78, 1);
      creature.add(body);
      for (let tentacleIndex = 0; tentacleIndex < 6; tentacleIndex++) {
        const angle = (tentacleIndex / 6) * Math.PI * 2;
        const tentacle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.9 + (tentacleIndex % 3) * 0.14, 6), accentMaterial);
        tentacle.position.set(Math.cos(angle) * 0.34, 0.52, Math.sin(angle) * 0.34);
        tentacle.rotation.z = Math.sin(angle) * 0.18;
        creature.add(tentacle);
      }
    } else if (spec.type === 'snake') {
      for (let segmentIndex = 0; segmentIndex < 9; segmentIndex++) {
        const progress = segmentIndex / 8;
        const radius = THREE.MathUtils.lerp(0.32, 0.13, progress);
        const segment = new THREE.Mesh(sharedGeometry.snakeSegment, bodyMaterial);
        segment.position.set(Math.sin(segmentIndex * 0.82) * 0.28, 0.72 + Math.sin(segmentIndex * 0.5) * 0.05, -0.75 + segmentIndex * 0.24);
        segment.scale.set(radius, radius, radius * 1.18);
        creature.add(segment);
        segments.push({
          mesh: segment,
          index: segmentIndex,
          baseX: segment.position.x,
          baseY: segment.position.y,
        });
      }
      body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), bodyMaterial);
      body.position.set(0, 0.82, -1.07);
      body.scale.set(1.12, 0.8, 1.28);
      creature.add(body);
      [-1, 1].forEach((side) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), accentMaterial);
        eye.position.set(side * 0.19, 0.91, -1.43);
        creature.add(eye);
      });
      for (let crestIndex = 0; crestIndex < 3; crestIndex++) {
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 5), accentMaterial);
        crest.position.set(0, 1.17 - crestIndex * 0.04, -1.0 + crestIndex * 0.23);
        creature.add(crest);
      }
    } else if (spec.type === 'bunny') {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), bodyMaterial);
      body.position.y = 0.84;
      body.scale.set(0.82, 1.02, 0.78);
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), bodyMaterial);
      head.position.set(0, 1.38, -0.4);
      creature.add(head);
      [-1, 1].forEach((side) => {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.58, 5, 10), bodyMaterial);
        ear.position.set(side * 0.19, 1.94, -0.36);
        ear.rotation.z = side * -0.12;
        creature.add(ear);
        ears.push({ mesh: ear, side, baseRotation: ear.rotation.z });
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), darkMaterial);
        eye.position.set(side * 0.17, 1.46, -0.76);
        creature.add(eye);
        const rearPaw = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), accentMaterial);
        rearPaw.position.set(side * 0.38, 0.45, 0.27);
        rearPaw.scale.set(1.35, 0.55, 1.7);
        creature.add(rearPaw);
      });
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), accentMaterial);
      nose.position.set(0, 1.34, -0.82);
      creature.add(nose);
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), accentMaterial);
      tail.position.set(0, 0.88, 0.54);
      creature.add(tail);
    } else if (spec.type === 'cat') {
      body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.68, 6, 14), bodyMaterial);
      body.position.set(0, 0.88, 0.04);
      body.rotation.x = Math.PI / 2;
      body.scale.set(0.9, 1, 0.82);
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), bodyMaterial);
      head.position.set(0, 1.27, -0.64);
      creature.add(head);
      [-1, 1].forEach((side) => {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.43, 4), accentMaterial);
        ear.position.set(side * 0.22, 1.69, -0.63);
        ear.rotation.y = Math.PI / 4;
        creature.add(ear);
        ears.push({ mesh: ear, side, baseRotation: ear.rotation.z });
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 8), accentMaterial);
        eye.position.set(side * 0.16, 1.34, -1.01);
        creature.add(eye);
        for (let legIndex = 0; legIndex < 2; legIndex++) {
          const paw = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.35, 4, 8), darkMaterial);
          paw.position.set(side * 0.28, 0.43, legIndex === 0 ? -0.32 : 0.34);
          creature.add(paw);
        }
      });
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 7, 18), accentMaterial);
      collar.position.set(0, 1.08, -0.56);
      collar.rotation.x = Math.PI / 2;
      creature.add(collar);
      for (let tailIndex = 0; tailIndex < 6; tailIndex++) {
        const tailRadius = 0.105 - tailIndex * 0.007;
        const tailPart = new THREE.Mesh(sharedGeometry.creatureTailSegment, bodyMaterial);
        tailPart.scale.setScalar(tailRadius);
        tailPart.position.set(0.08 + tailIndex * 0.09, 0.92 + tailIndex * 0.12, 0.72 + tailIndex * 0.13);
        creature.add(tailPart);
        tailSegments.push({
          mesh: tailPart,
          index: tailIndex,
          baseX: tailPart.position.x,
          baseY: tailPart.position.y,
        });
      }
    } else if (spec.type === 'butterfly') {
      body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.05, 5, 12), bodyMaterial);
      body.position.set(0, 1.12, 0);
      body.rotation.x = Math.PI / 2;
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), accentMaterial);
      head.position.set(0, 1.14, -0.72);
      creature.add(head);
      [-1, 1].forEach((side) => {
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.64, 6), accentMaterial);
        antenna.position.set(side * 0.12, 1.48, -0.88);
        antenna.rotation.z = side * -0.28;
        antenna.rotation.x = -0.42;
        creature.add(antenna);
        const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), accentMaterial);
        antennaTip.position.set(side * 0.22, 1.72, -1.1);
        creature.add(antennaTip);
        [-0.3, 0.3].forEach((wingZ, wingIndex) => {
          const wing = new THREE.Mesh(
            new THREE.SphereGeometry(0.72 - wingIndex * 0.12, 16, 10),
            new THREE.MeshPhysicalMaterial({
              color: wingIndex === 0 ? spec.color : spec.accent,
              emissive: wingIndex === 0 ? spec.color : spec.accent,
              emissiveIntensity: 0.78,
              transparent: true,
              opacity: 0.72,
              roughness: 0.18,
              transmission: 0.2,
              depthWrite: false,
            })
          );
          wing.position.set(side * (0.58 + wingIndex * 0.12), 1.16, wingZ);
          wing.scale.set(1.15, 0.12, 0.78);
          wing.rotation.z = side * 0.42;
          creature.add(wing);
          wings.push({ mesh: wing, side });
        });
      });
      for (let stripeIndex = 0; stripeIndex < 4; stripeIndex++) {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 6, 14), accentMaterial);
        stripe.position.set(0, 1.12, -0.34 + stripeIndex * 0.24);
        creature.add(stripe);
      }
    } else if (spec.type === 'tiger') {
      body = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.18, 6, 14), bodyMaterial);
      body.position.set(0, 1.05, 0.08);
      body.rotation.x = Math.PI / 2;
      body.scale.set(1, 1.18, 0.82);
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 12), bodyMaterial);
      head.position.set(0, 1.26, -0.92);
      head.scale.set(1, 0.92, 0.9);
      creature.add(head);
      [-1, 1].forEach((side) => {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.38, 4), accentMaterial);
        ear.position.set(side * 0.28, 1.68, -0.89);
        ear.rotation.y = Math.PI / 4;
        creature.add(ear);
        ears.push({ mesh: ear, side, baseRotation: ear.rotation.z });
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), accentMaterial);
        eye.position.set(side * 0.18, 1.34, -1.34);
        creature.add(eye);
        const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), sharedTigerCheekMaterial);
        cheek.position.set(side * 0.17, 1.14, -1.29);
        creature.add(cheek);
        [-0.38, 0.42].forEach((legZ) => {
          const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), bodyMaterial);
          leg.position.set(side * 0.35, 0.5, legZ);
          creature.add(leg);
        });
      });
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), darkMaterial);
      muzzle.position.set(0, 1.22, -1.43);
      creature.add(muzzle);
      [-0.5, -0.08, 0.34, 0.7].forEach((stripeZ) => {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.055, 6, 18), darkMaterial);
        stripe.position.set(0, 1.05, stripeZ);
        stripe.scale.set(1, 0.84, 1);
        creature.add(stripe);
      });
      for (let tailIndex = 0; tailIndex < 7; tailIndex++) {
        const tailRadius = 0.115 - tailIndex * 0.008;
        const tailPart = new THREE.Mesh(sharedGeometry.creatureTailSegment, tailIndex % 2 ? darkMaterial : bodyMaterial);
        tailPart.scale.setScalar(tailRadius);
        tailPart.position.set(0.08 + tailIndex * 0.12, 1.08 + tailIndex * 0.11, 1.02 + tailIndex * 0.1);
        creature.add(tailPart);
        tailSegments.push({
          mesh: tailPart,
          index: tailIndex,
          baseX: tailPart.position.x,
          baseY: tailPart.position.y,
        });
      }
    } else if (spec.type === 'bee') {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 18, 12), bodyMaterial);
      body.position.y = 0.86;
      body.scale.set(0.9, 0.7, 1.35);
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 10), accentMaterial);
      head.position.set(0, 0.98, -0.66);
      creature.add(head);
      [-1, 1].forEach((side) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), darkMaterial);
        eye.position.set(side * 0.17, head.position.y + 0.06, -0.91);
        creature.add(eye);
      });
      for (let legIndex = 0; legIndex < 6; legIndex++) {
        const side = legIndex % 2 === 0 ? -1 : 1;
        const row = Math.floor(legIndex / 2);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.72, 6), darkMaterial);
        leg.position.set(side * 0.47, 0.48, (row - 1) * 0.36);
        leg.rotation.z = side * 0.86;
        leg.rotation.x = (row - 1) * 0.28;
        creature.add(leg);
      }
      [-1, 1].forEach((side) => {
        const wing = new THREE.Mesh(
          new THREE.SphereGeometry(0.48, 12, 8),
          new THREE.MeshBasicMaterial({ color: spec.accent, transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false })
        );
        wing.position.set(side * 0.47, 1.05, 0.14);
        wing.scale.set(0.5, 0.12, 1.25);
        wing.rotation.z = side * 0.42;
        creature.add(wing);
        wings.push({ mesh: wing, side });
      });
      [-0.34, 0.05, 0.4].forEach((stripeZ) => {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.055, 6, 18), darkMaterial);
        stripe.position.set(0, 0.87, stripeZ);
        stripe.rotation.x = Math.PI / 2;
        stripe.scale.set(0.9, 1, 0.7);
        creature.add(stripe);
      });
    } else {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 12), bodyMaterial);
      body.position.set(0, 0.68, 0.12);
      body.scale.set(1.45, 0.42, 0.72);
      creature.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), bodyMaterial);
      head.position.set(0, 0.83, -0.78);
      creature.add(head);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 14), accentMaterial);
      shell.position.set(0, 1.12, 0.2);
      shell.scale.z = 0.48;
      creature.add(shell);
      [-1, 1].forEach((side) => {
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 6), bodyMaterial);
        stalk.position.set(side * 0.14, 1.11, -0.92);
        stalk.rotation.z = side * -0.18;
        creature.add(stalk);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), darkMaterial);
        eye.position.set(side * 0.18, 1.31, -0.96);
        creature.add(eye);
      });
    }

    creature.position.y = 0.68;
    const lowDetail = buildLowDetailProxy(creature, spec.name);
    return {
      group: creature,
      lowDetail,
      body,
      bodyBaseScaleY: body.scale.y,
      wings,
      segments,
      ears,
      tailSegments,
      baseY: creature.position.y,
      phase: specimenIndex * 1.37,
      type: spec.type,
    };
  }

  const habitatHall = new THREE.Group();
  habitatHall.rotation.y = entranceYaw;
  detailGroup.add(habitatHall);
  function makeMuseumPlaqueTexture(spec, exhibitNumber) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');
    const accentHex = `#${spec.accent.toString(16).padStart(6, '0')}`;
    const [speciesName, worldName = 'UNCLASSIFIED ORIGIN'] = spec.name.split(' · ');
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#08151b');
    gradient.addColorStop(1, '#142d35');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 7;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accentHex;
    ctx.font = '900 28px monospace';
    ctx.fillText(`EXHIBIT ${String(exhibitNumber).padStart(2, '0')} · LIVE SPECIMEN`, 38, 46, 690);
    ctx.fillStyle = '#f0ffff';
    ctx.font = '900 50px sans-serif';
    ctx.fillText(speciesName, 38, 112, 690);
    ctx.fillStyle = '#a8d8dc';
    ctx.font = '800 25px monospace';
    ctx.fillText(`ORIGIN · ${worldName}`, 38, 174, 690);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const habitatSlots = [
    { x: -10.1, z: 11.2 }, { x: 10.1, z: 11.2 },
    { x: -10.1, z: 4.5 }, { x: 10.1, z: 4.5 },
    { x: -10.1, z: -2.2 }, { x: 10.1, z: -2.2 },
    { x: -10.1, z: -8.9 }, { x: 10.1, z: -8.9 },
  ];
  const museumTitle = makeLabelSprite('WALK-THROUGH XENOBIOLOGY MUSEUM · LIVE SPECIMENS', '#d0fff5');
  museumTitle.position.set(0, 17.4, -20.8);
  museumTitle.scale.set(11.4, 0.96, 1);
  habitatHall.add(museumTitle);
  const habitatGlassMaterials = [0x9df8ff, 0xd5bdff].map((color) => new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity: 0.16,
    transmission: 0.32,
    thickness: 0.18,
    roughness: 0.08,
    metalness: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  const habitatGlassEdgesGeometry = new THREE.EdgesGeometry(sharedGeometry.habitatGlass);
  const highOnlyDetails = [];
  const lowHiddenDetails = [];
  specimenSpecs.forEach((spec, index) => {
    const slot = habitatSlots[index];
    const habitat = new THREE.Group();
    habitat.name = `Glass specimen square · ${spec.name}`;
    habitat.position.set(slot.x, 0, slot.z);
    habitatHall.add(habitat);
    const baseMaterial = stdMat(0x17242a, {
      metalness: 0.72,
      roughness: 0.42,
      emissive: spec.accent,
      emissiveIntensity: 0.28,
    });
    const base = new THREE.Mesh(sharedGeometry.habitatBase, baseMaterial);
    base.position.y = 0.52;
    habitat.add(base);
    const substrate = new THREE.Mesh(
      sharedGeometry.habitatSubstrate,
      stdMat(spec.substrate, { roughness: 0.94, emissive: spec.color, emissiveIntensity: 0.12 })
    );
    substrate.position.y = 0.88;
    habitat.add(substrate);
    const displayRing = new THREE.Mesh(
      sharedGeometry.habitatDisplayRing,
      new THREE.MeshBasicMaterial({ color: spec.accent, transparent: true, opacity: 0.68, side: THREE.DoubleSide, toneMapped: false })
    );
    displayRing.rotation.x = -Math.PI / 2;
    displayRing.position.y = 0.975;
    habitat.add(displayRing);
    lowHiddenDetails.push(displayRing);
    const glassMaterialIndex = index % habitatGlassMaterials.length;
    const glassCube = new THREE.Mesh(sharedGeometry.habitatGlass, habitatGlassMaterials[glassMaterialIndex]);
    glassCube.position.y = 3.12;
    glassCube.renderOrder = 3;
    habitat.add(glassCube);
    const glassEdges = new THREE.LineSegments(
      habitatGlassEdgesGeometry,
      new THREE.LineBasicMaterial({ color: spec.accent, transparent: true, opacity: 0.72, toneMapped: false })
    );
    glassEdges.position.y = 3.12;
    habitat.add(glassEdges);
    highOnlyDetails.push(glassEdges);
    const canopy = new THREE.Mesh(
      sharedGeometry.habitatCanopy,
      stdMat(spec.accent, { emissive: spec.accent, emissiveIntensity: 1.1, metalness: 0.72, roughness: 0.28 })
    );
    canopy.position.y = 5.34;
    habitat.add(canopy);
    for (let propIndex = 0; propIndex < 3; propIndex++) {
      const prop = new THREE.Mesh(
        index % 2 === 0
          ? new THREE.ConeGeometry(0.16 + propIndex * 0.04, 0.62 + propIndex * 0.16, 6)
          : new THREE.DodecahedronGeometry(0.2 + propIndex * 0.07, 0),
        stdMat(propIndex % 2 === 0 ? spec.accent : spec.color, {
          roughness: 0.58,
          emissive: spec.accent,
          emissiveIntensity: 0.26,
        })
      );
      prop.position.set(-1.1 + propIndex * 1.08, 1.08 + propIndex * 0.05, 1.05 - (propIndex % 2) * 2.05);
      habitat.add(prop);
      highOnlyDetails.push(prop);
    }
    const creatureRuntime = createSpecimenCreature(spec, index);
    creatureRuntime.group.scale.setScalar(1.18);
    habitat.add(creatureRuntime.group);
    creatureRuntimes.push(creatureRuntime);
    const label = makeLabelSprite(spec.name, index % 2 === 0 ? '#a6ffe8' : '#e2c5ff');
    label.position.set(0, 5.78, 0);
    label.scale.set(3.75, 0.52, 1);
    habitat.add(label);
    lowHiddenDetails.push(label);

    const aisleSide = slot.x < 0 ? 1 : -1;
    const plaqueBacking = new THREE.Mesh(
      sharedGeometry.habitatPlaqueBacking,
      stdMat(0x0c171b, { metalness: 0.82, roughness: 0.32, emissive: spec.accent, emissiveIntensity: 0.2 })
    );
    plaqueBacking.position.set(aisleSide * 2.46, 1.55, 0);
    habitat.add(plaqueBacking);
    const plaque = new THREE.Mesh(
      sharedGeometry.habitatPlaque,
      new THREE.MeshBasicMaterial({
        map: makeMuseumPlaqueTexture(spec, index + 1),
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    plaque.position.set(aisleSide * 2.53, 1.55, 0);
    plaque.rotation.y = aisleSide > 0 ? Math.PI / 2 : -Math.PI / 2;
    habitat.add(plaque);
  });

  const monkeyRoot = new THREE.Group();
  monkeyRoot.name = 'Orbit · free-roaming autonomous space monkey';
  monkeyRoot.position.set(0, 0.7, 12.8);
  habitatHall.add(monkeyRoot);
  const monkeyFur = stdMat(0x6b4aa8, {
    roughness: 0.72,
    emissive: 0x25163e,
    emissiveIntensity: 0.34,
  });
  const monkeySkin = stdMat(0x9cf4e3, {
    roughness: 0.48,
    emissive: 0x195c59,
    emissiveIntensity: 0.42,
  });
  const monkeySuit = stdMat(0xd5e8ee, {
    metalness: 0.66,
    roughness: 0.28,
    emissive: 0x163b4a,
    emissiveIntensity: 0.38,
  });
  const monkeyDark = stdMat(0x071116, { roughness: 0.62, metalness: 0.2 });
  const monkeyTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.72, 6, 12), monkeyFur);
  monkeyTorso.position.y = 1.34;
  monkeyTorso.scale.set(1, 1, 0.82);
  monkeyRoot.add(monkeyTorso);
  const monkeyBelly = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 10), monkeySkin);
  monkeyBelly.position.set(0, 1.34, -0.29);
  monkeyBelly.scale.set(0.82, 1.18, 0.36);
  monkeyRoot.add(monkeyBelly);
  const monkeyHead = new THREE.Mesh(new THREE.SphereGeometry(0.43, 18, 14), monkeyFur);
  monkeyHead.position.set(0, 2.12, -0.06);
  monkeyRoot.add(monkeyHead);
  const monkeyMuzzle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), monkeySkin);
  monkeyMuzzle.position.set(0, 2.02, -0.39);
  monkeyMuzzle.scale.set(1.15, 0.78, 0.72);
  monkeyRoot.add(monkeyMuzzle);
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 9), monkeySkin);
    ear.position.set(side * 0.4, 2.18, -0.02);
    ear.scale.x = 0.55;
    monkeyRoot.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 9, 7), monkeyDark);
    eye.position.set(side * 0.15, 2.2, -0.4);
    monkeyRoot.add(eye);
  });
  const monkeyNose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), monkeyDark);
  monkeyNose.position.set(0, 2.08, -0.59);
  monkeyRoot.add(monkeyNose);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.63, 22, 16),
    new THREE.MeshPhysicalMaterial({
      color: 0x9defff,
      emissive: 0x0b4655,
      emissiveIntensity: 0.32,
      transparent: true,
      opacity: 0.18,
      transmission: 0.46,
      roughness: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  helmet.position.set(0, 2.1, -0.02);
  helmet.renderOrder = 5;
  monkeyRoot.add(helmet);
  const helmetCollar = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.07, 7, 22), monkeySuit);
  helmetCollar.rotation.x = Math.PI / 2;
  helmetCollar.position.set(0, 1.69, -0.01);
  monkeyRoot.add(helmetCollar);
  const lifeSupportPack = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.82, 0.3), monkeySuit);
  lifeSupportPack.position.set(0, 1.35, 0.39);
  monkeyRoot.add(lifeSupportPack);

  const monkeyArms = [];
  const monkeyLegs = [];
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.42, 1.58, 0);
    monkeyRoot.add(armPivot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.66, 4, 8), monkeyFur);
    arm.position.y = -0.37;
    arm.rotation.z = side * -0.1;
    armPivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), monkeySkin);
    hand.position.set(side * 0.06, -0.78, -0.02);
    armPivot.add(hand);
    monkeyArms.push({ pivot: armPivot, side });

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.22, 0.92, 0);
    monkeyRoot.add(legPivot);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.52, 4, 8), monkeyFur);
    leg.position.y = -0.31;
    legPivot.add(leg);
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), monkeySuit);
    boot.position.set(0, -0.66, -0.1);
    boot.scale.set(0.9, 0.62, 1.45);
    legPivot.add(boot);
    monkeyLegs.push({ pivot: legPivot, side });
  });
  const monkeyTailSegments = [];
  const monkeyTailMeshes = [
    new THREE.InstancedMesh(sharedGeometry.monkeyTailSegment, monkeyFur, 10),
    new THREE.InstancedMesh(sharedGeometry.monkeyTailSegment, monkeySkin, 1),
  ];
  monkeyTailMeshes.forEach((instances, index) => {
    instances.name = `Orbit monkey tail · ${index === 0 ? 'fur' : 'tip'}`;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    monkeyRoot.add(instances);
  });
  const monkeyTailInstanceCounts = [0, 0];
  const monkeyTailDummy = new THREE.Object3D();
  for (let tailIndex = 0; tailIndex < 11; tailIndex++) {
    const tailRadius = 0.11 - tailIndex * 0.0045;
    const materialIndex = tailIndex === 10 ? 1 : 0;
    const instanceMesh = monkeyTailMeshes[materialIndex];
    const instanceIndex = monkeyTailInstanceCounts[materialIndex]++;
    const position = new THREE.Vector3(
      0.06 + Math.sin(tailIndex * 0.38) * (0.1 + tailIndex * 0.035),
      1.05 + tailIndex * 0.055,
      0.42 + tailIndex * 0.15
    );
    monkeyTailDummy.position.copy(position);
    monkeyTailDummy.scale.setScalar(tailRadius);
    monkeyTailDummy.updateMatrix();
    instanceMesh.setMatrixAt(instanceIndex, monkeyTailDummy.matrix);
    monkeyTailSegments.push({
      instanceMesh,
      instanceIndex,
      position,
      radius: tailRadius,
      index: tailIndex,
      baseX: position.x,
      baseY: position.y,
    });
  }
  monkeyTailMeshes.forEach((instances) => { instances.instanceMatrix.needsUpdate = true; });
  const monkeyLowDetail = buildLowDetailProxy(monkeyRoot, 'Orbit space monkey');
  const museumMonkey = {
    root: monkeyRoot,
    lowDetail: monkeyLowDetail,
    torso: monkeyTorso,
    head: monkeyHead,
    arms: monkeyArms,
    legs: monkeyLegs,
    tailSegments: monkeyTailSegments,
    tailMeshes: monkeyTailMeshes,
    tailDummy: monkeyTailDummy,
    waypoints: [
      new THREE.Vector3(0, 0.7, 12.8),
      new THREE.Vector3(-3.4, 0.7, 7.2),
      new THREE.Vector3(3.2, 0.7, 1.2),
      new THREE.Vector3(-3.1, 0.7, -5.4),
      new THREE.Vector3(2.8, 0.7, -12.2),
      new THREE.Vector3(0.4, 0.7, -3.4),
    ],
    waypointIndex: 1,
    pause: 0,
    speed: 1.35,
    phase: 1.7,
    toWaypoint: new THREE.Vector3(),
  };

  // Turn the globe's entire perimeter into one continuous aquarium habitat.
  // The only break in the water wall is the entrance portal, so the central
  // museum aisle and every specimen case remain fully walkable.
  const aquariumWall = new THREE.Group();
  aquariumWall.name = 'Xenobiology museum · 360 degree living aquarium walls';
  habitatHall.add(aquariumWall);
  const aquariumWallInnerRadius = 20.25;
  const aquariumWallDepth = 3.35;
  const aquariumWallCenterRadius = aquariumWallInnerRadius + aquariumWallDepth * 0.5;
  const aquariumWallHeight = 13.2;
  const aquariumWallCenterY = 7.25;
  const aquariumWallOpeningHalfAngle = 0.46;
  const aquariumWallSegmentCount = isTouchDevice ? 14 : 18;
  const aquariumWallSegmentAngle = (Math.PI * 2) / aquariumWallSegmentCount;
  const aquariumWallSegmentWidth = 2 * aquariumWallCenterRadius * Math.tan(aquariumWallSegmentAngle * 0.49);
  const aquariumWallAngles = [];
  for (let index = 0; index < aquariumWallSegmentCount; index++) {
    const angle = -Math.PI + aquariumWallSegmentAngle * (index + 0.5);
    if (Math.abs(angle) > aquariumWallOpeningHalfAngle) aquariumWallAngles.push(angle);
  }

  const aquariumWallWaterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x178cae,
    emissive: 0x063d59,
    emissiveIntensity: 0.58,
    transparent: true,
    opacity: 0.3,
    transmission: 0.3,
    thickness: 1.1,
    roughness: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const aquariumWallGlassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xa6f8ff,
    emissive: 0x0d5d70,
    emissiveIntensity: 0.36,
    transparent: true,
    opacity: 0.2,
    transmission: 0.5,
    thickness: 0.26,
    roughness: 0.06,
    metalness: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const aquariumWallFrameMaterial = stdMat(0x4fd9e8, {
    metalness: 0.84,
    roughness: 0.23,
    emissive: 0x159db4,
    emissiveIntensity: 0.76,
  });
  const aquariumWallWater = new THREE.InstancedMesh(
    new THREE.BoxGeometry(aquariumWallSegmentWidth, aquariumWallHeight, aquariumWallDepth),
    aquariumWallWaterMaterial,
    aquariumWallAngles.length
  );
  aquariumWallWater.name = 'Continuous segmented alien-ocean water wall';
  aquariumWallWater.renderOrder = 1;
  const aquariumWallGlass = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(aquariumWallSegmentWidth * 0.985, aquariumWallHeight * 0.985),
    aquariumWallGlassMaterial,
    aquariumWallAngles.length
  );
  aquariumWallGlass.name = 'Continuous curved aquarium viewing glass';
  aquariumWallGlass.renderOrder = 4;
  const aquariumWallRails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(aquariumWallSegmentWidth + 0.24, 0.24, 0.28),
    aquariumWallFrameMaterial,
    aquariumWallAngles.length * 2
  );
  aquariumWallRails.name = 'Aquarium wall upper and lower pressure rails';
  const aquariumWallDummy = new THREE.Object3D();
  aquariumWallAngles.forEach((angle, index) => {
    aquariumWallDummy.position.set(
      Math.sin(angle) * aquariumWallCenterRadius,
      aquariumWallCenterY,
      Math.cos(angle) * aquariumWallCenterRadius
    );
    aquariumWallDummy.rotation.set(0, angle, 0);
    aquariumWallDummy.scale.set(1, 1, 1);
    aquariumWallDummy.updateMatrix();
    aquariumWallWater.setMatrixAt(index, aquariumWallDummy.matrix);

    aquariumWallDummy.position.set(
      Math.sin(angle) * (aquariumWallInnerRadius - 0.03),
      aquariumWallCenterY,
      Math.cos(angle) * (aquariumWallInnerRadius - 0.03)
    );
    aquariumWallDummy.rotation.set(0, angle + Math.PI, 0);
    aquariumWallDummy.updateMatrix();
    aquariumWallGlass.setMatrixAt(index, aquariumWallDummy.matrix);

    [0.76, aquariumWallCenterY + aquariumWallHeight * 0.5].forEach((railY, railIndex) => {
      aquariumWallDummy.position.set(
        Math.sin(angle) * (aquariumWallInnerRadius - 0.12),
        railY,
        Math.cos(angle) * (aquariumWallInnerRadius - 0.12)
      );
      aquariumWallDummy.rotation.set(0, angle, 0);
      aquariumWallDummy.updateMatrix();
      aquariumWallRails.setMatrixAt(index * 2 + railIndex, aquariumWallDummy.matrix);
    });
  });
  aquariumWallWater.instanceMatrix.needsUpdate = true;
  aquariumWallGlass.instanceMatrix.needsUpdate = true;
  aquariumWallRails.instanceMatrix.needsUpdate = true;
  aquariumWall.add(aquariumWallWater, aquariumWallGlass, aquariumWallRails);

  const aquariumWallPosts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, aquariumWallHeight + 0.45, 0.34),
    aquariumWallFrameMaterial,
    aquariumWallAngles.length + 1
  );
  aquariumWallPosts.name = 'Aquarium wall vertical pressure mullions';
  const aquariumWallBoundaries = aquariumWallAngles.map((angle) => angle - aquariumWallSegmentAngle * 0.5);
  aquariumWallBoundaries.push(aquariumWallAngles[aquariumWallAngles.length - 1] + aquariumWallSegmentAngle * 0.5);
  aquariumWallBoundaries.forEach((angle, index) => {
    aquariumWallDummy.position.set(
      Math.sin(angle) * (aquariumWallInnerRadius - 0.12),
      aquariumWallCenterY,
      Math.cos(angle) * (aquariumWallInnerRadius - 0.12)
    );
    aquariumWallDummy.rotation.set(0, angle, 0);
    aquariumWallDummy.updateMatrix();
    aquariumWallPosts.setMatrixAt(index, aquariumWallDummy.matrix);
  });
  aquariumWallPosts.instanceMatrix.needsUpdate = true;
  aquariumWall.add(aquariumWallPosts);

  const aquariumKelpMaterial = stdMat(0x49f3a5, {
    roughness: 0.48,
    emissive: 0x117759,
    emissiveIntensity: 0.72,
  });
  const aquariumWallKelpCount = isTouchDevice ? 24 : 38;
  const aquariumWallKelp = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.23, 2.8, 7),
    aquariumKelpMaterial,
    aquariumWallKelpCount
  );
  aquariumWallKelp.name = 'Bioluminescent kelp around museum aquarium walls';
  for (let index = 0; index < aquariumWallKelpCount; index++) {
    let angle = -Math.PI + ((index * 2.399963) % (Math.PI * 2));
    if (Math.abs(angle) < aquariumWallOpeningHalfAngle + 0.08) {
      angle += angle < 0 ? -0.72 : 0.72;
    }
    const heightScale = 0.72 + (index % 7) * 0.09;
    const radius = aquariumWallInnerRadius + 1.1 + (index % 4) * 0.42;
    aquariumWallDummy.position.set(Math.sin(angle) * radius, 0.92 + heightScale, Math.cos(angle) * radius);
    aquariumWallDummy.rotation.set(0, angle + Math.sin(index * 1.73) * 0.36, Math.sin(index * 2.1) * 0.11);
    aquariumWallDummy.scale.set(0.75 + (index % 3) * 0.16, heightScale, 0.75 + ((index + 1) % 3) * 0.12);
    aquariumWallDummy.updateMatrix();
    aquariumWallKelp.setMatrixAt(index, aquariumWallDummy.matrix);
  }
  aquariumWallKelp.instanceMatrix.needsUpdate = true;
  aquariumWall.add(aquariumWallKelp);
  highOnlyDetails.push(aquariumWallKelp);

  const aquariumWallFishMaterials = [
    [0xff6bcf, 0x74f7ff],
    [0x76ff92, 0xffd45e],
    [0xff9855, 0x9e7cff],
    [0x68a8ff, 0xffef88],
  ].map(([bodyColor, finColor]) => ({
    body: stdMat(bodyColor, { emissive: bodyColor, emissiveIntensity: 0.62, roughness: 0.3 }),
    fin: stdMat(finColor, { emissive: finColor, emissiveIntensity: 0.84, roughness: 0.24 }),
  }));
  const aquariumWallFishAngles = [-2.88, -2.46, -2.02, -1.57, -1.12, -0.68, 0.68, 1.12, 1.57, 2.02, 2.46, 2.88];
  const aquariumWallFishRuntimes = aquariumWallFishAngles.map((baseAngle, index) => {
    const materials = aquariumWallFishMaterials[index % aquariumWallFishMaterials.length];
    const fish = new THREE.Group();
    fish.name = `Perimeter aquarium alien fish ${index + 1}`;
    const body = new THREE.Mesh(sharedGeometry.wallFishBody, materials.body);
    body.scale.set(1.38, 0.66, 0.62);
    fish.add(body);
    const tail = new THREE.Mesh(sharedGeometry.wallFishTail, materials.fin);
    tail.position.x = -0.72;
    tail.rotation.z = -Math.PI / 2;
    fish.add(tail);
    const dorsal = new THREE.Mesh(sharedGeometry.wallFishDorsal, materials.fin);
    dorsal.position.set(-0.03, 0.41, 0);
    fish.add(dorsal);
    aquariumWall.add(fish);
    const lowDetail = buildLowDetailProxy(fish, `Perimeter aquarium fish ${index + 1}`);
    return {
      fish,
      tail,
      lowDetail,
      baseAngle,
      baseY: 3.1 + (index % 5) * 1.9,
      radius: aquariumWallInnerRadius + 1.1 + (index % 3) * 0.56,
      sweep: 0.18 + (index % 3) * 0.035,
      speed: 0.32 + (index % 4) * 0.065,
      phase: index * 0.91,
    };
  });

  const aquariumWallBubbleCount = isTouchDevice ? 90 : 156;
  const aquariumWallBubblePositions = new Float32Array(aquariumWallBubbleCount * 3);
  for (let index = 0; index < aquariumWallBubbleCount; index++) {
    let angle = -Math.PI + ((index * 2.399963) % (Math.PI * 2));
    if (Math.abs(angle) < aquariumWallOpeningHalfAngle) angle += angle < 0 ? -0.78 : 0.78;
    const radius = aquariumWallInnerRadius + 0.55 + (index % 11) / 10 * (aquariumWallDepth - 0.9);
    aquariumWallBubblePositions[index * 3] = Math.sin(angle) * radius;
    aquariumWallBubblePositions[index * 3 + 1] = 1.25 + ((index * 37) % 101) / 100 * 11.3;
    aquariumWallBubblePositions[index * 3 + 2] = Math.cos(angle) * radius;
  }
  const aquariumWallBubbleGeometry = new THREE.BufferGeometry();
  aquariumWallBubbleGeometry.setAttribute('position', new THREE.BufferAttribute(aquariumWallBubblePositions, 3));
  const aquariumWallBubbleMaterial = new THREE.PointsMaterial({
    color: 0xc9fbff,
    size: isTouchDevice ? 0.15 : 0.11,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const aquariumWallBubbles = new THREE.Points(aquariumWallBubbleGeometry, aquariumWallBubbleMaterial);
  aquariumWallBubbles.name = 'Bubbles throughout continuous museum aquarium wall';
  aquariumWall.add(aquariumWallBubbles);
  lowHiddenDetails.push(aquariumWallBubbles);
  const aquariumWallLabel = makeLabelSprite('360° ALIEN OCEAN WALL · EUROPA BIOSPHERE', '#94ffff');
  aquariumWallLabel.position.set(0, 15.15, -20.1);
  aquariumWallLabel.scale.set(9.2, 0.82, 1);
  aquariumWall.add(aquariumWallLabel);

  const aquarium = new THREE.Group();
  aquarium.name = 'Panoramic Europa alien ocean wall';
  aquarium.position.set(0, 0, -20.4);
  habitatHall.add(aquarium);
  const aquariumWidth = 23.2;
  const aquariumHeight = 11.8;
  const aquariumDepth = 3.1;
  const aquariumCenterY = 6.75;
  const aquariumPedestal = new THREE.Mesh(
    new THREE.BoxGeometry(aquariumWidth + 1.1, 0.82, aquariumDepth + 0.85),
    stdMat(0x10252d, { metalness: 0.78, roughness: 0.34, emissive: 0x0d7181, emissiveIntensity: 0.46 })
  );
  aquariumPedestal.position.y = 0.42;
  aquarium.add(aquariumPedestal);
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x24b8d4,
    emissive: 0x063e54,
    emissiveIntensity: 0.52,
    transparent: true,
    opacity: 0.3,
    transmission: 0.38,
    roughness: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const aquariumWater = new THREE.Mesh(
    new THREE.BoxGeometry(aquariumWidth - 0.45, aquariumHeight - 0.45, aquariumDepth - 0.4),
    waterMaterial
  );
  aquariumWater.position.y = aquariumCenterY;
  aquariumWater.renderOrder = 2;
  aquarium.add(aquariumWater);
  const tankGlassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xa5f7ff,
    emissive: 0x0b4c5c,
    emissiveIntensity: 0.34,
    transparent: true,
    opacity: 0.18,
    transmission: 0.54,
    thickness: 0.3,
    roughness: 0.06,
    metalness: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const aquariumGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(aquariumWidth, aquariumHeight),
    tankGlassMaterial
  );
  aquariumGlass.position.set(0, aquariumCenterY, aquariumDepth * 0.5 + 0.04);
  aquariumGlass.renderOrder = 4;
  aquarium.add(aquariumGlass);
  const aquariumEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(aquariumWidth, aquariumHeight, aquariumDepth)),
    new THREE.LineBasicMaterial({ color: 0x62f4ff, transparent: true, opacity: 0.88, toneMapped: false })
  );
  aquariumEdges.position.y = aquariumCenterY;
  aquarium.add(aquariumEdges);
  const aquariumFrameSpecs = [
    { size: [aquariumWidth + 0.55, 0.3, 0.34], position: [0, aquariumCenterY - aquariumHeight * 0.5, aquariumDepth * 0.5 + 0.08] },
    { size: [aquariumWidth + 0.55, 0.3, 0.34], position: [0, aquariumCenterY + aquariumHeight * 0.5, aquariumDepth * 0.5 + 0.08] },
    { size: [0.3, aquariumHeight, 0.34], position: [-aquariumWidth * 0.5, aquariumCenterY, aquariumDepth * 0.5 + 0.08] },
    { size: [0.3, aquariumHeight, 0.34], position: [aquariumWidth * 0.5, aquariumCenterY, aquariumDepth * 0.5 + 0.08] },
  ];
  const aquariumFrameBars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    stdMat(0x55dce9, { metalness: 0.82, roughness: 0.22, emissive: 0x21c8dc, emissiveIntensity: 0.85 }),
    aquariumFrameSpecs.length
  );
  aquariumFrameBars.name = 'Panoramic aquarium pressure frame';
  const aquariumFrameDummy = new THREE.Object3D();
  aquariumFrameSpecs.forEach((bar, index) => {
    aquariumFrameDummy.position.set(...bar.position);
    aquariumFrameDummy.scale.set(...bar.size);
    aquariumFrameDummy.updateMatrix();
    aquariumFrameBars.setMatrixAt(index, aquariumFrameDummy.matrix);
  });
  aquariumFrameBars.instanceMatrix.needsUpdate = true;
  aquarium.add(aquariumFrameBars);

  const aquariumKelpMaterials = [
    stdMat(0x8b75ff, { emissive: 0x39247d, emissiveIntensity: 0.7, roughness: 0.48 }),
    stdMat(0x36ffb0, { emissive: 0x0f7f5b, emissiveIntensity: 0.7, roughness: 0.48 }),
  ];
  const aquariumKelpMeshes = aquariumKelpMaterials.map((material, index) => {
    const instances = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), material, index === 0 ? 6 : 5);
    instances.name = `Panoramic aquarium kelp · ${index === 0 ? 'violet' : 'green'}`;
    aquarium.add(instances);
    highOnlyDetails.push(instances);
    return instances;
  });
  const aquariumKelpInstanceCounts = [0, 0];
  const aquariumKelpDummy = new THREE.Object3D();
  for (let propIndex = 0; propIndex < 11; propIndex++) {
    const materialIndex = propIndex % 2;
    const kelpRadius = 0.16 + (propIndex % 3) * 0.06;
    const kelpHeight = 1.9 + (propIndex % 4) * 0.55;
    aquariumKelpDummy.position.set(-9.7 + propIndex * 1.92, 1.45 + (propIndex % 4) * 0.28, 0.15 + (propIndex % 3) * 0.3);
    aquariumKelpDummy.rotation.z = Math.sin(propIndex * 1.7) * 0.18;
    aquariumKelpDummy.scale.set(kelpRadius, kelpHeight, kelpRadius);
    aquariumKelpDummy.updateMatrix();
    aquariumKelpMeshes[materialIndex].setMatrixAt(
      aquariumKelpInstanceCounts[materialIndex]++,
      aquariumKelpDummy.matrix
    );
  }
  aquariumKelpMeshes.forEach((instances) => { instances.instanceMatrix.needsUpdate = true; });

  const fishSpecs = [
    { color: 0xff6bd6, accent: 0x71f7ff, x: -6.8, height: 1.3, speed: 0.48, range: 8.4, phase: 0.2 },
    { color: 0x8dff70, accent: 0xffd86c, x: 4.2, height: -1.65, speed: 0.38, range: 9.2, phase: 1.7 },
    { color: 0xff9b55, accent: 0x9b7cff, x: 0.8, height: 2.8, speed: 0.56, range: 7.8, phase: 3.1 },
    { color: 0x61a5ff, accent: 0xfff28a, x: -2.7, height: -0.1, speed: 0.44, range: 9.6, phase: 4.4 },
    { color: 0xff5c72, accent: 0x7dffd8, x: 7.4, height: 0.55, speed: 0.62, range: 8.7, phase: 5.3 },
  ];
  const aquariumFishEyeMaterial = stdMat(0x061015, { roughness: 0.5 });
  const fishRuntimes = fishSpecs.map((fishSpec, fishIndex) => {
    const fish = new THREE.Group();
    fish.position.set(fishSpec.x, aquariumCenterY + fishSpec.height, 0.55 - (fishIndex % 3) * 0.52);
    aquarium.add(fish);
    const fishMaterial = stdMat(fishSpec.color, { emissive: fishSpec.color, emissiveIntensity: 0.58, roughness: 0.3 });
    const finMaterial = stdMat(fishSpec.accent, { emissive: fishSpec.accent, emissiveIntensity: 0.82, roughness: 0.24 });
    const body = new THREE.Mesh(sharedGeometry.aquariumFishBody, fishMaterial);
    body.scale.set(1.32, 0.66, 0.62);
    fish.add(body);
    const tail = new THREE.Mesh(sharedGeometry.aquariumFishTail, finMaterial);
    tail.position.x = -0.78;
    tail.rotation.z = -Math.PI / 2;
    fish.add(tail);
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(sharedGeometry.aquariumFishEye, aquariumFishEyeMaterial);
      eye.position.set(0.48, 0.12, side * 0.23);
      fish.add(eye);
      const fin = new THREE.Mesh(sharedGeometry.aquariumFishFin, finMaterial);
      fin.position.set(-0.05, -0.05, side * 0.37);
      fin.rotation.x = side * Math.PI / 2;
      fish.add(fin);
    });
    const crest = new THREE.Mesh(sharedGeometry.aquariumFishCrest, finMaterial);
    crest.position.set(-0.02, 0.46, 0);
    fish.add(crest);
    const lowDetail = buildLowDetailProxy(fish, `Panoramic aquarium fish ${fishIndex + 1}`);
    return {
      fish,
      tail,
      lowDetail,
      baseY: aquariumCenterY + fishSpec.height,
      baseZ: fish.position.z,
      range: fishSpec.range,
      speed: fishSpec.speed,
      phase: fishSpec.phase,
    };
  });

  const aquariumSquidRoot = new THREE.Group();
  aquariumSquidRoot.name = 'Europa abyssal space squid';
  aquariumSquidRoot.position.set(0, aquariumCenterY + 0.05, 0.62);
  aquariumSquidRoot.scale.setScalar(1.22);
  aquarium.add(aquariumSquidRoot);
  const squidMantleMaterial = new THREE.MeshStandardMaterial({
    color: 0x8538dc,
    emissive: 0x5212a6,
    emissiveIntensity: 1.05,
    roughness: 0.36,
    metalness: 0.08,
  });
  const squidAccentMaterial = stdMat(0x75fff0, {
    emissive: 0x22d8c7,
    emissiveIntensity: 1.05,
    roughness: 0.26,
  });
  const squidDarkMaterial = stdMat(0x08101c, { roughness: 0.5, metalness: 0.18 });
  const squidMantle = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), squidMantleMaterial);
  squidMantle.position.y = 0.72;
  squidMantle.scale.set(0.84, 1.5, 0.76);
  aquariumSquidRoot.add(squidMantle);
  const squidHead = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), squidMantleMaterial);
  squidHead.position.y = -0.34;
  squidHead.scale.set(1.06, 0.78, 0.9);
  aquariumSquidRoot.add(squidHead);
  [-1, 1].forEach((side) => {
    const eyeSocket = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), squidAccentMaterial);
    eyeSocket.position.set(side * 0.3, -0.28, 0.52);
    aquariumSquidRoot.add(eyeSocket);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), squidDarkMaterial);
    pupil.position.set(side * 0.3, -0.27, 0.66);
    pupil.scale.y = 1.55;
    aquariumSquidRoot.add(pupil);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.88, 5), squidAccentMaterial);
    fin.position.set(side * 0.88, 0.82, 0);
    fin.rotation.z = side * -Math.PI / 2;
    aquariumSquidRoot.add(fin);
  });
  for (let spotIndex = 0; spotIndex < 9; spotIndex++) {
    const spotAngle = (spotIndex / 9) * Math.PI * 2;
    const glowSpot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), squidAccentMaterial);
    glowSpot.position.set(Math.cos(spotAngle) * 0.58, 0.75 + Math.sin(spotIndex * 1.7) * 0.56, Math.sin(spotAngle) * 0.5);
    aquariumSquidRoot.add(glowSpot);
  }
  const squidTentacleSegments = [];
  const squidTentacleMeshes = [
    new THREE.InstancedMesh(sharedGeometry.squidTentacleSegment, squidAccentMaterial, 24),
    new THREE.InstancedMesh(sharedGeometry.squidTentacleSegment, squidMantleMaterial, 24),
  ];
  squidTentacleMeshes.forEach((instances, index) => {
    instances.name = `Europa squid tentacles · ${index === 0 ? 'accent' : 'mantle'}`;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    aquariumSquidRoot.add(instances);
  });
  const squidTentacleInstanceCounts = [0, 0];
  const squidTentacleDummy = new THREE.Object3D();
  for (let tentacleIndex = 0; tentacleIndex < 8; tentacleIndex++) {
    const angle = (tentacleIndex / 8) * Math.PI * 2;
    for (let segmentIndex = 0; segmentIndex < 6; segmentIndex++) {
      const progress = segmentIndex / 5;
      const radius = 0.42 + progress * (0.62 + (tentacleIndex % 3) * 0.12);
      const segmentRadius = 0.105 - segmentIndex * 0.009;
      const materialIndex = tentacleIndex % 2 === 0 ? 0 : 1;
      const instanceMesh = squidTentacleMeshes[materialIndex];
      const instanceIndex = squidTentacleInstanceCounts[materialIndex]++;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        -0.78 - segmentIndex * 0.28,
        Math.sin(angle) * radius
      );
      squidTentacleDummy.position.copy(position);
      squidTentacleDummy.scale.setScalar(segmentRadius);
      squidTentacleDummy.updateMatrix();
      instanceMesh.setMatrixAt(instanceIndex, squidTentacleDummy.matrix);
      squidTentacleSegments.push({
        instanceMesh,
        instanceIndex,
        position,
        radius: segmentRadius,
        angle,
        tentacleIndex,
        segmentIndex,
        baseRadius: radius,
        baseY: position.y,
      });
    }
  }
  squidTentacleMeshes.forEach((instances) => { instances.instanceMatrix.needsUpdate = true; });
  const squidLowDetail = buildLowDetailProxy(aquariumSquidRoot, 'Europa abyssal space squid');
  const aquariumSquid = {
    root: aquariumSquidRoot,
    lowDetail: squidLowDetail,
    mantle: squidMantle,
    fins: aquariumSquidRoot.children.filter((child) => child.geometry?.type === 'ConeGeometry'),
    tentacleSegments: squidTentacleSegments,
    tentacleMeshes: squidTentacleMeshes,
    tentacleDummy: squidTentacleDummy,
    baseY: aquariumSquidRoot.position.y,
    phase: 2.4,
  };

  const bubbleCount = isTouchDevice ? 44 : 76;
  const bubblePositions = new Float32Array(bubbleCount * 3);
  for (let index = 0; index < bubbleCount; index++) {
    bubblePositions[index * 3] = -10.6 + ((index * 47) % 101) / 100 * 21.2;
    bubblePositions[index * 3 + 1] = aquariumCenterY - 5.1 + ((index * 37) % 97) / 96 * 10.2;
    bubblePositions[index * 3 + 2] = -1.15 + (index % 9) / 8 * 2.3;
  }
  const bubbleGeometry = new THREE.BufferGeometry();
  bubbleGeometry.setAttribute('position', new THREE.BufferAttribute(bubblePositions, 3));
  const bubbleMaterial = new THREE.PointsMaterial({
    color: 0xc8fbff,
    size: isTouchDevice ? 0.15 : 0.11,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const aquariumBubbles = new THREE.Points(bubbleGeometry, bubbleMaterial);
  aquarium.add(aquariumBubbles);
  lowHiddenDetails.push(aquariumBubbles);
  const aquariumSpec = { name: 'PANORAMIC ALIEN OCEAN · EUROPA DEEP', accent: 0x5af4ff };
  const aquariumPlaque = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.12),
    new THREE.MeshBasicMaterial({
      map: makeMuseumPlaqueTexture(aquariumSpec, 9),
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  aquariumPlaque.position.set(0, 1.25, aquariumDepth * 0.5 + 0.28);
  aquarium.add(aquariumPlaque);
  const aquariumLabel = makeLabelSprite('PANORAMIC ALIEN OCEAN · SPACE SQUID HABITAT', '#8cffff');
  aquariumLabel.position.set(0, 13.35, aquariumDepth * 0.5 + 0.16);
  aquariumLabel.scale.set(8.4, 0.78, 1);
  aquarium.add(aquariumLabel);

  const moteCount = isTouchDevice ? 70 : 120;
  const motePositions = new Float32Array(moteCount * 3);
  for (let index = 0; index < moteCount; index++) {
    const angle = index * 2.399963;
    const radius = 4.2 + (index % 22) * 0.67;
    motePositions[index * 3] = Math.cos(angle) * radius;
    motePositions[index * 3 + 1] = 5.5 + (index % 27) * 0.82;
    motePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({
    color: 0x8affd8,
    size: isTouchDevice ? 0.16 : 0.12,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const bioMotes = new THREE.Points(moteGeometry, moteMaterial);
  detailGroup.add(bioMotes);
  lowHiddenDetails.push(bioMotes);

  const cyanLight = new THREE.PointLight(0x70f4ff, 4.4, 52, 2);
  cyanLight.position.set(-14.2, 10.8, 0);
  detailGroup.add(cyanLight);
  const violetLight = new THREE.PointLight(0xc68aff, 3.8, 50, 2);
  violetLight.position.set(14.2, 9.8, -4.5);
  detailGroup.add(violetLight);
  const landmarkLabel = makeLabelSprite('ARES XENOBIOLOGY GLOBE · LIVING SPECIMENS', '#9effe7');
  landmarkLabel.position.set(0, 41.6, 0);
  landmarkLabel.scale.set(13.2, 1.52, 1);
  group.add(landmarkLabel);

  const qualitySensitiveMaterials = collectQualitySensitiveMaterials(group);

  return {
    group,
    detailGroup,
    habitatHall,
    globe,
    globeMaterial,
    globeRibs,
    creatureRuntimes,
    museumMonkey,
    aquariumWall,
    aquariumWallWater,
    aquariumWallWaterMaterial,
    aquariumWallFishRuntimes,
    aquariumWallBubbles,
    aquariumWallBubbleMaterial,
    fishRuntimes,
    aquariumSquid,
    aquariumWater,
    aquariumBubbles,
    bubbleMaterial,
    bioMotes,
    moteMaterial,
    cyanLight,
    violetLight,
    highOnlyDetails,
    lowHiddenDetails,
    qualitySensitiveMaterials,
  };
}

function buildCrashSite(hub) {
  const baseY = getTerrainHeight(hub.x, hub.z);
  const group = new THREE.Group();
  group.name = 'Ares III weather relay · crashed orbital satellite';
  placeSurfaceGroup(group, hub.normal);

  const charMaterial = stdMat(0x18191a, { metalness: 0.42, roughness: 0.88, flatShading: true });
  const frameMaterial = stdMat(0x687178, { metalness: 0.88, roughness: 0.28 });
  const aluminumMaterial = stdMat(0xaeb6b8, { metalness: 0.82, roughness: 0.34 });
  const goldFoilMaterial = stdMat(0xb77a22, {
    color: 0xb77a22,
    emissive: 0x3c1b03,
    emissiveIntensity: 0.2,
    metalness: 0.72,
    roughness: 0.46,
    flatShading: true,
  });
  const solarCellMaterial = stdMat(0x123a61, {
    emissive: 0x071a2c,
    emissiveIntensity: 0.34,
    metalness: 0.68,
    roughness: 0.28,
  });
  const solarGridMaterial = new THREE.MeshBasicMaterial({ color: 0x82b9d4, toneMapped: false });

  const impactScorch = new THREE.Mesh(
    new THREE.CircleGeometry(9.2, 64),
    new THREE.MeshBasicMaterial({ color: 0x210b07, transparent: true, opacity: 0.72, depthWrite: false })
  );
  impactScorch.rotation.x = -Math.PI / 2;
  impactScorch.scale.set(1.42, 0.58, 1);
  impactScorch.position.set(0.8, 0.025, 1.1);
  group.add(impactScorch);
  for (let trenchIndex = 0; trenchIndex < 7; trenchIndex++) {
    const trench = new THREE.Mesh(
      new THREE.CircleGeometry(2.6 + trenchIndex * 0.16, 32),
      new THREE.MeshBasicMaterial({
        color: trenchIndex % 2 ? 0x35120b : 0x250b07,
        transparent: true,
        opacity: 0.52 - trenchIndex * 0.035,
        depthWrite: false,
      })
    );
    trench.rotation.x = -Math.PI / 2;
    trench.rotation.z = -0.34;
    trench.scale.set(1.32, 0.34, 1);
    trench.position.set(3.8 + trenchIndex * 1.55, 0.035 + trenchIndex * 0.001, 2.1 + trenchIndex * 0.88);
    group.add(trench);
  }

  const wreck = new THREE.Group();
  wreck.name = 'MARS ORBITAL RELAY 7 · impact wreckage';
  wreck.position.set(-0.6, 0.58, 0.15);
  wreck.rotation.set(-0.1, -0.48, 0.17);
  group.add(wreck);

  const equipmentBus = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.5, 4.4), goldFoilMaterial);
  equipmentBus.position.y = 1.7;
  wreck.add(equipmentBus);
  const busCore = new THREE.Mesh(new THREE.BoxGeometry(3.12, 2.12, 4.68), charMaterial);
  busCore.position.set(0.18, 1.65, 0.18);
  wreck.add(busCore);
  [-1, 1].forEach((side) => {
    const equipmentBay = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.72, 2.9), aluminumMaterial);
    equipmentBay.position.set(side * 1.92, 1.72, -0.2);
    wreck.add(equipmentBay);
    for (let portIndex = 0; portIndex < 4; portIndex++) {
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.18, 10), charMaterial);
      port.rotation.z = Math.PI / 2;
      port.position.set(side * 2.08, 1.35 + (portIndex % 2) * 0.68, -0.9 + Math.floor(portIndex / 2) * 1.5);
      wreck.add(port);
    }
  });

  const frameBars = [
    [0, 3.03, -2.27, 3.95, 0.11, 0.11],
    [0, 3.03, 2.27, 3.95, 0.11, 0.11],
    [-1.86, 3.03, 0, 0.11, 0.11, 4.65],
    [1.86, 3.03, 0, 0.11, 0.11, 4.65],
  ];
  frameBars.forEach(([x, y, z, width, height, depth]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), frameMaterial);
    bar.position.set(x, y, z);
    wreck.add(bar);
  });

  const solarPanels = [];
  const solarPanelCount = 5;
  const solarPanelFrameGeometry = new THREE.BoxGeometry(2.55, 0.13, 2.1);
  const solarPanelCellGeometry = new THREE.BoxGeometry(2.39, 0.055, 1.94);
  const solarPanelVerticalGridGeometry = new THREE.BoxGeometry(0.025, 0.012, 1.94);
  const solarPanelHorizontalGridGeometry = new THREE.BoxGeometry(2.39, 0.012, 0.025);
  const solarArrayBounds = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 12);
  [solarPanelFrameGeometry, solarPanelCellGeometry, solarPanelVerticalGridGeometry, solarPanelHorizontalGridGeometry]
    .forEach((geometry) => { geometry.boundingSphere = solarArrayBounds.clone(); });
  const solarPanelFrames = new THREE.InstancedMesh(solarPanelFrameGeometry, frameMaterial, solarPanelCount);
  const solarPanelCells = new THREE.InstancedMesh(solarPanelCellGeometry, solarCellMaterial, solarPanelCount);
  const solarPanelVerticalGrid = new THREE.InstancedMesh(solarPanelVerticalGridGeometry, solarGridMaterial, solarPanelCount * 5);
  const solarPanelHorizontalGrid = new THREE.InstancedMesh(solarPanelHorizontalGridGeometry, solarGridMaterial, solarPanelCount * 3);
  solarPanelFrames.name = 'Crashed satellite · batched solar panel frames';
  solarPanelCells.name = 'Crashed satellite · batched photovoltaic cells';
  solarPanelVerticalGrid.name = 'Crashed satellite · batched vertical cell grid';
  solarPanelHorizontalGrid.name = 'Crashed satellite · batched horizontal cell grid';
  const solarPanelMatrix = new THREE.Matrix4();
  const solarInstanceMatrix = new THREE.Matrix4();
  const solarComponentTransform = new THREE.Object3D();
  let solarPanelIndex = 0;
  let solarVerticalGridIndex = 0;
  let solarHorizontalGridIndex = 0;
  function buildSolarWing(side) {
    const wing = new THREE.Group();
    wing.position.set(side * 2.15, 1.62, 0.2);
    wing.rotation.z = side < 0 ? -0.08 : 0.16;
    wing.rotation.y = side < 0 ? -0.03 : 0.12;
    wing.updateMatrix();
    wreck.add(wing);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 0.18), frameMaterial);
    boom.position.x = side * 1.05;
    wing.add(boom);
    for (let segment = 0; segment < 3; segment++) {
      if (side > 0 && segment === 2) continue;
      const panelRig = new THREE.Group();
      panelRig.position.set(side * (2.55 + segment * 2.68), side > 0 && segment === 1 ? -0.36 : 0, segment * 0.12);
      panelRig.rotation.z = side > 0 && segment === 1 ? -0.24 : Math.sin(segment * 1.9) * 0.025;
      panelRig.rotation.y = side > 0 && segment === 1 ? 0.16 : 0;
      panelRig.updateMatrix();
      wing.add(panelRig);
      solarPanelMatrix.multiplyMatrices(wing.matrix, panelRig.matrix);
      solarPanelFrames.setMatrixAt(solarPanelIndex, solarPanelMatrix);

      solarComponentTransform.position.set(0, 0.095, 0);
      solarComponentTransform.updateMatrix();
      solarInstanceMatrix.multiplyMatrices(solarPanelMatrix, solarComponentTransform.matrix);
      solarPanelCells.setMatrixAt(solarPanelIndex, solarInstanceMatrix);

      for (let gridIndex = -2; gridIndex <= 2; gridIndex++) {
        solarComponentTransform.position.set(gridIndex * 0.39, 0.13, 0);
        solarComponentTransform.updateMatrix();
        solarInstanceMatrix.multiplyMatrices(solarPanelMatrix, solarComponentTransform.matrix);
        solarPanelVerticalGrid.setMatrixAt(solarVerticalGridIndex++, solarInstanceMatrix);
      }
      [-0.48, 0, 0.48].forEach((z) => {
        solarComponentTransform.position.set(0, 0.132, z);
        solarComponentTransform.updateMatrix();
        solarInstanceMatrix.multiplyMatrices(solarPanelMatrix, solarComponentTransform.matrix);
        solarPanelHorizontalGrid.setMatrixAt(solarHorizontalGridIndex++, solarInstanceMatrix);
      });
      panelRig.userData.solarInstanceIndex = solarPanelIndex;
      solarPanelIndex += 1;
      solarPanels.push(panelRig);
    }
  }
  buildSolarWing(-1);
  buildSolarWing(1);
  [solarPanelFrames, solarPanelCells, solarPanelVerticalGrid, solarPanelHorizontalGrid].forEach((batch) => {
    batch.instanceMatrix.needsUpdate = true;
    batch.frustumCulled = true;
    wreck.add(batch);
  });

  const dishRig = new THREE.Group();
  dishRig.position.set(-0.35, 3.45, -2.2);
  dishRig.rotation.set(0.32, -0.2, -0.22);
  wreck.add(dishRig);
  const dish = new THREE.Mesh(
    new THREE.ConeGeometry(1.42, 0.56, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc9d0d2, metalness: 0.78, roughness: 0.32, side: THREE.DoubleSide })
  );
  dish.rotation.x = Math.PI / 2;
  dishRig.add(dish);
  const feedBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 1.55, 8), frameMaterial);
  feedBoom.rotation.x = Math.PI / 2;
  feedBoom.position.z = -0.62;
  dishRig.add(feedBoom);
  const receiver = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.34, 12), charMaterial);
  receiver.rotation.x = Math.PI / 2;
  receiver.position.z = -1.42;
  dishRig.add(receiver);

  const exposedBay = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.45, 0.16), charMaterial);
  exposedBay.position.set(0.2, 1.68, 2.48);
  exposedBay.rotation.x = -0.08;
  wreck.add(exposedBay);
  const wireColors = [0xff5a3c, 0xffd25c, 0x5ecbff, 0xd88cff];
  wireColors.forEach((color, wireIndex) => {
    const wireCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.8 + wireIndex * 0.52, 2.18, 2.58),
      new THREE.Vector3(-1 + wireIndex * 0.58, 1.55 - wireIndex * 0.08, 3.05),
      new THREE.Vector3(-0.55 + wireIndex * 0.42, 0.82 + wireIndex * 0.11, 3.35),
    ]);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(wireCurve, 9, 0.035, 6, false),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    wreck.add(wire);
  });

  const telemetryMaterial = new THREE.MeshStandardMaterial({
    color: 0x071b13,
    emissive: 0x39ff9a,
    emissiveIntensity: 1.4,
    roughness: 0.22,
    toneMapped: false,
  });
  const telemetry = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.62), telemetryMaterial);
  telemetry.position.set(-0.65, 1.78, 2.59);
  wreck.add(telemetry);
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3b28,
    emissive: 0xff2f20,
    emissiveIntensity: 2.6,
    roughness: 0.2,
    toneMapped: false,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), beaconMaterial);
  beacon.position.set(1.45, 3.24, 1.72);
  wreck.add(beacon);

  const detachedPanel = new THREE.Group();
  detachedPanel.position.set(7.4, 0.42, 4.2);
  detachedPanel.rotation.set(-0.18, 0.7, -0.12);
  group.add(detachedPanel);
  const detachedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.13, 2.08), frameMaterial);
  detachedPanel.add(detachedFrame);
  const detachedCells = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.055, 1.92), solarCellMaterial);
  detachedCells.position.y = 0.095;
  detachedPanel.add(detachedCells);

  for (let debrisIndex = 0; debrisIndex < 14; debrisIndex++) {
    const angle = debrisIndex * 2.17 + 0.4;
    const distance = 6.2 + (debrisIndex % 6) * 1.28;
    const dx = Math.cos(angle) * distance + 1.2;
    const dz = Math.sin(angle) * distance + 1.1;
    const shardMaterial = debrisIndex % 3 === 0 ? goldFoilMaterial : debrisIndex % 3 === 1 ? frameMaterial : charMaterial;
    const geometry = debrisIndex % 4 === 0
      ? new THREE.BoxGeometry(1.15, 0.1, 0.62)
      : new THREE.ConeGeometry(0.28 + (debrisIndex % 3) * 0.11, 0.9 + (debrisIndex % 2) * 0.42, 3);
    const debris = new THREE.Mesh(geometry, shardMaterial);
    debris.position.set(dx, getTerrainHeight(hub.x + dx, hub.z + dz) - baseY + 0.24, dz);
    debris.rotation.set(angle * 0.31, angle, angle * 0.47);
    group.add(debris);
    if (debrisIndex < 4) addCollider(hub.x + dx, hub.z + dz, 0.55);
  }

  const label = makeLabelSprite('CRASHED ORBITAL SATELLITE · ARES III WEATHER RELAY', '#ffe0b8');
  label.position.set(0, 7.4, -0.3);
  label.scale.set(9.5, 1.15, 1);
  group.add(label);
  addCollider(hub.x, hub.z, 6.5);

  const light = new THREE.PointLight(0xff4c30, 2.5, 26, 2);
  light.position.set(0.8, 3.1, 2.3);
  group.add(light);

  const smokeCount = 40;
  const positions = new Float32Array(smokeCount * 3);
  const bases = new Float32Array(smokeCount * 3);
  const speeds = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) {
    const x = 0.8 + (Math.random() - 0.5) * 2.2;
    const z = 2.45 + (Math.random() - 0.5) * 1.8;
    const y = 2.2 + Math.random() * 4.2;
    positions[i * 3] = bases[i * 3] = x;
    positions[i * 3 + 1] = bases[i * 3 + 1] = y;
    positions[i * 3 + 2] = bases[i * 3 + 2] = z;
    speeds[i] = 0.6 + Math.random() * 0.8;
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const smokeMat = new THREE.PointsMaterial({ map: dustTexture, color: 0x675b54, size: 1.05, transparent: true, opacity: 0.32, depthWrite: false });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  group.add(smoke);

  return {
    group, wreck, light, smoke, smokeBases: bases, smokeSpeeds: speeds,
    beaconMaterial, telemetryMaterial, solarCellMaterial, solarPanels, detachedPanel,
  };
}

function createCaveRibbonGeometry(curve, width, segments, lift = 0) {
  const vertices = [];
  const uvs = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  for (let index = 0; index <= segments; index++) {
    const ratio = index / segments;
    const point = curve.getPointAt(ratio);
    tangent.copy(curve.getTangentAt(ratio)).normalize();
    right.crossVectors(tangent, UP).normalize();
    [-1, 1].forEach((side) => {
      vertices.push(point.x + right.x * width * 0.5 * side, point.y + lift, point.z + right.z * width * 0.5 * side);
      uvs.push(side < 0 ? 0 : 1, ratio * 12);
    });
    if (index < segments) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildSubterraneanBear() {
  const root = new THREE.Group();
  root.name = 'Morrow · autonomous alien bear';
  const fur = new THREE.MeshStandardMaterial({ color: 0x17443f, emissive: 0x061c19, emissiveIntensity: 0.32, roughness: 0.92, flatShading: true });
  const darkFur = new THREE.MeshStandardMaterial({ color: 0x071a20, emissive: 0x031014, emissiveIntensity: 0.2, roughness: 1, flatShading: true });
  const muzzleMaterial = new THREE.MeshStandardMaterial({ color: 0x6f7c75, emissive: 0x182d2a, emissiveIntensity: 0.18, roughness: 0.86, flatShading: true });
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x7affd9, toneMapped: false });
  const alienGlowMaterial = new THREE.MeshStandardMaterial({ color: 0x81ffe1, emissive: 0x25d7b0, emissiveIntensity: 2.8, roughness: 0.24, toneMapped: false });
  const spineMaterial = new THREE.MeshStandardMaterial({ color: 0x9c7bff, emissive: 0x5938c7, emissiveIntensity: 1.8, roughness: 0.34, flatShading: true, toneMapped: false });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.35, 1), fur);
  body.scale.set(1.65, 1.05, 1.08);
  body.position.y = 3.15;
  root.add(body);
  const shoulders = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 1), fur);
  shoulders.scale.set(1.42, 1.18, 1.05);
  shoulders.position.set(0, 3.55, -1.85);
  root.add(shoulders);
  const head = new THREE.Group();
  head.position.set(0, 4.35, -3.05);
  root.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.38, 1), fur);
  skull.scale.set(1.05, 0.92, 1.04);
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 1), muzzleMaterial);
  muzzle.scale.set(1.05, 0.66, 1.05);
  muzzle.position.set(0, -0.28, -1.05);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), darkFur);
  nose.position.set(0, -0.18, -1.68);
  head.add(nose);
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), darkFur);
    ear.position.set(side * 0.86, 0.9, -0.05);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), eyeMaterial);
    eye.position.set(side * 0.48, 0.18, -1.12);
    head.add(eye);
  });
  const thirdEye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 7), alienGlowMaterial);
  thirdEye.scale.set(1, 1.25, 0.52);
  thirdEye.position.set(0, 0.65, -1.18);
  head.add(thirdEye);

  const antennaTips = [];
  [-1, 1].forEach((side) => {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 1.45, 7), darkFur);
    antenna.position.set(side * 0.52, 1.45, -0.05);
    antenna.rotation.z = side * -0.34;
    antenna.rotation.x = -0.18;
    head.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), alienGlowMaterial);
    tip.position.set(side * 0.76, 2.14, -0.2);
    head.add(tip);
    antennaTips.push(tip);
  });

  const dorsalSpines = [];
  for (let index = 0; index < 6; index++) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.34 + index * 0.035, 1.05 + Math.sin(index * 0.9) * 0.28, 6), spineMaterial);
    spine.position.set(0, 5.35 + Math.sin(index * 1.2) * 0.18, -1.55 + index * 0.68);
    spine.rotation.x = (index - 2.5) * 0.07;
    root.add(spine);
    dorsalSpines.push(spine);
  }

  const glowSpots = [];
  [-1, 1].forEach((side) => {
    for (let index = 0; index < 4; index++) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.19 + index * 0.025, 8, 6), alienGlowMaterial);
      spot.scale.set(0.42, 1, 1);
      spot.position.set(side * (3.72 - index * 0.16), 3.2 + Math.sin(index * 1.7) * 0.72, -0.85 + index * 0.62);
      root.add(spot);
      glowSpots.push(spot);
    }
  });
  const legs = [];
  [[-1.35, -1.5], [1.35, -1.5], [-1.35, 1.55], [1.35, 1.55]].forEach(([x, z]) => {
    const leg = new THREE.Group();
    leg.position.set(x, 2.4, z);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.54, 1.2, 3, 7), fur);
    upper.position.y = -0.78;
    leg.add(upper);
    const paw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.68, 1), darkFur);
    paw.scale.set(1.08, 0.48, 1.35);
    paw.position.set(0, -1.85, -0.22);
    leg.add(paw);
    root.add(leg);
    legs.push(leg);
  });
  root.scale.setScalar(1.35);
  return { root, body, head, legs, thirdEye, antennaTips, dorsalSpines, glowSpots, alienGlowMaterial, spineMaterial };
}

function buildNightfallCave(hub) {
  const group = new THREE.Group();
  group.name = 'Nightfall Descent · Undermars biosphere';
  group.position.copy(surfaceWorldPosition(hub.normal, -0.18));
  group.quaternion.copy(surfaceVehicleQuaternion(hub.normal, CAVE_INWARD_HEADING));
  scene.add(group);

  // Keep the deep tunnel isolated from the surface facade. Rendering the
  // complete tube while the player was outside let the walking camera pass
  // through its back faces and exposed enormous ribbons of cave geometry.
  const interior = new THREE.Group();
  interior.name = 'Nightfall Descent · underground-only geometry';
  interior.visible = false;
  group.add(interior);
  const surfaceFacade = new THREE.Group();
  surfaceFacade.name = 'Nightfall Descent · surface entrance facade';
  group.add(surfaceFacade);

  const shellCurve = new THREE.CatmullRomCurve3(
    CAVE_ROUTE_POINTS.map((point) => point.clone().add(new THREE.Vector3(0, CAVE_INNER_RADIUS - 0.45, 0))),
    false,
    'centripetal',
    0.45
  );
  const tunnel = new THREE.Mesh(
    new THREE.TubeGeometry(shellCurve, isTouchDevice ? 54 : 86, CAVE_INNER_RADIUS, isTouchDevice ? 16 : 24, false),
    new THREE.MeshStandardMaterial({
      color: 0x201411,
      emissive: 0x050302,
      emissiveIntensity: 0.3,
      roughness: 1,
      side: THREE.BackSide,
    })
  );
  interior.add(tunnel);

  const portalCenter = CAVE_ROUTE_POINTS[0].clone().add(new THREE.Vector3(0, CAVE_INNER_RADIUS - 0.35, 0.5));
  const portalVoid = new THREE.Mesh(
    new THREE.CircleGeometry(CAVE_INNER_RADIUS - 0.28, isTouchDevice ? 28 : 42),
    new THREE.MeshBasicMaterial({ color: 0x120806, side: THREE.DoubleSide })
  );
  portalVoid.name = 'Nightfall cave recessed shadow mouth';
  // Recess the shadow disk behind the parked locomotive. Keeping it almost
  // flush with the rim made the black backdrop depth-occlude the train.
  portalVoid.position.copy(portalCenter).add(new THREE.Vector3(0, 0, -4.2));
  surfaceFacade.add(portalVoid);

  // A restrained station lamp keeps the parked train legible against the
  // tunnel darkness without lighting the whole underground route from Mars.
  const portalLamp = new THREE.PointLight(0xffa35f, isTouchDevice ? 1.35 : 1.8, 14, 2);
  portalLamp.name = 'Nightfall mine entrance warm station lamp';
  portalLamp.position.copy(portalCenter).add(new THREE.Vector3(0, 3.8, 3.2));
  surfaceFacade.add(portalLamp);

  const portalMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b241d,
    emissive: 0x260b06,
    emissiveIntensity: 0.52,
    roughness: 1,
    flatShading: true,
  });
  const entrance = new THREE.Mesh(new THREE.TorusGeometry(CAVE_INNER_RADIUS + 0.35, 0.58, 8, 40), portalMaterial);
  entrance.name = 'Nightfall cave structural rim';
  entrance.position.copy(portalCenter);
  surfaceFacade.add(entrance);

  const entryApron = new THREE.Mesh(
    new THREE.PlaneGeometry(9.4, 20),
    new THREE.MeshStandardMaterial({ color: 0x6f3425, roughness: 1, metalness: 0, side: THREE.DoubleSide })
  );
  entryApron.name = 'Nightfall cave clear dirt approach';
  entryApron.rotation.x = -Math.PI / 2;
  entryApron.position.set(0, 0.17, 13.6);
  surfaceFacade.add(entryApron);

  const entryLabel = makeLabelSprite('NIGHTFALL MINE TRAIN · UNDERMARS', '#ffbd72');
  entryLabel.position.copy(CAVE_ROUTE_POINTS[0]).add(new THREE.Vector3(0, CAVE_INNER_RADIUS * 2 + 4.1, 1));
  entryLabel.scale.set(6.8, 1.02, 1);
  surfaceFacade.add(entryLabel);

  const archRockGeometry = createProceduralRockGeometry({
    THREE,
    seed: 0xc4aeb45a,
    detail: isTouchDevice ? 1 : 2,
    archetype: 'basalt',
  });
  const tunnelRockMaterial = createProceduralRockMaterial({
    THREE,
    color: 0x3b2019,
    seed: 0xc4aef00d,
    roughness: 1,
    bumpScale: 0.032,
    textureSize: isTouchDevice ? 64 : 96,
  });

  // A restrained basalt arch reads as a real excavation entrance without
  // filling the opening. The tunnel wall rocks begin only after transition.
  const archRockMaterial = createProceduralRockMaterial({
    THREE,
    color: 0x4b2a21,
    seed: 0xc4aeb45a,
    roughness: 0.99,
    bumpScale: 0.03,
    textureSize: isTouchDevice ? 64 : 96,
  });
  const archRockCount = 21;
  const archRocks = new THREE.InstancedMesh(archRockGeometry, archRockMaterial, archRockCount);
  archRocks.name = 'Nightfall cave surface basalt arch';
  const archDummy = new THREE.Object3D();
  let archRockIndex = 0;
  for (let index = 0; index < 15; index++) {
    const angle = (index / 14) * Math.PI;
    const radius = CAVE_INNER_RADIUS + 1.05;
    archDummy.position.set(
      Math.cos(angle) * radius,
      portalCenter.y + Math.sin(angle) * radius,
      portalCenter.z + Math.sin(index * 2.1) * 0.28
    );
    archDummy.rotation.set(angle * 0.42, index * 1.07, angle - Math.PI / 2);
    const scale = 0.82 + (index % 4) * 0.09;
    archDummy.scale.set(scale * 1.18, scale, scale * 0.92);
    archDummy.updateMatrix();
    archRocks.setMatrixAt(archRockIndex++, archDummy.matrix);
  }
  [-1, 1].forEach((side) => {
    for (let level = 0; level < 3; level++) {
      archDummy.position.set(
        side * (CAVE_INNER_RADIUS + 1.02),
        1.15 + level * 1.82,
        portalCenter.z + Math.sin(level * 2.7 + side) * 0.22
      );
      archDummy.rotation.set(level * 0.46, side * (0.42 + level * 0.31), side * 0.12);
      const scale = 0.92 + level * 0.08;
      archDummy.scale.set(scale * 1.2, scale * 1.08, scale);
      archDummy.updateMatrix();
      archRocks.setMatrixAt(archRockIndex++, archDummy.matrix);
    }
  });
  archRocks.instanceMatrix.needsUpdate = true;
  archRocks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  surfaceFacade.add(archRocks);

  const tunnelRockCount = (isTouchDevice ? 26 : 40) * 8;
  const tunnelRockVariants = Array.from({ length: 3 }, (_, variant) => {
    const mesh = new THREE.InstancedMesh(
      createProceduralRockGeometry({
        THREE,
        seed: 0xc4aef00d + variant * 997,
        detail: 1,
        archetype: 'cavern',
        ruggedness: 0.86 + variant * 0.08,
      }),
      tunnelRockMaterial,
      Math.ceil(Math.max(0, tunnelRockCount - variant) / 3)
    );
    mesh.name = `Nightfall tunnel weathered wall rock variant ${variant + 1}`;
    return mesh;
  });
  const dummy = new THREE.Object3D();
  const tunnelRockIndices = [0, 0, 0];
  let tunnelRockIndex = 0;
  const tunnelSegments = isTouchDevice ? 26 : 40;
  for (let segment = 0; segment < tunnelSegments; segment++) {
    const ratio = segment / (tunnelSegments - 1);
    const point = CAVE_ROUTE_CURVE.getPointAt(ratio);
    const tangent = CAVE_ROUTE_CURVE.getTangentAt(ratio).normalize();
    const routeRight = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    for (let stoneIndex = 0; stoneIndex < 8; stoneIndex++) {
      const angle = (stoneIndex / 7) * Math.PI;
      const radius = CAVE_INNER_RADIUS + 0.48 + Math.sin(segment * 2.17 + stoneIndex * 4.3) * 0.24;
      dummy.position.copy(point).addScaledVector(routeRight, Math.cos(angle) * radius).addScaledVector(UP, 0.25 + Math.sin(angle) * radius);
      dummy.rotation.set(angle + segment * 0.13, segment * 0.71 + stoneIndex, stoneIndex * 0.37);
      const variation = 0.76 + ((segment * 17 + stoneIndex * 31) % 9) * 0.035;
      dummy.scale.set(0.68 * variation, 0.54 * variation, 0.82 * variation);
      dummy.updateMatrix();
      const variant = tunnelRockIndex % tunnelRockVariants.length;
      tunnelRockVariants[variant].setMatrixAt(tunnelRockIndices[variant]++, dummy.matrix);
      tunnelRockIndex += 1;
    }
  }
  tunnelRockVariants.forEach((mesh) => {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    interior.add(mesh);
  });

  const caveAccentLights = [];
  const crystalMaterials = [];
  const crystalGeometry = new THREE.OctahedronGeometry(0.48, 0);
  const crystalDummy = new THREE.Object3D();
  const crystalCount = isTouchDevice ? 44 : 70;
  const tunnelCrystals = new THREE.InstancedMesh(
    crystalGeometry,
    new THREE.MeshStandardMaterial({ color: 0x35cfff, emissive: 0x119dc2, emissiveIntensity: 2.1, roughness: 0.28, toneMapped: false }),
    crystalCount
  );
  crystalMaterials.push(tunnelCrystals.material);
  for (let index = 0; index < crystalCount; index++) {
    const ratio = 0.03 + (index / crystalCount) * 0.93;
    const point = CAVE_ROUTE_CURVE.getPointAt(ratio);
    const tangent = CAVE_ROUTE_CURVE.getTangentAt(ratio).normalize();
    const routeRight = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const side = index % 2 ? 1 : -1;
    crystalDummy.position.copy(point).addScaledVector(routeRight, side * (CAVE_INNER_RADIUS * 0.58)).addScaledVector(UP, 0.5 + (index % 4) * 0.22);
    crystalDummy.rotation.set(index * 1.31, index * 2.17, side * 0.4);
    const scale = 0.65 + (index % 5) * 0.13;
    crystalDummy.scale.set(scale * 0.62, scale * 1.8, scale * 0.62);
    crystalDummy.updateMatrix();
    tunnelCrystals.setMatrixAt(index, crystalDummy.matrix);
    if (index % 12 === 3) {
      const light = new THREE.PointLight(index % 24 === 3 ? 0x4be1ff : 0xc87aff, 5.2, 22, 1.8);
      light.position.copy(crystalDummy.position).addScaledVector(UP, 0.72);
      interior.add(light);
      caveAccentLights.push(light);
    }
  }
  tunnelCrystals.instanceMatrix.needsUpdate = true;
  interior.add(tunnelCrystals);

  const chamber = new THREE.Group();
  chamber.name = 'The Vastwater · underground river world';
  interior.add(chamber);
  const chamberFloor = new THREE.Mesh(
    new THREE.CircleGeometry(1, isTouchDevice ? 48 : 72),
    new THREE.MeshStandardMaterial({ color: 0x191923, emissive: 0x080d17, emissiveIntensity: 0.4, roughness: 0.98, metalness: 0.03, side: THREE.DoubleSide })
  );
  chamberFloor.rotation.x = -Math.PI / 2;
  chamberFloor.scale.set(CAVE_CHAMBER_RADIUS_X, CAVE_CHAMBER_RADIUS_Z, 1);
  chamberFloor.position.copy(CAVE_CHAMBER_CENTER).add(new THREE.Vector3(0, 0.05, 0));
  chamber.add(chamberFloor);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, isTouchDevice ? 32 : 48, isTouchDevice ? 16 : 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b0910, roughness: 1, side: THREE.BackSide })
  );
  dome.scale.set(CAVE_CHAMBER_RADIUS_X + 3, 41, CAVE_CHAMBER_RADIUS_Z + 3);
  dome.position.copy(CAVE_CHAMBER_CENTER).add(new THREE.Vector3(0, 0.2, 0));
  chamber.add(dome);

  const cavernSkyLight = new THREE.HemisphereLight(0x5e91ad, 0x160b12, 0.62);
  chamber.add(cavernSkyLight);
  const cavernKeyLight = new THREE.DirectionalLight(0x8bc7d8, 0.68);
  cavernKeyLight.position.set(-34, -10, -160);
  cavernKeyLight.target.position.copy(CAVE_CHAMBER_CENTER);
  chamber.add(cavernKeyLight, cavernKeyLight.target);
  [
    { color: 0x42bddd, position: [-34, -27, -178] },
    { color: 0x9a55e8, position: [3, -19, -226] },
    { color: 0xffa84d, position: [34, -28, -218] },
  ].forEach((fill) => {
    const light = new THREE.PointLight(fill.color, 13.5, 108, 1.45);
    light.position.set(...fill.position);
    chamber.add(light);
    caveAccentLights.push(light);
  });

  const chamberRockCount = isTouchDevice ? 100 : 160;
  const chamberRockMaterial = createProceduralRockMaterial({
    THREE,
    color: 0x292128,
    seed: 0xc4aecabe,
    roughness: 1,
    bumpScale: 0.035,
    textureSize: isTouchDevice ? 64 : 96,
  });
  const chamberRockVariants = Array.from({ length: 3 }, (_, variant) => {
    const mesh = new THREE.InstancedMesh(
      createProceduralRockGeometry({
        THREE,
        seed: 0xc4aecabe + variant * 1619,
        detail: isTouchDevice ? 1 : 2,
        archetype: variant === 1 ? 'basalt' : 'cavern',
        ruggedness: 0.9 + variant * 0.07,
      }),
      chamberRockMaterial,
      Math.ceil(Math.max(0, chamberRockCount - variant) / 3)
    );
    mesh.name = `Vastwater eroded chamber rock variant ${variant + 1}`;
    return mesh;
  });
  const chamberRockIndices = [0, 0, 0];
  for (let index = 0; index < chamberRockCount; index++) {
    const angle = (index / chamberRockCount) * Math.PI * 2;
    const wallBand = index % 3 !== 0;
    const radiusX = wallBand ? CAVE_CHAMBER_RADIUS_X - 1.5 : 12 + (index % 11) * 3.2;
    const radiusZ = wallBand ? CAVE_CHAMBER_RADIUS_Z - 1.5 : 16 + (index % 13) * 3.7;
    dummy.position.set(
      CAVE_CHAMBER_CENTER.x + Math.sin(angle * 1.03) * radiusX,
      wallBand ? CAVE_CHAMBER_CENTER.y + 1.2 + (index % 7) * 3.1 : CAVE_CHAMBER_CENTER.y + 29 + Math.sin(index * 3.1) * 6,
      CAVE_CHAMBER_CENTER.z + Math.cos(angle) * radiusZ
    );
    dummy.rotation.set(
      wallBand ? (index % 5 - 2) * 0.055 : index * 0.17,
      angle + (index % 4 - 1.5) * 0.09,
      wallBand ? (index % 3 - 1) * 0.08 : index * 0.29
    );
    const scale = wallBand ? 2.25 + (index % 6) * 0.5 : 1.2 + (index % 5) * 0.5;
    dummy.scale.set(
      scale * (wallBand ? 1.72 + (index % 3) * 0.12 : 1.34),
      scale * (wallBand ? 0.62 + (index % 4) * 0.07 : 0.54),
      scale * (wallBand ? 0.82 + (index % 2) * 0.16 : 1.52)
    );
    dummy.updateMatrix();
    const variant = index % chamberRockVariants.length;
    chamberRockVariants[variant].setMatrixAt(chamberRockIndices[variant]++, dummy.matrix);
  }
  chamberRockVariants.forEach((mesh) => {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    chamber.add(mesh);
  });

  const riverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-44, -46.78, -154),
    new THREE.Vector3(-24, -46.75, -177),
    new THREE.Vector3(-9, -46.72, -202),
    new THREE.Vector3(8, -46.74, -227),
    new THREE.Vector3(31, -46.76, -249),
    new THREE.Vector3(43, -46.77, -265),
  ], false, 'centripetal', 0.5);
  const riverMaterial = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; vec3 p=position; p.y += sin(uv.y*18.0)*0.035; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){float ripple=sin(vUv.y*54.0-uTime*4.2)+sin(vUv.y*23.0+vUv.x*11.0-uTime*2.1); vec3 deep=vec3(.015,.16,.23); vec3 glow=vec3(.12,.72,.82); float edge=pow(abs(vUv.x-.5)*2.0,2.0); gl_FragColor=vec4(mix(deep,glow,.32+ripple*.08+edge*.18),.88);}`,
  });
  const river = new THREE.Mesh(createCaveRibbonGeometry(riverCurve, 8.5, isTouchDevice ? 48 : 72, 0), riverMaterial);
  chamber.add(river);

  const waterfallMaterial = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){float stream=.6+.4*sin(vUv.x*31.0+sin(vUv.y*13.0)-uTime*3.0); float foam=smoothstep(.7,1.0,sin((vUv.y+uTime*.22)*60.0)*.5+.5); vec3 c=mix(vec3(.02,.22,.3),vec3(.38,.92,1.),stream*.45+foam*.35); gl_FragColor=vec4(c,.42+stream*.22);}`,
  });
  const waterfalls = [];
  [
    { position: [-42, -31.5, -157], rotation: 0.62, scale: [9, 31] },
    { position: [41, -28.5, -261], rotation: -2.45, scale: [13, 37] },
  ].forEach((fall) => {
    const waterfall = new THREE.Mesh(new THREE.PlaneGeometry(fall.scale[0], fall.scale[1], 1, 16), waterfallMaterial);
    waterfall.position.set(...fall.position);
    waterfall.rotation.y = fall.rotation;
    chamber.add(waterfall);
    waterfalls.push(waterfall);
    const light = new THREE.PointLight(0x3ed9ff, 3.1, 38, 2);
    light.position.copy(waterfall.position).add(new THREE.Vector3(0, -8, 3));
    chamber.add(light);
    caveAccentLights.push(light);
  });

  const mistCount = isTouchDevice ? 65 : 120;
  const mistPositions = new Float32Array(mistCount * 3);
  const mistSeeds = [];
  for (let index = 0; index < mistCount; index++) {
    const fallIndex = index % 2;
    const origin = fallIndex === 0 ? new THREE.Vector3(-42, -46, -157) : new THREE.Vector3(41, -46, -261);
    const seed = { origin, phase: (index * 0.618) % 1, radius: 1.5 + (index % 9) * 0.35, speed: 0.18 + (index % 7) * 0.025 };
    mistSeeds.push(seed);
    mistPositions[index * 3] = origin.x;
    mistPositions[index * 3 + 1] = origin.y;
    mistPositions[index * 3 + 2] = origin.z;
  }
  const mistGeometry = new THREE.BufferGeometry();
  mistGeometry.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
  const mist = new THREE.Points(mistGeometry, new THREE.PointsMaterial({ map: dustTexture, color: 0xa9efff, size: 1.25, transparent: true, opacity: 0.22, depthWrite: false }));
  chamber.add(mist);

  const hive = new THREE.Group();
  hive.name = 'The Golden Resonance · giant hive';
  hive.position.set(38, -27, -220);
  chamber.add(hive);
  const hiveMaterial = new THREE.MeshStandardMaterial({ color: 0x9e5b12, emissive: 0x6b2e02, emissiveIntensity: 0.55, roughness: 0.82 });
  [[0, 1, 0, 8], [0, -5, 0, 10], [1, -11, 0, 8], [-1, -16, 0, 6]].forEach(([x, y, z, size]) => {
    const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hiveMaterial);
    lobe.position.set(x, y, z);
    lobe.scale.set(size * 0.76, size, size * 0.72);
    hive.add(lobe);
  });
  const hexCount = isTouchDevice ? 55 : 91;
  const hexes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.78, 0.78, 0.38, 6), new THREE.MeshStandardMaterial({ color: 0xe0a233, emissive: 0x7a3c08, emissiveIntensity: 0.75, roughness: 0.65 }), hexCount);
  let hexIndex = 0;
  for (let row = -6; row <= 6 && hexIndex < hexCount; row++) {
    for (let column = -4; column <= 4 && hexIndex < hexCount; column++) {
      if (Math.abs(row) + Math.abs(column) > 9) continue;
      dummy.position.set(-6.25, -7 + row * 1.17, column * 1.38 + (row & 1 ? 0.68 : 0));
      dummy.rotation.set(0, 0, Math.PI / 2);
      dummy.scale.setScalar(0.82 + ((row * row + column * 7 + 19) % 5) * 0.04);
      dummy.updateMatrix();
      hexes.setMatrixAt(hexIndex++, dummy.matrix);
    }
  }
  hexes.count = hexIndex;
  hexes.instanceMatrix.needsUpdate = true;
  hive.add(hexes);
  const hiveLight = new THREE.PointLight(0xffa726, 4.2, 44, 2);
  hiveLight.position.set(-5, -7, 0);
  hive.add(hiveLight);
  caveAccentLights.push(hiveLight);

  const beeCount = isTouchDevice ? 45 : 85;
  const beePositions = new Float32Array(beeCount * 3);
  const beeSeeds = [];
  for (let index = 0; index < beeCount; index++) {
    beeSeeds.push({ angle: index * 2.399, radius: 6 + (index % 13) * 0.58, height: -8 + (index % 17) * 0.8, speed: 0.6 + (index % 9) * 0.07 });
  }
  const beeGeometry = new THREE.BufferGeometry();
  beeGeometry.setAttribute('position', new THREE.BufferAttribute(beePositions, 3));
  const bees = new THREE.Points(beeGeometry, new THREE.PointsMaterial({ color: 0xffd35a, size: 0.24, transparent: true, opacity: 0.95, toneMapped: false }));
  hive.add(bees);

  const chamberCrystalCount = isTouchDevice ? 90 : 150;
  const chamberCrystals = new THREE.InstancedMesh(crystalGeometry, new THREE.MeshStandardMaterial({ color: 0xd899ff, emissive: 0x7a2cc2, emissiveIntensity: 2.4, roughness: 0.22, toneMapped: false }), chamberCrystalCount);
  crystalMaterials.push(chamberCrystals.material);
  for (let index = 0; index < chamberCrystalCount; index++) {
    const angle = index * 2.399;
    const ring = 16 + (index % 19) * 2.1;
    crystalDummy.position.set(
      CAVE_CHAMBER_CENTER.x + Math.sin(angle) * Math.min(ring, CAVE_CHAMBER_RADIUS_X - 5),
      CAVE_CHAMBER_CENTER.y + 0.5,
      CAVE_CHAMBER_CENTER.z + Math.cos(angle) * Math.min(ring * 1.22, CAVE_CHAMBER_RADIUS_Z - 6)
    );
    crystalDummy.rotation.set(Math.sin(index) * 0.22, angle, Math.cos(index * 1.7) * 0.18);
    const scale = 0.65 + (index % 8) * 0.14;
    crystalDummy.scale.set(scale * 0.72, scale * (1.8 + (index % 3) * 0.5), scale * 0.72);
    crystalDummy.updateMatrix();
    chamberCrystals.setMatrixAt(index, crystalDummy.matrix);
  }
  chamberCrystals.instanceMatrix.needsUpdate = true;
  chamber.add(chamberCrystals);

  const chamberLabel = makeLabelSprite('THE VASTWATER · UNDERMARS BIOSPHERE', '#9beaff');
  chamberLabel.position.set(0, -8, -204);
  chamberLabel.scale.set(12.5, 1.6, 1);
  chamber.add(chamberLabel);

  const bear = buildSubterraneanBear();
  bear.root.position.set(-20, CAVE_CHAMBER_CENTER.y + 0.25, -210);
  bear.root.rotation.y = -0.5;
  chamber.add(bear.root);
  const bearLabel = makeLabelSprite('MORROW · AUTONOMOUS ALIEN BEAR', '#91ffe2');
  bearLabel.position.set(0, 8.6, 0);
  bearLabel.scale.set(6.4, 0.9, 1);
  bear.root.add(bearLabel);
  const bearWaypoints = [
    { name: 'patrol the glowstone bank', position: new THREE.Vector3(-29, CAVE_CHAMBER_CENTER.y + 0.25, -225), pause: 4 },
    { name: 'fish in the underground river', position: new THREE.Vector3(-12, CAVE_CHAMBER_CENTER.y + 0.25, -201), pause: 7 },
    { name: 'inspect the golden hive', position: new THREE.Vector3(25, CAVE_CHAMBER_CENTER.y + 0.25, -219), pause: 5 },
    { name: 'watch the western waterfall', position: new THREE.Vector3(-35, CAVE_CHAMBER_CENTER.y + 0.25, -166), pause: 6 },
    { name: 'forage among the crystal columns', position: new THREE.Vector3(5, CAVE_CHAMBER_CENTER.y + 0.25, -242), pause: 5 },
    { name: 'drink from the blue river', position: new THREE.Vector3(15, CAVE_CHAMBER_CENTER.y + 0.25, -232), pause: 7 },
  ];

  const mineTrain = buildCaveMineTrain({
    THREE,
    curve: CAVE_ROUTE_CURVE,
    routeLength: CAVE_ROUTE_LENGTH,
    innerRadius: CAVE_INNER_RADIUS,
    isTouchDevice,
    makeLabelSprite,
  });
  // Keep the station and parked train visible at the cave mouth, while the
  // long rail run remains streamed with the underground-only geometry.
  group.add(mineTrain.root);
  interior.add(mineTrain.infrastructure);
  surfaceFacade.add(mineTrain.surfaceStation);

  caveAccentLights.forEach((light) => { light.userData.caveBaseIntensity = light.intensity; });
  return {
    group, interior, surfaceFacade, portalVoid, chamber, caveAccentLights, crystalMaterials, riverMaterial, waterfallMaterial, waterfalls,
    mist, mistSeeds, hive, hiveLight, bees, beeSeeds, bear, bearWaypoints, mineTrain,
    bearWaypoint: 0, bearPause: 2, bearActivity: 'waking beneath Mars', chamberLabel,
  };
}

let caveTravelZone = 'surface';
let caveRouteDistance = 0;
let caveRouteFacing = 1;
let caveLateral = 0;
const caveLocalPosition = CAVE_ROUTE_POINTS[0].clone();
const caveLocalForward = new THREE.Vector3(0, 0, -1);
const caveLocalUp = new THREE.Vector3(0, 1, 0);
const caveWorldForward = new THREE.Vector3();
const caveWorldUp = new THREE.Vector3();
const caveWorldRight = new THREE.Vector3();
const caveChamberHeading = new THREE.Vector3(0, 0, -1);
const caveSamplePoint = new THREE.Vector3();
const caveSampleTangent = new THREE.Vector3();
const caveSampleRight = new THREE.Vector3();
const caveRoverTargetPosition = new THREE.Vector3();
const caveEntryWorldPosition = new THREE.Vector3();
const caveEntryWorldQuaternion = new THREE.Quaternion();
let caveEntryBlend = 1;
let caveDarkness = 0;
let caveWasInside = false;
let caveChamberDiscovered = false;
const caveFog = new THREE.FogExp2(0x071014, 0.0075);
let mineTrainSpeed = 0;
let caveFootSpeed = 0;
const CAVE_FOOT_STATION_LOCAL = new THREE.Vector3(4.35, CAVE_CHAMBER_CENTER.y + 0.28, -172.4);
const caveFootLocalPosition = CAVE_FOOT_STATION_LOCAL.clone();
const caveFootHeading = new THREE.Vector3(0, 0, -1);
const caveFootCandidate = new THREE.Vector3();
const caveFootWorldPosition = new THREE.Vector3();
const caveFootWorldForward = new THREE.Vector3();
const caveFootWorldUp = new THREE.Vector3();
const caveFootWorldRight = new THREE.Vector3();
const caveFootOrientation = new THREE.Matrix4();
const caveFootQuaternion = new THREE.Quaternion();

function sampleCaveRoute(distance) {
  const ratio = THREE.MathUtils.clamp(distance / CAVE_ROUTE_LENGTH, 0, 1);
  caveSamplePoint.copy(CAVE_ROUTE_CURVE.getPointAt(ratio));
  caveSampleTangent.copy(CAVE_ROUTE_CURVE.getTangentAt(ratio)).normalize();
  caveSampleRight.crossVectors(caveSampleTangent, UP).normalize();
  caveLocalPosition.copy(caveSamplePoint).addScaledVector(caveSampleRight, caveLateral);
  caveLocalForward.copy(caveSampleTangent).multiplyScalar(caveRouteFacing);
  caveLocalUp.copy(UP);
}

function placeCaveRover(dt) {
  const runtime = hubRuntime.nightfall;
  caveWorldForward.copy(caveLocalForward).transformDirection(runtime.group.matrixWorld).normalize();
  caveWorldUp.copy(caveLocalUp).transformDirection(runtime.group.matrixWorld).normalize();
  caveWorldRight.crossVectors(caveWorldForward, caveWorldUp).normalize();
  caveRoverTargetPosition.copy(caveLocalPosition).addScaledVector(caveLocalUp, jumpHeight);
  runtime.group.localToWorld(caveRoverTargetPosition);
  orientationMatrix.makeBasis(caveWorldRight, caveWorldUp, caveWorldForward.clone().multiplyScalar(-1));
  targetRoverQuaternion.setFromRotationMatrix(orientationMatrix);
  if (caveEntryBlend < 1) {
    caveEntryBlend = Math.min(1, caveEntryBlend + dt / 0.68);
    const blend = caveEntryBlend * caveEntryBlend * (3 - 2 * caveEntryBlend);
    alien.position.lerpVectors(caveEntryWorldPosition, caveRoverTargetPosition, blend);
    alien.quaternion.copy(caveEntryWorldQuaternion).slerp(targetRoverQuaternion, blend);
  } else {
    alien.position.copy(caveRoverTargetPosition);
    alien.quaternion.slerp(targetRoverQuaternion, 1 - Math.exp(-dt * 12));
  }
}

function enterNightfallDescent() {
  drivingCourses.reset();
  drivingCoursePrompt = '';
  activeDrivingCourse = null;
  caveEntryWorldPosition.copy(alien.position);
  caveEntryWorldQuaternion.copy(alien.quaternion);
  caveEntryBlend = 0;
  caveTravelZone = 'tunnel';
  caveRouteDistance = 0.08;
  caveRouteFacing = 1;
  caveLateral = 0;
  sampleCaveRoute(caveRouteDistance);
  jumpHeight = 0;
  verticalVelocity = 0;
  grounded = true;
  showBanner(`NIGHTFALL DESCENT · ${Math.round(CAVE_ROUTE_LENGTH)} M DRIVE TO THE UNDERMARS`);
}

function updateCaveNavigation(dt, steeringInput) {
  if (caveTravelZone === 'tunnel') {
    caveRouteDistance += driveSpeed * caveRouteFacing * dt;
    caveLateral = THREE.MathUtils.clamp(caveLateral + steeringInput * caveRouteFacing * Math.min(4.2, Math.abs(driveSpeed) * 0.52) * dt, -3.65, 3.65);
    if (caveRouteDistance <= 0) {
      caveTravelZone = 'surface';
      playerNormal.copy(stepWorldNormal(NIGHTFALL_CAVE.normal, CAVE_INWARD_HEADING, -2.1, PLANET_RADIUS));
      playerHeading.copy(CAVE_INWARD_HEADING).multiplyScalar(caveRouteFacing).normalize();
      jumpHeight = 0;
      showBanner('NIGHTFALL EXIT · MARTIAN DAYLIGHT RESTORED');
      return;
    }
    if (caveRouteDistance >= CAVE_ROUTE_LENGTH) {
      caveTravelZone = 'chamber';
      caveRouteDistance = CAVE_ROUTE_LENGTH;
      sampleCaveRoute(caveRouteDistance);
      caveChamberHeading.copy(caveLocalForward).setY(0).normalize();
      caveLocalPosition.copy(CAVE_ROUTE_POINTS[CAVE_ROUTE_POINTS.length - 1]).addScaledVector(caveChamberHeading, 1.5);
      if (!caveChamberDiscovered) {
        caveChamberDiscovered = true;
        showBanner('THE VASTWATER DISCOVERED · LIFE BENEATH MARS');
      }
    } else sampleCaveRoute(caveRouteDistance);
  }
  if (caveTravelZone === 'chamber') {
    const reverseSteer = driveSpeed < -0.1 ? -1 : 1;
    const steerStrength = THREE.MathUtils.clamp(Math.abs(driveSpeed) / 3, 0.18, 1);
    caveChamberHeading.applyAxisAngle(
      UP,
      steeringInput * reverseSteer * (activeProfile?.turnRate || 1.65) * steerStrength * dt
    ).normalize();
    const candidate = caveLocalPosition.clone().addScaledVector(caveChamberHeading, driveSpeed * dt);
    const normalizedX = (candidate.x - CAVE_CHAMBER_CENTER.x) / (CAVE_CHAMBER_RADIUS_X - 4);
    const normalizedZ = (candidate.z - CAVE_CHAMBER_CENTER.z) / (CAVE_CHAMBER_RADIUS_Z - 4);
    const insideChamber = normalizedX * normalizedX + normalizedZ * normalizedZ < 1;
    const movingTowardEntrance = caveChamberHeading.z * driveSpeed > 0.15;
    const atTunnelMouth = movingTowardEntrance && candidate.z > -171 && candidate.z < -155 && Math.abs(candidate.x) < 7.2;
    if (atTunnelMouth) {
      caveTravelZone = 'tunnel';
      caveRouteDistance = CAVE_ROUTE_LENGTH - 0.6;
      const routeTangent = CAVE_ROUTE_CURVE.getTangentAt(1).setY(0).normalize();
      caveRouteFacing = caveChamberHeading.dot(routeTangent) >= 0 ? 1 : -1;
      caveLateral = THREE.MathUtils.clamp(candidate.x, -3.65, 3.65);
      sampleCaveRoute(caveRouteDistance);
    } else if (insideChamber) {
      caveLocalPosition.copy(candidate);
    } else driveSpeed *= -0.12;
    caveLocalPosition.y = CAVE_CHAMBER_CENTER.y + 0.22 + Math.sin(caveLocalPosition.x * 0.09) * 0.08;
    caveLocalForward.copy(caveChamberHeading);
    caveLocalUp.copy(UP);
  }
}

function isNearSurfaceMineTrain(normal = footNormal, radius = 8.5) {
  return currentWorld === 'mars'
    && caveTravelZone === 'surface'
    && normal
    && arcDistanceForWorld('mars', normal, NIGHTFALL_CAVE.normal) < radius;
}

function isNearCavernMineTrain(radius = 7.2) {
  return travelMode === 'cave-walking'
    && caveFootLocalPosition.distanceTo(CAVE_FOOT_STATION_LOCAL) < radius;
}

function poseAlienForMineTrain() {
  const train = hubRuntime.nightfall.mineTrain;
  alienDriver.thrusterFlames.visible = false;
  train.riderAnchor.add(alienDriver.alien);
  footRoot.visible = false;
  alienDriver.alien.scale.setScalar(0.66);
  alienDriver.alien.position.set(0, -0.08, 0);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.18;
    leg.shin.rotation.x = 1.42;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 0.7;
    arm.upper.rotation.z = index === 0 ? -0.16 : 0.16;
    arm.fore.rotation.x = 0.42;
  });
}

function boardNightfallMineTrain(fromCavern = false) {
  if (!fromCavern && !isNearSurfaceMineTrain()) return;
  if (fromCavern && !isNearCavernMineTrain()) return;
  poseAlienForMineTrain();
  mineTrainSpeed = 0;
  caveRouteFacing = 1;
  caveRouteDistance = fromCavern ? CAVE_ROUTE_LENGTH - 0.08 : 0.08;
  caveTravelZone = 'tunnel';
  sampleCaveRoute(caveRouteDistance);
  travelMode = 'mine-train';
  currentWorld = 'mars';
  lookingAtCamera = false;
  hubRuntime.nightfall.mineTrain.infrastructure.visible = true;
  showBanner(fromCavern
    ? 'NIGHTFALL MINE TRAIN · HOLD S TO CLIMB BACK TO MARS'
    : 'NIGHTFALL MINE TRAIN · HOLD W TO DESCEND TO THE VASTWATER');
}

function attachAlienInCavern() {
  footRoot.add(alienDriver.alien);
  footRoot.visible = true;
  alienDriver.alien.scale.setScalar(0.9);
  alienDriver.alien.position.set(0, 0.04, 0);
  alienDriver.alien.rotation.set(0, 0, 0);
  caveFootLocalPosition.copy(CAVE_FOOT_STATION_LOCAL);
  caveFootHeading.set(0, 0, -1);
  caveFootSpeed = 0;
  footJumpHeight = 0;
  footVerticalVelocity = 0;
  footGrounded = true;
  travelMode = 'cave-walking';
  caveTravelZone = 'chamber';
  currentWorld = 'mars';
  alienHomeInterior = 0;
  placeCaveWalkingAlien();
}

function disembarkNightfallMineTrain() {
  mineTrainSpeed = 0;
  if (caveRouteDistance >= CAVE_ROUTE_LENGTH - 0.7) {
    caveRouteDistance = CAVE_ROUTE_LENGTH;
    attachAlienInCavern();
    if (!caveChamberDiscovered) caveChamberDiscovered = true;
    showBanner('VASTWATER TERMINUS · ALIEN ON FOOT · E REBOARDS THE TRAIN');
    return;
  }
  if (caveRouteDistance <= 0.7) {
    caveRouteDistance = 0;
    caveTravelZone = 'surface';
    const exitNormal = stepWorldNormal(NIGHTFALL_CAVE.normal, CAVE_INWARD_HEADING, -7.2, PLANET_RADIUS);
    attachAlienOnFoot('mars', exitNormal, CAVE_INWARD_HEADING);
    travelMode = 'walking';
    hubRuntime.nightfall.mineTrain.infrastructure.visible = false;
    showBanner('NIGHTFALL SURFACE STATION · RETURNED TO MARTIAN DAYLIGHT');
    return;
  }
  showBanner('MINE TRAIN MOVING · DISEMBARK AT A STATION');
}

function updateNightfallMineTrain(dt, time, throttleInput) {
  const forwardLimit = 10.2;
  const reverseLimit = 7.4;
  const targetSpeed = throttleInput > 0 ? forwardLimit : throttleInput < 0 ? -reverseLimit : 0;
  mineTrainSpeed = THREE.MathUtils.damp(
    mineTrainSpeed,
    targetSpeed,
    throttleInput === 0 ? 2.6 : mineTrainSpeed * throttleInput < 0 ? 6.8 : 3.4,
    dt
  );
  if (Math.abs(mineTrainSpeed) < 0.012) mineTrainSpeed = 0;
  caveRouteDistance = THREE.MathUtils.clamp(caveRouteDistance + mineTrainSpeed * dt, 0, CAVE_ROUTE_LENGTH);
  if ((caveRouteDistance <= 0 && mineTrainSpeed < 0) || (caveRouteDistance >= CAVE_ROUTE_LENGTH && mineTrainSpeed > 0)) {
    mineTrainSpeed = 0;
  }
  caveTravelZone = caveRouteDistance >= CAVE_ROUTE_LENGTH - 0.001 ? 'chamber' : 'tunnel';
  sampleCaveRoute(caveRouteDistance);
  hubRuntime.nightfall.mineTrain.update({
    distance: caveRouteDistance,
    direction: caveRouteFacing,
    speed: mineTrainSpeed,
    dt,
    time,
    visible: true,
  });
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.55) * 0.014;
  alienDriver.alien.rotation.z = Math.sin(time * 8.2) * Math.min(0.025, Math.abs(mineTrainSpeed) * 0.003);
  updateRoverAudio(mineTrainSpeed * 0.48, throttleInput * 0.34);
  if (caveRouteDistance >= CAVE_ROUTE_LENGTH && !caveChamberDiscovered) {
    caveChamberDiscovered = true;
    showBanner('THE VASTWATER DISCOVERED · PRESS E TO STEP OFF THE TRAIN');
  }
}

function placeCaveWalkingAlien() {
  const caveGroup = hubRuntime.nightfall.group;
  caveFootWorldPosition.copy(caveFootLocalPosition);
  caveGroup.localToWorld(caveFootWorldPosition);
  caveFootWorldForward.copy(caveFootHeading).transformDirection(caveGroup.matrixWorld).normalize();
  caveFootWorldUp.copy(UP).transformDirection(caveGroup.matrixWorld).normalize();
  caveFootWorldRight.crossVectors(caveFootWorldForward, caveFootWorldUp).normalize();
  caveFootOrientation.makeBasis(caveFootWorldRight, caveFootWorldUp, caveFootWorldForward.clone().multiplyScalar(-1));
  caveFootQuaternion.setFromRotationMatrix(caveFootOrientation);
  footRoot.position.copy(caveFootWorldPosition);
  footRoot.quaternion.copy(caveFootQuaternion);
}

function updateCaveWalking(dt, time, throttleInput, steeringInput) {
  jumpQueued = false;
  updateThrusterAudio(false, false, 0);
  const targetSpeed = throttleInput * 8.6;
  caveFootSpeed = THREE.MathUtils.damp(caveFootSpeed, targetSpeed, throttleInput === 0 ? 7.5 : 10.5, dt);
  caveFootHeading.applyAxisAngle(UP, steeringInput * 2.1 * dt).normalize();
  caveFootCandidate.copy(caveFootLocalPosition).addScaledVector(caveFootHeading, caveFootSpeed * dt);
  const nx = (caveFootCandidate.x - CAVE_CHAMBER_CENTER.x) / (CAVE_CHAMBER_RADIUS_X - 4.5);
  const nz = (caveFootCandidate.z - CAVE_CHAMBER_CENTER.z) / (CAVE_CHAMBER_RADIUS_Z - 4.5);
  if (nx * nx + nz * nz < 1) caveFootLocalPosition.copy(caveFootCandidate);
  else caveFootSpeed *= -0.08;
  caveFootLocalPosition.y = CAVE_CHAMBER_CENTER.y + 0.28 + Math.sin(caveFootLocalPosition.x * 0.09) * 0.06;
  placeCaveWalkingAlien();
  const walkAmount = THREE.MathUtils.clamp(Math.abs(caveFootSpeed) / 8.6, 0, 1);
  const stride = Math.sin(time * (5.8 + walkAmount * 3.1)) * walkAmount;
  legs.forEach((leg, index) => {
    const side = index === 0 ? 1 : -1;
    leg.thigh.rotation.x = THREE.MathUtils.damp(leg.thigh.rotation.x, stride * side * 0.72, 11, dt);
    leg.shin.rotation.x = THREE.MathUtils.damp(leg.shin.rotation.x, Math.max(0, -stride * side) * 0.62, 11, dt);
  });
  arms.forEach((arm, index) => {
    const side = index === 0 ? -1 : 1;
    arm.upper.rotation.x = THREE.MathUtils.damp(arm.upper.rotation.x, stride * side * 0.48, 10, dt);
    arm.fore.rotation.x = THREE.MathUtils.damp(arm.fore.rotation.x, 0.12, 8, dt);
  });
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.8) * 0.018;
}

function updateNightfallWorld(dt, time) {
  const runtime = hubRuntime.nightfall;
  if (caveWaterGain && audioStarted && audioEnabled && audioContext.state === 'running') {
    const caveWaterLevel = caveTravelZone === 'chamber' ? 0.0085 : caveTravelZone === 'tunnel' ? 0.0012 : 0.0001;
    caveWaterGain.gain.setTargetAtTime(caveWaterLevel, audioContext.currentTime, caveTravelZone === 'surface' ? 0.5 : 0.8);
  }
  if (!runtime.group.visible) return;
  runtime.riverMaterial.uniforms.uTime.value = time;
  runtime.waterfallMaterial.uniforms.uTime.value = time;
  runtime.crystalMaterials.forEach((material, index) => {
    material.emissiveIntensity = 2.15 + Math.sin(time * 1.55 + index * 1.9) * 0.38;
  });
  runtime.caveAccentLights.forEach((light, index) => {
    const baseIntensity = light.userData.caveBaseIntensity || 3;
    light.intensity = baseIntensity * (0.9 + Math.sin(time * 2.4 + index * 1.37) * 0.1);
  });
  const mistPositions = runtime.mist.geometry.attributes.position;
  runtime.mistSeeds.forEach((seed, index) => {
    seed.phase = (seed.phase + dt * seed.speed) % 1;
    const angle = index * 2.399 + time * 0.22;
    mistPositions.array[index * 3] = seed.origin.x + Math.cos(angle) * seed.radius * seed.phase;
    mistPositions.array[index * 3 + 1] = seed.origin.y + seed.phase * 4.5;
    mistPositions.array[index * 3 + 2] = seed.origin.z + Math.sin(angle) * seed.radius * seed.phase;
  });
  mistPositions.needsUpdate = true;
  const beePositions = runtime.bees.geometry.attributes.position;
  runtime.beeSeeds.forEach((seed, index) => {
    const angle = seed.angle + time * seed.speed;
    beePositions.array[index * 3] = Math.cos(angle) * seed.radius - 3;
    beePositions.array[index * 3 + 1] = seed.height + Math.sin(time * 2.8 + index) * 1.4;
    beePositions.array[index * 3 + 2] = Math.sin(angle) * seed.radius;
  });
  beePositions.needsUpdate = true;
  runtime.hiveLight.intensity = 3.8 + Math.sin(time * 1.7) * 0.7;

  const bearRuntime = runtime.bear;
  bearRuntime.alienGlowMaterial.emissiveIntensity = 2.45 + Math.sin(time * 2.2) * 0.65;
  bearRuntime.spineMaterial.emissiveIntensity = 1.55 + Math.sin(time * 1.35 + 0.7) * 0.42;
  bearRuntime.antennaTips.forEach((tip, index) => {
    const pulse = 0.86 + Math.sin(time * 3.4 + index * 1.8) * 0.16;
    tip.scale.setScalar(pulse);
  });
  bearRuntime.dorsalSpines.forEach((spine, index) => {
    spine.rotation.z = Math.sin(time * 0.85 + index * 0.72) * 0.035;
  });
  const waypoint = runtime.bearWaypoints[runtime.bearWaypoint];
  const toWaypoint = waypoint.position.clone().sub(bearRuntime.root.position);
  const distance = toWaypoint.length();
  if (runtime.bearPause > 0) {
    runtime.bearPause -= dt;
    bearRuntime.head.rotation.x = THREE.MathUtils.damp(bearRuntime.head.rotation.x, Math.sin(time * 0.9) * 0.12 - 0.08, 3, dt);
  } else if (distance > 1.2) {
    const direction = toWaypoint.normalize();
    bearRuntime.root.position.addScaledVector(direction, dt * 2.25);
    bearRuntime.root.rotation.y = THREE.MathUtils.damp(bearRuntime.root.rotation.y, Math.atan2(-direction.x, -direction.z), 4, dt);
    bearRuntime.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(time * 5.1 + index * Math.PI) * 0.31; });
    bearRuntime.body.position.y = 3.15 + Math.sin(time * 10.2) * 0.09;
  } else {
    runtime.bearWaypoint = (runtime.bearWaypoint + 1 + Math.floor(Math.random() * (runtime.bearWaypoints.length - 1))) % runtime.bearWaypoints.length;
    runtime.bearPause = waypoint.pause + Math.random() * 4;
    runtime.bearActivity = waypoint.name;
    if (caveTravelZone === 'chamber' && distance < 1.2) showBanner(`MORROW IS ${runtime.bearActivity.toUpperCase()}`);
  }
  if (caveTravelZone === 'chamber') {
    const caveListenerPosition = travelMode === 'cave-walking' ? caveFootLocalPosition : caveLocalPosition;
    const playerDistance = bearRuntime.root.position.distanceTo(caveListenerPosition);
    if (playerDistance < 12) {
      const lookDirection = caveListenerPosition.clone().sub(bearRuntime.root.position);
      bearRuntime.head.rotation.y = THREE.MathUtils.damp(bearRuntime.head.rotation.y, Math.atan2(-lookDirection.x, -lookDirection.z) - bearRuntime.root.rotation.y, 3.5, dt);
    }
  }
}

function updateCaveAtmosphere(dt, listenerNormal) {
  let targetDarkness = caveTravelZone === 'surface' ? 0 : caveTravelZone === 'tunnel'
    ? THREE.MathUtils.smoothstep(caveRouteDistance, 0.5, 9)
    : 0.9;
  if (caveTravelZone === 'surface' && listenerNormal) {
    const entranceDistance = geodesicDistance(listenerNormal, NIGHTFALL_CAVE.normal);
    targetDarkness = (1 - THREE.MathUtils.smoothstep(entranceDistance, 0, 5)) * 0.2;
  }
  caveDarkness = THREE.MathUtils.damp(caveDarkness, targetDarkness, 5.5, dt);
  if (caveDarkness > 0.03) {
    caveFog.density = THREE.MathUtils.lerp(0.002, 0.0075, caveDarkness);
    scene.fog = caveFog;
  } else if (scene.fog === caveFog) scene.fog = null;
  if (targetDarkness > 0.55 && !caveWasInside) {
    caveWasInside = true;
    showBanner('GLOWSTONE ROAD · DESCENT LIGHTS ACTIVE');
  } else if (targetDarkness < 0.025 && caveWasInside) caveWasInside = false;
}

const hubRuntime = {};

function ensureAlienMountainHome() {
  if (hubRuntime.home?.loaded) return Promise.resolve(hubRuntime.home);
  try {
    const container = hubRuntime.home.group;
    const home = buildAlienMountainHouse({
      THREE,
      makeStandardMaterial: stdMat,
      makeLabelSprite,
      isTouchDevice,
      name: "ALIEN'S THARSIS HOME",
    });
    container.add(home.root);
    container.updateWorldMatrix(true, true);
    home.updateWorldAnchors();
    home.group = container;
    home.loaded = true;
    hubRuntime.home = home;
    return Promise.resolve(home);
  } catch (error) {
    console.error('Unable to load the alien mountain home', error);
    return Promise.resolve(null);
  }
}

HUBS.forEach((hub) => {
  hub.discovered = false;
  if (hub.key === 'outpost') hubRuntime[hub.key] = buildResearchOutpost(hub);
  if (hub.key === 'cavern') hubRuntime[hub.key] = buildCrystalCavern(hub);
  if (hub.key === 'planetarium') hubRuntime[hub.key] = buildMarsXenobiologyGlobe(hub);
  if (hub.key === 'crash') hubRuntime[hub.key] = buildCrashSite(hub);
  if (hub.key === 'nightfall') hubRuntime[hub.key] = buildNightfallCave(hub);
  if (hub.key === 'home') {
    const container = new THREE.Group();
    container.name = 'Alien mountain home · lazy region container';
    container.position.copy(surfaceWorldPosition(hub.normal, 0.12));
    container.quaternion.copy(surfaceVehicleQuaternion(hub.normal, ALIEN_HOME_APPROACH_HEADING));
    scene.add(container);
    hubRuntime[hub.key] = {
      root: container,
      group: container,
      local: null,
      loaded: false,
      updateWorldAnchors() {},
    };
  }
});
// Build the home while the loading screen is active. Deferring this 500-line
// procedural builder until the player crossed its streaming boundary caused a
// visible exploration freeze.
ensureAlienMountainHome();

function applyXenobiologyQuality(settings) {
  const xenobiology = hubRuntime.planetarium;
  if (!xenobiology) return;
  const useLowDetailModels = settings.materialQuality !== 'high';
  xenobiology.creatureRuntimes.forEach((runtime) => setLowDetailProxyEnabled(runtime, useLowDetailModels));
  xenobiology.aquariumWallFishRuntimes.forEach((runtime) => setLowDetailProxyEnabled(runtime, useLowDetailModels));
  xenobiology.fishRuntimes.forEach((runtime) => setLowDetailProxyEnabled(runtime, useLowDetailModels));
  setLowDetailProxyEnabled(xenobiology.museumMonkey, useLowDetailModels);
  setLowDetailProxyEnabled(xenobiology.aquariumSquid, useLowDetailModels);
  const showHighDetails = settings.materialQuality === 'high';
  const showAmbientDetails = settings.creatureDetail > 0.5;
  applyQualitySensitiveMaterials(xenobiology.qualitySensitiveMaterials, showHighDetails);
  xenobiology.highOnlyDetails.forEach((object) => { object.visible = showHighDetails; });
  xenobiology.lowHiddenDetails.forEach((object) => { object.visible = showAmbientDetails; });
}

applyXenobiologyQuality(qualitySettings);
qualityManager.subscribe(({ settings }) => applyXenobiologyQuality(settings), { emitCurrent: false });
setLoadingStage(63, 'LIGHTING THE UNDERMARS');

/* ---------- Mars–Moon shuttle infrastructure ---------- */

function buildLandingPad(position, normal, labelText, color) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.quaternion.setFromUnitVectors(UP, normal);

  const padMaterial = stdMat(0x242a32, { metalness: 0.76, roughness: 0.38 });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.2,
    metalness: 0.35,
    roughness: 0.28,
  });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 5.2, 0.38, 32), padMaterial);
  pad.position.y = 0.19;
  group.add(pad);

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(4.15, 0.1, 8, 48), glowMaterial);
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.42;
  group.add(outerRing);

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 1.2), glowMaterial);
    marker.position.set(Math.cos(angle) * 3.25, 0.43, Math.sin(angle) * 3.25);
    marker.rotation.y = -angle;
    group.add(marker);
  }

  const label = makeLabelSprite(labelText, `#${color.toString(16).padStart(6, '0')}`);
  label.position.set(0, 1.45, 4.6);
  label.scale.set(5.8, 1.18, 1);
  group.add(label);

  const padLight = new THREE.PointLight(color, 1.1, 18, 2);
  padLight.position.y = 2.2;
  group.add(padLight);
  scene.add(group);
  return { group, outerRing, glowMaterial, padLight };
}

const MARS_PAD_POSITION = surfaceWorldPosition(MARS_PORT.normal, 0.08);
const MOON_PAD_POSITION = MOON_CENTER.clone().addScaledVector(MOON_PAD_NORMAL, MOON_RADIUS + getMoonHeight(MOON_PAD_NORMAL) + 0.08);
const MARS_DOCK_POSITION = MARS_PAD_POSITION.clone().addScaledVector(MARS_PORT.normal, 0.42);
const MOON_DOCK_POSITION = MOON_PAD_POSITION.clone().addScaledVector(MOON_PAD_NORMAL, 0.42);

function surfaceVehicleQuaternion(normal, heading) {
  const right = heading.clone().cross(normal).normalize();
  const back = heading.clone().multiplyScalar(-1);
  const matrix = new THREE.Matrix4().makeBasis(right, normal, back);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

const MARS_BUS_HEADING = new THREE.Vector3(0, 0, -1).addScaledVector(MARS_PORT.normal, MARS_PORT.normal.z).normalize();
const MOON_BUS_HEADING = UP.clone().addScaledVector(MOON_PAD_NORMAL, -UP.dot(MOON_PAD_NORMAL)).normalize();
const MARS_DOCK_QUATERNION = surfaceVehicleQuaternion(MARS_PORT.normal, MARS_BUS_HEADING);
const MOON_DOCK_QUATERNION = surfaceVehicleQuaternion(MOON_PAD_NORMAL, MOON_BUS_HEADING);
const marsLandingPad = buildLandingPad(MARS_PAD_POSITION, MARS_PORT.normal, '', 0x68d9ff);
const moonLandingPad = buildLandingPad(MOON_PAD_POSITION, MOON_PAD_NORMAL, 'SPACE BUS · MARS', 0xffd38a);
addCollider(MARS_PORT.x, MARS_PORT.z, 4.9);

/* ---------- walk-in lunar command center ---------- */

const MOON_COMMAND_ARC_DISTANCE = 15;
const MOON_COMMAND_INTERACT_RADIUS = 5.6;
const MOON_COMMAND_NORMAL = stepWorldNormal(MOON_PAD_NORMAL, MOON_BUS_HEADING, MOON_COMMAND_ARC_DISTANCE, MOON_RADIUS);
const MOON_COMMAND_HEADING = MOON_PAD_NORMAL.clone()
  .addScaledVector(MOON_COMMAND_NORMAL, -MOON_PAD_NORMAL.dot(MOON_COMMAND_NORMAL))
  .normalize();
const MOON_COMMAND_RIGHT = MOON_COMMAND_HEADING.clone().cross(MOON_COMMAND_NORMAL).normalize();
const MOON_COMMAND_POSITION = MOON_CENTER.clone().addScaledVector(MOON_COMMAND_NORMAL, MOON_RADIUS + getMoonHeight(MOON_COMMAND_NORMAL) + 0.08);
const MOON_BIKE_DOCK_DIRECTION = MOON_BUS_HEADING.clone().applyAxisAngle(MOON_PAD_NORMAL, Math.PI * 0.56);
const MOON_BIKE_DOCK_NORMAL = stepWorldNormal(MOON_PAD_NORMAL, MOON_BIKE_DOCK_DIRECTION, 10.5, MOON_RADIUS);
const MOON_BIKE_HEADING = MOON_PAD_NORMAL.clone()
  .addScaledVector(MOON_BIKE_DOCK_NORMAL, -MOON_PAD_NORMAL.dot(MOON_BIKE_DOCK_NORMAL))
  .normalize();
const ZEPHYRA_BIKE_HEADING = UP.clone().addScaledVector(ZEPHYRA_PAD_NORMAL, -UP.dot(ZEPHYRA_PAD_NORMAL)).normalize();
let moonCommandSystemsActive = true;
let moonCommandDiscovered = false;
let moonCommandInterior = 0;

function buildMoonRegolithGeology() {
  const group = new THREE.Group();
  group.name = 'Lunar regolith · micro-craters and ejecta field';
  scene.add(group);

  let seed = 0x51f15e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const arcDistance = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * MOON_RADIUS;
  const routeSamples = Array.from({ length: 13 }, (_, index) => slerpNormals(MOON_PAD_NORMAL, MOON_COMMAND_NORMAL, index / 12));
  const isClearOfInfrastructure = (normal, extra = 0) => {
    if (arcDistance(normal, MOON_PAD_NORMAL) < 6.8 + extra) return false;
    if (arcDistance(normal, MOON_COMMAND_NORMAL) < 7.1 + extra) return false;
    if (arcDistance(normal, MOON_BIKE_DOCK_NORMAL) < 5.8 + extra) return false;
    return !routeSamples.some((sample) => arcDistance(normal, sample) < 2.65 + extra);
  };
  const tangentAt = (normal, angle) => {
    const reference = Math.abs(normal.y) < 0.88 ? UP : new THREE.Vector3(0, 0, -1);
    return reference.clone()
      .addScaledVector(normal, -reference.dot(normal))
      .normalize()
      .applyAxisAngle(normal, angle);
  };
  const randomAccessibleNormal = () => {
    const direction = MOON_BUS_HEADING.clone().applyAxisAngle(MOON_PAD_NORMAL, random() * Math.PI * 2);
    return stepWorldNormal(MOON_PAD_NORMAL, direction, 5 + Math.sqrt(random()) * 22, MOON_RADIUS);
  };

  const craterCount = isTouchDevice ? 18 : 28;
  const craters = [];
  for (let attempts = 0; craters.length < craterCount && attempts < 600; attempts++) {
    const normal = randomAccessibleNormal();
    const radius = 0.32 + Math.pow(random(), 1.7) * 1.35;
    if (!isClearOfInfrastructure(normal, radius * 0.65)) continue;
    if (craters.some((crater) => arcDistance(normal, crater.normal) < radius + crater.radius + 0.55)) continue;
    craters.push({
      normal,
      radius,
      stretch: 0.78 + random() * 0.42,
      twist: random() * Math.PI * 2,
      tone: 0.36 + random() * 0.18,
    });
  }

  const craterRimGeometry = new THREE.TorusGeometry(1, 0.14, 6, 18);
  craterRimGeometry.rotateX(Math.PI / 2);
  const craterFloorGeometry = new THREE.CircleGeometry(1, 20);
  craterFloorGeometry.rotateX(-Math.PI / 2);
  const craterRims = new THREE.InstancedMesh(
    craterRimGeometry,
    new THREE.MeshStandardMaterial({ color: 0xa39c96, roughness: 1, metalness: 0, flatShading: true }),
    craters.length
  );
  const craterFloors = new THREE.InstancedMesh(
    craterFloorGeometry,
    new THREE.MeshStandardMaterial({ color: 0x575256, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    craters.length
  );
  craterRims.name = 'Raised lunar micro-crater rims';
  craterFloors.name = 'Dark compacted crater floors';
  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  craters.forEach((crater, index) => {
    dummy.position.copy(MOON_CENTER).addScaledVector(crater.normal, MOON_RADIUS + getMoonHeight(crater.normal) + 0.045);
    dummy.quaternion.setFromUnitVectors(UP, crater.normal);
    dummy.rotateY(crater.twist);
    dummy.scale.set(crater.radius, 0.64 + crater.radius * 0.12, crater.radius * crater.stretch);
    dummy.updateMatrix();
    craterRims.setMatrixAt(index, dummy.matrix);
    craterRims.setColorAt(index, instanceColor.setHSL(0.075, 0.045, crater.tone + 0.17));

    dummy.position.copy(MOON_CENTER).addScaledVector(crater.normal, MOON_RADIUS + getMoonHeight(crater.normal) + 0.021);
    dummy.scale.set(crater.radius * 0.86, 1, crater.radius * crater.stretch * 0.86);
    dummy.updateMatrix();
    craterFloors.setMatrixAt(index, dummy.matrix);
    craterFloors.setColorAt(index, instanceColor.setHSL(0.82, 0.035, crater.tone));
  });
  craterRims.instanceMatrix.needsUpdate = true;
  craterFloors.instanceMatrix.needsUpdate = true;
  if (craterRims.instanceColor) craterRims.instanceColor.needsUpdate = true;
  if (craterFloors.instanceColor) craterFloors.instanceColor.needsUpdate = true;
  group.add(craterFloors, craterRims);

  const boulderGeometry = createProceduralRockGeometry({
    THREE,
    seed: 0x51f15e,
    detail: isTouchDevice ? 1 : 2,
    archetype: 'lunar',
  });

  const boulderCount = isTouchDevice ? 90 : 170;
  const boulders = new THREE.InstancedMesh(
    boulderGeometry,
    createProceduralRockMaterial({
      THREE,
      color: 0xffffff,
      seed: 0x51f15e,
      roughness: 0.98,
      bumpScale: 0.06,
      textureSize: isTouchDevice ? 64 : 96,
      dustColor: 0xb9b3aa,
      dustStrength: 0.14,
    }),
    boulderCount
  );
  boulders.name = 'Angular ejecta boulders';
  let placedBoulders = 0;
  for (let attempts = 0; placedBoulders < boulderCount && attempts < 1800; attempts++) {
    const ejectaCrater = random() < 0.72 ? craters[Math.floor(random() * craters.length)] : null;
    let normal;
    let scale;
    if (ejectaCrater) {
      const direction = tangentAt(ejectaCrater.normal, random() * Math.PI * 2);
      const scatterDistance = ejectaCrater.radius * (1.25 + Math.pow(random(), 0.68) * 3.6);
      normal = stepWorldNormal(ejectaCrater.normal, direction, scatterDistance, MOON_RADIUS);
      scale = 0.075 + random() * Math.min(0.42, ejectaCrater.radius * 0.38);
    } else {
      normal = randomAccessibleNormal();
      scale = 0.1 + Math.pow(random(), 2.2) * 0.72;
    }
    if (!isClearOfInfrastructure(normal, scale * 0.7)) continue;

    dummy.position.copy(MOON_CENTER).addScaledVector(normal, MOON_RADIUS + getMoonHeight(normal) + 0.035 + scale * 0.42);
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.5);
    dummy.scale.set(
      scale * (0.72 + random() * 0.55),
      scale * (0.62 + random() * 0.9),
      scale * (0.7 + random() * 0.62)
    );
    dummy.updateMatrix();
    boulders.setMatrixAt(placedBoulders, dummy.matrix);
    boulders.setColorAt(placedBoulders, instanceColor.setHSL(0.07, 0.035, 0.44 + random() * 0.2));
    placedBoulders += 1;
  }
  boulders.count = placedBoulders;
  boulders.instanceMatrix.needsUpdate = true;
  if (boulders.instanceColor) boulders.instanceColor.needsUpdate = true;
  group.add(boulders);

  return { group, craterRims, craterFloors, boulders, craterCount: craters.length, boulderCount: placedBoulders };
}

const moonRegolithGeology = buildMoonRegolithGeology();

const MOON_COLD_TRAP_HEADING = tangentHeadingForNormal(MOON_COLD_TRAP_NORMAL);
let moonColdTrapDiscovered = false;
let moonColdTrapProximity = 0;

function buildMoonColdTrap() {
  const group = new THREE.Group();
  group.name = 'PSR-01 permanently shadowed lunar cold trap';
  scene.add(group);

  let seed = 0xc01d7a9;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const tangentAt = (normal, angle) => tangentHeadingForNormal(normal).applyAxisAngle(normal, angle);
  const dummy = new THREE.Object3D();

  const iceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb9d9dc,
    emissive: 0x375d68,
    emissiveIntensity: 0.22,
    metalness: 0.08,
    roughness: 0.24,
    clearcoat: 0.72,
    clearcoatRoughness: 0.2,
    transparent: true,
    opacity: 0.82,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const iceCount = isTouchDevice ? 12 : 22;
  const icePatches = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), iceMaterial, iceCount);
  icePatches.name = 'Exposed lunar water-ice patches';
  for (let index = 0; index < iceCount; index++) {
    const direction = tangentAt(MOON_COLD_TRAP_NORMAL, random() * Math.PI * 2);
    const normal = stepWorldNormal(MOON_COLD_TRAP_NORMAL, direction, 0.35 + Math.sqrt(random()) * 1.75, MOON_RADIUS);
    dummy.position.copy(surfacePositionForWorld('moon', normal, 0.14));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.scale.set(0.28 + random() * 0.72, 1, 0.18 + random() * 0.52);
    dummy.updateMatrix();
    icePatches.setMatrixAt(index, dummy.matrix);
  }
  icePatches.instanceMatrix.needsUpdate = true;
  group.add(icePatches);

  const ejectaMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xc8c0b7,
    seed: 0xc01d7a9,
    roughness: 1,
    bumpScale: 0.05,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xbcb6ad,
    dustStrength: 0.13,
  });
  const ejectaCount = isTouchDevice ? 30 : 54;
  const ejecta = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0xc01d7a9,
      detail: 1,
      archetype: 'lunar',
      ruggedness: 0.85,
    }),
    ejectaMaterial,
    ejectaCount
  );
  ejecta.name = 'Radial cold-trap ejecta rays';
  let placed = 0;
  for (let attempts = 0; placed < ejectaCount && attempts < 700; attempts++) {
    const angle = random() * Math.PI * 2;
    const direction = tangentAt(MOON_COLD_TRAP_NORMAL, angle);
    const distance = MOON_COLD_TRAP_RADIUS * (1.05 + Math.pow(random(), 0.72) * 1.25);
    const normal = stepWorldNormal(MOON_COLD_TRAP_NORMAL, direction, distance, MOON_RADIUS);
    if (arcDistanceForWorld('moon', normal, MOON_PAD_NORMAL) < 6.5) continue;
    if (arcDistanceForWorld('moon', normal, MOON_COMMAND_NORMAL) < 6.4) continue;
    if (arcDistanceForWorld('moon', normal, MOON_BIKE_DOCK_NORMAL) < 5.3) continue;
    const outward = direction.clone().addScaledVector(normal, -direction.dot(normal)).normalize();
    dummy.position.copy(surfacePositionForWorld('moon', normal, 0.055));
    dummy.quaternion.copy(surfaceVehicleQuaternion(normal, outward.clone().multiplyScalar(-1)));
    const length = 0.48 + Math.pow(random(), 1.35) * 1.35;
    dummy.scale.set(0.08 + random() * 0.16, 0.035 + random() * 0.055, length);
    dummy.updateMatrix();
    ejecta.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  ejecta.count = placed;
  ejecta.instanceMatrix.needsUpdate = true;
  group.add(ejecta);

  const landmarkLabel = makeLabelSprite('PSR-01 · ICE COLD TRAP', '#a8e8f4');
  landmarkLabel.position.copy(surfacePositionForWorld('moon', MOON_COLD_TRAP_NORMAL, 6.15));
  landmarkLabel.scale.set(5.5, 0.98, 1);
  group.add(landmarkLabel);

  return { group, icePatches, iceMaterial, ejecta, landmarkLabel };
}

const moonColdTrapRuntime = buildMoonColdTrap();

function updateMoonColdTrap(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('moon', activePlayerNormal, MOON_COLD_TRAP_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 5.2, 14.5);
    if (!moonColdTrapDiscovered && distance < 7.4) {
      moonColdTrapDiscovered = true;
      showBanner('PSR-01 COLD TRAP DISCOVERED · WATER ICE SIGNATURE CONFIRMED');
    }
  }
  moonColdTrapProximity = THREE.MathUtils.damp(moonColdTrapProximity, targetProximity, 5, dt);
  moonColdTrapRuntime.iceMaterial.emissiveIntensity = 0.14 + (Math.sin(time * 1.45) * 0.5 + 0.5) * 0.13 + moonColdTrapProximity * 0.12;
  moonColdTrapRuntime.landmarkLabel.material.opacity = 0.46 + Math.sin(time * 1.2) * 0.08 + moonColdTrapProximity * 0.32;
}

let moonRayedCraterDiscovered = false;
let moonRayedCraterProximity = 0;

function buildMoonRayedCrater() {
  const group = new THREE.Group();
  group.name = 'Tycho Minor · rayed lunar impact crater and secondary chain';
  scene.add(group);

  let seed = 0x7ac401;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const tangentAt = (normal, angle) => tangentHeadingForNormal(normal).applyAxisAngle(normal, angle);
  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();

  const rimCount = isTouchDevice ? 34 : 58;
  const rimBlocks = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0x7ac401,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'lunar',
    }),
    createProceduralRockMaterial({
      THREE,
      color: 0xffffff,
      seed: 0x7ac401,
      roughness: 1,
      bumpScale: 0.065,
      textureSize: isTouchDevice ? 64 : 96,
      dustColor: 0xc4beb5,
      dustStrength: 0.13,
    }),
    rimCount
  );
  rimBlocks.name = 'Fresh blocky primary crater rim';
  for (let index = 0; index < rimCount; index++) {
    const angle = (index / rimCount) * Math.PI * 2 + (random() - 0.5) * 0.11;
    const direction = tangentAt(MOON_RAY_CRATER_NORMAL, angle);
    const distance = MOON_RAY_CRATER_RADIUS * (0.94 + random() * 0.15);
    const normal = stepWorldNormal(MOON_RAY_CRATER_NORMAL, direction, distance, MOON_RADIUS);
    const scale = 0.16 + Math.pow(random(), 1.75) * 0.58;
    dummy.position.copy(surfacePositionForWorld('moon', normal, scale * 0.3 + 0.04));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.38);
    dummy.scale.set(scale * (0.7 + random() * 0.72), scale * (0.62 + random() * 0.8), scale);
    dummy.updateMatrix();
    rimBlocks.setMatrixAt(index, dummy.matrix);
    rimBlocks.setColorAt(index, instanceColor.setHSL(0.075, 0.025, 0.55 + random() * 0.2));
  }
  rimBlocks.instanceMatrix.needsUpdate = true;
  if (rimBlocks.instanceColor) rimBlocks.instanceColor.needsUpdate = true;
  group.add(rimBlocks);

  const rayCount = isTouchDevice ? 48 : 86;
  const rayMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0x7ac4e17,
    roughness: 1,
    bumpScale: 0.045,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xd0cac1,
    dustStrength: 0.14,
  });
  const rayFragments = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0x7ac4e17,
      detail: 1,
      archetype: 'lunar',
      ruggedness: 0.78,
    }),
    rayMaterial,
    rayCount
  );
  rayFragments.name = 'High-albedo radial ejecta rays';
  const rayAngles = [-2.72, -1.86, -0.91, -0.12, 0.77, 1.58, 2.42];
  for (let index = 0; index < rayCount; index++) {
    const rayAngle = rayAngles[index % rayAngles.length] + (random() - 0.5) * 0.1;
    const direction = tangentAt(MOON_RAY_CRATER_NORMAL, rayAngle);
    const distance = MOON_RAY_CRATER_RADIUS * 1.08 + Math.pow(random(), 0.66) * 10.2;
    const normal = stepWorldNormal(MOON_RAY_CRATER_NORMAL, direction, distance, MOON_RADIUS);
    const outward = direction.clone().addScaledVector(normal, -direction.dot(normal)).normalize();
    const length = 0.34 + Math.pow(random(), 1.2) * 1.25;
    dummy.position.copy(surfacePositionForWorld('moon', normal, 0.035));
    dummy.quaternion.copy(surfaceVehicleQuaternion(normal, outward.clone().multiplyScalar(-1)));
    dummy.scale.set(0.055 + random() * 0.15, 0.025 + random() * 0.045, length);
    dummy.updateMatrix();
    rayFragments.setMatrixAt(index, dummy.matrix);
    rayFragments.setColorAt(index, instanceColor.setHSL(0.07, 0.02, 0.68 + random() * 0.18));
  }
  rayFragments.instanceMatrix.needsUpdate = true;
  if (rayFragments.instanceColor) rayFragments.instanceColor.needsUpdate = true;
  group.add(rayFragments);

  const secondaryRims = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.11, 6, 22).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xbdb7ae, roughness: 1, flatShading: true }),
    MOON_SECONDARY_CRATERS.length
  );
  const secondaryFloors = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x504d50, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    MOON_SECONDARY_CRATERS.length
  );
  MOON_SECONDARY_CRATERS.forEach((crater, index) => {
    dummy.position.copy(surfacePositionForWorld('moon', crater.normal, 0.045));
    dummy.quaternion.setFromUnitVectors(UP, crater.normal);
    dummy.scale.set(crater.radius, 0.7, crater.radius * (0.83 + index * 0.035));
    dummy.updateMatrix();
    secondaryRims.setMatrixAt(index, dummy.matrix);
    dummy.position.copy(surfacePositionForWorld('moon', crater.normal, 0.018));
    dummy.scale.set(crater.radius * 0.84, 1, crater.radius * (0.7 + index * 0.03));
    dummy.updateMatrix();
    secondaryFloors.setMatrixAt(index, dummy.matrix);
  });
  secondaryRims.instanceMatrix.needsUpdate = true;
  secondaryFloors.instanceMatrix.needsUpdate = true;
  group.add(secondaryFloors, secondaryRims);

  const peakCount = isTouchDevice ? 6 : 10;
  const centralPeaks = new THREE.InstancedMesh(
    createProceduralRockGeometry({
      THREE,
      seed: 0x7ac4f34,
      detail: isTouchDevice ? 1 : 2,
      archetype: 'lunar',
      ruggedness: 1.12,
    }),
    createProceduralRockMaterial({
      THREE,
      color: 0xd0c9c0,
      seed: 0x7ac4f34,
      roughness: 0.98,
      bumpScale: 0.065,
      textureSize: isTouchDevice ? 64 : 96,
      dustColor: 0xc8c2b9,
      dustStrength: 0.11,
    }),
    peakCount
  );
  for (let index = 0; index < peakCount; index++) {
    const direction = tangentAt(MOON_RAY_CRATER_NORMAL, random() * Math.PI * 2);
    const normal = stepWorldNormal(MOON_RAY_CRATER_NORMAL, direction, random() * 0.62, MOON_RADIUS);
    const height = 0.34 + random() * 0.78;
    dummy.position.copy(surfacePositionForWorld('moon', normal, height * 0.42));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.scale.set(0.2 + random() * 0.34, height, 0.2 + random() * 0.3);
    dummy.updateMatrix();
    centralPeaks.setMatrixAt(index, dummy.matrix);
  }
  centralPeaks.instanceMatrix.needsUpdate = true;
  group.add(centralPeaks);

  const landmarkLabel = makeLabelSprite('TYCHO MINOR · RAYED CRATER', '#ded8ce');
  landmarkLabel.position.copy(surfacePositionForWorld('moon', MOON_RAY_CRATER_NORMAL, 6.8));
  landmarkLabel.scale.set(5.9, 1.05, 1);
  group.add(landmarkLabel);

  return { group, rimBlocks, rayFragments, rayMaterial, secondaryRims, secondaryFloors, centralPeaks, landmarkLabel };
}

const moonRayedCraterRuntime = buildMoonRayedCrater();

function updateMoonRayedCrater(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('moon', activePlayerNormal, MOON_RAY_CRATER_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 5.4, 15.5);
    if (!moonRayedCraterDiscovered && distance < 8.1) {
      moonRayedCraterDiscovered = true;
      showBanner('TYCHO MINOR DISCOVERED · FRESH RAY SYSTEM AND SECONDARY IMPACTS');
    }
  }
  moonRayedCraterProximity = THREE.MathUtils.damp(moonRayedCraterProximity, targetProximity, 5, dt);
  moonRayedCraterRuntime.rayMaterial.emissive.setHex(0x161311);
  moonRayedCraterRuntime.rayMaterial.emissiveIntensity = 0.04 + moonRayedCraterProximity * 0.08;
  moonRayedCraterRuntime.landmarkLabel.material.opacity = 0.46 + Math.sin(time * 0.9) * 0.06 + moonRayedCraterProximity * 0.34;
}

/* ---------- Zephyra hyperspeed electric bike ---------- */

const MOON_BIKE_PAD_POSITION = MOON_CENTER.clone().addScaledVector(MOON_BIKE_DOCK_NORMAL, MOON_RADIUS + getMoonHeight(MOON_BIKE_DOCK_NORMAL) + 0.08);
const ZEPHYRA_BIKE_PAD_POSITION = ZEPHYRA_CENTER.clone().addScaledVector(
  ZEPHYRA_PAD_NORMAL,
  ZEPHYRA_RADIUS + getZephyraHeight(ZEPHYRA_PAD_NORMAL) + 0.08
);
const MOON_BIKE_DOCK_POSITION = MOON_BIKE_PAD_POSITION.clone().addScaledVector(MOON_BIKE_DOCK_NORMAL, 0.42);
const ZEPHYRA_BIKE_DOCK_POSITION = ZEPHYRA_BIKE_PAD_POSITION.clone().addScaledVector(ZEPHYRA_PAD_NORMAL, 0.42);
const MOON_BIKE_DOCK_QUATERNION = surfaceVehicleQuaternion(MOON_BIKE_DOCK_NORMAL, MOON_BIKE_HEADING);
const ZEPHYRA_BIKE_DOCK_QUATERNION = surfaceVehicleQuaternion(ZEPHYRA_PAD_NORMAL, ZEPHYRA_BIKE_HEADING);
const moonBikeLandingPad = buildLandingPad(MOON_BIKE_PAD_POSITION, MOON_BIKE_DOCK_NORMAL, 'VOLT BIKE · ZEPHYRA', 0x78ffe2);
const zephyraBikeLandingPad = buildLandingPad(ZEPHYRA_BIKE_PAD_POSITION, ZEPHYRA_PAD_NORMAL, 'VOLT BIKE · MOON', 0xb38cff);

function buildHyperBike() {
  const bike = new THREE.Group();
  bike.name = 'Voltwing hyperspeed electric space bike';
  const frame = stdMat(0x111b29, { metalness: 0.86, roughness: 0.24 });
  const shell = stdMat(0x7454f5, { metalness: 0.52, roughness: 0.25 });
  const chrome = stdMat(0xc7f7ff, { metalness: 0.9, roughness: 0.12 });
  const electricMaterial = new THREE.MeshStandardMaterial({
    color: 0x72ffe0,
    emissive: 0x34e7d0,
    emissiveIntensity: 2.2,
    metalness: 0.28,
    roughness: 0.18,
  });

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 2.85), frame);
  spine.position.y = 1.05;
  bike.add(spine);
  const battery = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.05, 7, 16), shell);
  battery.rotation.x = Math.PI / 2;
  battery.position.set(0, 1.16, 0.22);
  bike.add(battery);

  const wheelRings = [];
  [-1.5, 1.5].forEach((z) => {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.105, 8, 32), electricMaterial);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.83, z);
    bike.add(wheel);
    wheelRings.push(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 12), chrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    bike.add(hub);
  });

  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.42, 8), chrome);
  fork.position.set(0, 1.38, -1.45);
  fork.rotation.x = -0.28;
  bike.add(fork);
  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 8), chrome);
  handlebar.rotation.z = Math.PI / 2;
  handlebar.position.set(0, 1.98, -1.66);
  bike.add(handlebar);
  [-0.62, 0.62].forEach((x) => {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 10), frame);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(x, 1.98, -1.66);
    bike.add(grip);
  });

  const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.72, 6, 14), stdMat(0x17151f, { roughness: 0.58 }));
  saddle.rotation.x = Math.PI / 2;
  saddle.scale.x = 1.45;
  saddle.position.set(0, 1.68, 0.48);
  bike.add(saddle);

  const electricCore = new THREE.Mesh(new THREE.SphereGeometry(0.29, 18, 12), electricMaterial);
  electricCore.position.set(0, 1.12, 0.1);
  bike.add(electricCore);
  const headlight = new THREE.PointLight(0x84ffe6, 3.2, 16, 2);
  headlight.position.set(0, 1.42, -1.76);
  bike.add(headlight);

  const bikeSeat = new THREE.Group();
  bikeSeat.position.set(0, 1.74, 0.42);
  bike.add(bikeSeat);

  const warpTail = new THREE.Group();
  for (let index = 0; index < 5; index++) {
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.34 - index * 0.035, 2.6 + index * 0.72, 10),
      new THREE.MeshBasicMaterial({
        color: index % 2 ? 0xa983ff : 0x6effe1,
        transparent: true,
        opacity: 0.34 - index * 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    tail.rotation.x = Math.PI / 2;
    tail.position.set((index - 2) * 0.12, 1.02 + Math.sin(index) * 0.08, 2.55 + index * 0.4);
    warpTail.add(tail);
  }
  warpTail.visible = false;
  bike.add(warpTail);

  bike.position.copy(MOON_BIKE_DOCK_POSITION);
  bike.quaternion.copy(MOON_BIKE_DOCK_QUATERNION);
  scene.add(bike);
  return { bike, bikeSeat, wheelRings, electricCore, electricMaterial, headlight, warpTail };
}

const hyperBikeRuntime = buildHyperBike();
const hyperBike = hyperBikeRuntime.bike;

/* ---------- Zephyra resonance spires & electric storm ---------- */

const ZEPHYRA_SPIRE_DIRECTION = ZEPHYRA_BIKE_HEADING.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, -0.84);
const ZEPHYRA_SPIRE_NORMAL = stepWorldNormal(ZEPHYRA_PAD_NORMAL, ZEPHYRA_SPIRE_DIRECTION, 14.2, ZEPHYRA_RADIUS);
const ZEPHYRA_SPIRE_HEADING = ZEPHYRA_PAD_NORMAL.clone()
  .addScaledVector(ZEPHYRA_SPIRE_NORMAL, -ZEPHYRA_PAD_NORMAL.dot(ZEPHYRA_SPIRE_NORMAL))
  .normalize();
const ZEPHYRA_SPIRE_RIGHT = ZEPHYRA_SPIRE_HEADING.clone().cross(ZEPHYRA_SPIRE_NORMAL).normalize();
const ZEPHYRA_FLUX_DIRECTION = ZEPHYRA_BIKE_HEADING.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, 2.08);
const ZEPHYRA_FLUX_NORMAL = stepWorldNormal(ZEPHYRA_PAD_NORMAL, ZEPHYRA_FLUX_DIRECTION, 18.4, ZEPHYRA_RADIUS);
const ZEPHYRA_AURORA_DIRECTION = ZEPHYRA_BIKE_HEADING.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, -2.42);
const ZEPHYRA_AURORA_NORMAL = stepWorldNormal(ZEPHYRA_PAD_NORMAL, ZEPHYRA_AURORA_DIRECTION, 19.6, ZEPHYRA_RADIUS);
const ZEPHYRA_GROVE_DIRECTION = ZEPHYRA_BIKE_HEADING.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, 1.42);
const ZEPHYRA_GROVE_NORMAL = stepWorldNormal(ZEPHYRA_PAD_NORMAL, ZEPHYRA_GROVE_DIRECTION, 13.8, ZEPHYRA_RADIUS);
let zephyraSpireDiscovered = false;
let zephyraStormProximity = 0;
let zephyraCanyonDiscovered = false;
let zephyraCanyonProximity = 0;
let zephyraFluxDiscovered = false;
let zephyraFluxProximity = 0;
let zephyraAuroraDiscovered = false;
let zephyraAuroraProximity = 0;
let zephyraGroveDiscovered = false;
let zephyraGroveProximity = 0;
let zephyraGroveArrivalCharge = 0;

function buildZephyraStormField() {
  const group = new THREE.Group();
  group.name = 'Zephyra · Resonance Spire electric storm field';
  scene.add(group);

  let seed = 0xe1ec7a;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const arcDistance = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * ZEPHYRA_RADIUS;
  const tangentAt = (normal, angle) => {
    const reference = Math.abs(normal.y) < 0.88 ? UP : new THREE.Vector3(0, 0, -1);
    return reference.clone().addScaledVector(normal, -reference.dot(normal)).normalize().applyAxisAngle(normal, angle);
  };

  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: 0x6debd2,
    emissive: 0x234f72,
    emissiveIntensity: 1.05,
    metalness: 0.24,
    roughness: 0.24,
    flatShading: true,
  });
  const crystalCount = isTouchDevice ? 58 : 108;
  const crystals = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 1, 6), crystalMaterial, crystalCount);
  crystals.name = 'Resonant crystal geology';
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0;
  for (let attempts = 0; placed < crystalCount && attempts < 1400; attempts++) {
    let normal;
    let height;
    if (placed < 24) {
      const direction = tangentAt(ZEPHYRA_SPIRE_NORMAL, random() * Math.PI * 2);
      normal = stepWorldNormal(ZEPHYRA_SPIRE_NORMAL, direction, Math.pow(random(), 0.72) * 5.2, ZEPHYRA_RADIUS);
      height = 1.8 + Math.pow(random(), 0.58) * 6.4;
    } else {
      const direction = ZEPHYRA_BIKE_HEADING.clone().applyAxisAngle(ZEPHYRA_PAD_NORMAL, random() * Math.PI * 2);
      normal = stepWorldNormal(ZEPHYRA_PAD_NORMAL, direction, 7 + Math.sqrt(random()) * 22, ZEPHYRA_RADIUS);
      height = 0.45 + Math.pow(random(), 2.1) * 3.8;
    }
    if (arcDistance(normal, ZEPHYRA_PAD_NORMAL) < 6.5) continue;
    const width = 0.16 + height * (0.055 + random() * 0.035);
    dummy.position.copy(surfacePositionForWorld('zephyra', normal, height * 0.48));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.16);
    dummy.scale.set(width * (0.78 + random() * 0.5), height, width * (0.78 + random() * 0.5));
    dummy.updateMatrix();
    crystals.setMatrixAt(placed, dummy.matrix);
    crystals.setColorAt(placed, color.setHSL(0.43 + random() * 0.23, 0.72, 0.46 + Math.min(0.24, height * 0.025)));
    placed += 1;
  }
  crystals.count = placed;
  crystals.instanceMatrix.needsUpdate = true;
  if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
  group.add(crystals);

  const pathCount = 9;
  const pathMaterial = new THREE.MeshStandardMaterial({
    color: 0xc596ff,
    emissive: 0x814dff,
    emissiveIntensity: 1.5,
    roughness: 0.34,
  });
  const pathMarkers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 12), pathMaterial, pathCount);
  for (let index = 0; index < pathCount; index++) {
    const normal = slerpNormals(ZEPHYRA_PAD_NORMAL, ZEPHYRA_SPIRE_NORMAL, (index + 1) / (pathCount + 1));
    dummy.position.copy(surfacePositionForWorld('zephyra', normal, 0.065));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    pathMarkers.setMatrixAt(index, dummy.matrix);
  }
  pathMarkers.instanceMatrix.needsUpdate = true;
  group.add(pathMarkers);

  const shardMaterial = new THREE.MeshStandardMaterial({
    color: 0xb19aff,
    emissive: 0x5930d8,
    emissiveIntensity: 1.6,
    metalness: 0.38,
    roughness: 0.2,
    flatShading: true,
  });
  const floatingShards = [];
  for (let index = 0; index < (isTouchDevice ? 9 : 16); index++) {
    const direction = tangentAt(ZEPHYRA_SPIRE_NORMAL, random() * Math.PI * 2);
    const normal = stepWorldNormal(ZEPHYRA_SPIRE_NORMAL, direction, 2.1 + random() * 5.8, ZEPHYRA_RADIUS);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.42 + random() * 0.48, 0), shardMaterial);
    shard.scale.set(0.6 + random() * 0.55, 1.1 + random() * 1.65, 0.62 + random() * 0.52);
    group.add(shard);
    floatingShards.push({
      mesh: shard,
      normal,
      altitude: 1.7 + random() * 4.2,
      phase: random() * Math.PI * 2,
      spin: 0.25 + random() * 0.75,
    });
  }

  const boltMaterial = new THREE.LineBasicMaterial({
    color: 0xd9faff,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lightningBolts = [];
  for (let index = 0; index < 3; index++) {
    const direction = tangentAt(ZEPHYRA_SPIRE_NORMAL, index * (Math.PI * 2 / 3) + 0.45);
    const targetNormal = stepWorldNormal(ZEPHYRA_SPIRE_NORMAL, direction, 1.4 + index * 1.1, ZEPHYRA_RADIUS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
    const bolt = new THREE.Line(geometry, boltMaterial.clone());
    const glow = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xbff9ff,
        size: 0.34,
        transparent: true,
        opacity: 0.84,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    bolt.visible = false;
    glow.visible = false;
    group.add(bolt, glow);
    lightningBolts.push({ line: bolt, glow, targetNormal, phase: index * 1.73 });
  }

  const stormLight = new THREE.PointLight(0xc5ecff, 0, 42, 2);
  stormLight.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_SPIRE_NORMAL, 7));
  group.add(stormLight);
  const landmarkLabel = makeLabelSprite('RESONANCE SPIRES', '#bca0ff');
  landmarkLabel.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_SPIRE_NORMAL, 8.6));
  landmarkLabel.scale.set(5.4, 1.02, 1);
  group.add(landmarkLabel);

  return { group, crystals, crystalMaterial, pathMarkers, pathMaterial, floatingShards, shardMaterial, lightningBolts, stormLight, landmarkLabel };
}

const zephyraStormRuntime = buildZephyraStormField();
const zephyraBoltPoint = new THREE.Vector3();
const zephyraBoltTop = new THREE.Vector3();
const zephyraBoltBottom = new THREE.Vector3();
let zephyraBoltFrame = -1;

function regenerateZephyraBolt(bolt, time) {
  const positions = bolt.line.geometry.attributes.position;
  zephyraBoltBottom.copy(surfacePositionForWorld('zephyra', bolt.targetNormal, 1.8));
  zephyraBoltTop.copy(zephyraBoltBottom).addScaledVector(bolt.targetNormal, 9.5 + Math.sin(time * 1.7 + bolt.phase) * 1.3);
  const tangent = tangentHeadingForNormal(bolt.targetNormal);
  const right = tangent.clone().cross(bolt.targetNormal).normalize();
  for (let index = 0; index < positions.count; index++) {
    const progress = index / (positions.count - 1);
    const jitter = Math.sin(progress * Math.PI);
    zephyraBoltPoint.copy(zephyraBoltTop).lerp(zephyraBoltBottom, progress)
      .addScaledVector(tangent, (Math.random() - 0.5) * jitter * 1.05)
      .addScaledVector(right, (Math.random() - 0.5) * jitter * 1.05);
    positions.setXYZ(index, zephyraBoltPoint.x, zephyraBoltPoint.y, zephyraBoltPoint.z);
  }
  positions.needsUpdate = true;
}

function updateZephyraStorm(dt, time, activePlayerNormal) {
  const stormWave = Math.sin(time * 2.05) + Math.sin(time * 7.7) * 0.62 + Math.sin(time * 13.1) * 0.28;
  const flash = Math.pow(Math.max(0, stormWave - 0.82), 2);
  const frame = Math.floor(time * 13);
  if (flash > 0.015 && frame !== zephyraBoltFrame) {
    zephyraBoltFrame = frame;
    zephyraStormRuntime.lightningBolts.forEach((bolt) => regenerateZephyraBolt(bolt, time));
  }
  zephyraStormRuntime.lightningBolts.forEach((bolt, index) => {
    const visible = flash > 0.02 && (index === 0 || Math.sin(time * 11 + bolt.phase) > 0.15);
    bolt.line.visible = visible;
    bolt.glow.visible = visible;
    bolt.line.material.opacity = THREE.MathUtils.clamp(0.28 + flash * 0.72, 0, 1);
    bolt.glow.material.opacity = THREE.MathUtils.clamp(0.22 + flash * 0.78, 0, 1);
  });
  zephyraStormRuntime.stormLight.intensity = Math.min(24, flash * 16);
  zephyraStormRuntime.crystalMaterial.emissiveIntensity = 0.82 + Math.sin(time * 2.4) * 0.2 + flash * 1.8;
  zephyraStormRuntime.pathMaterial.emissiveIntensity = 1.25 + Math.sin(time * 3.3) * 0.28 + flash;
  zephyraStormRuntime.shardMaterial.emissiveIntensity = 1.2 + Math.sin(time * 2.9) * 0.35 + flash * 1.4;
  zephyraStormRuntime.floatingShards.forEach((shard) => {
    shard.mesh.position.copy(surfacePositionForWorld('zephyra', shard.normal, shard.altitude + Math.sin(time * 1.15 + shard.phase) * 0.38));
    shard.mesh.rotation.x += dt * shard.spin * 0.68;
    shard.mesh.rotation.y += dt * shard.spin;
  });

  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('zephyra', activePlayerNormal, ZEPHYRA_SPIRE_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 6, 18);
    if (!zephyraSpireDiscovered && distance < 9) {
      zephyraSpireDiscovered = true;
      showBanner('RESONANCE SPIRES DISCOVERED · ELECTRIC FIELD ACTIVE');
    }
  }
  zephyraStormProximity = THREE.MathUtils.damp(zephyraStormProximity, targetProximity, 5, dt);
  zephyraStormRuntime.landmarkLabel.material.opacity = 0.58 + Math.sin(time * 1.7) * 0.12 + zephyraStormProximity * 0.22;
}

function buildZephyraIonCanyon() {
  const group = new THREE.Group();
  group.name = 'Zephyra · Ion Glass Canyon';
  scene.add(group);

  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x24465d,
    emissive: 0x1e8f9b,
    emissiveIntensity: 1.15,
    metalness: 0.62,
    roughness: 0.18,
    flatShading: true,
  });
  const shardCount = isTouchDevice ? 32 : 58;
  const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), glassMaterial, shardCount);
  shards.name = 'Ion-glass canyon rim outcrops';
  const dummy = new THREE.Object3D();
  const along = new THREE.Vector3();
  const across = new THREE.Vector3();
  const color = new THREE.Color();
  let seed = 0x10c4a55;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let index = 0; index < shardCount; index++) {
    const sampleIndex = Math.min(
      ZEPHYRA_CANYON_SAMPLES.length - 1,
      Math.floor((index / Math.max(1, shardCount - 1)) * ZEPHYRA_CANYON_SAMPLES.length)
    );
    const normal = ZEPHYRA_CANYON_SAMPLES[sampleIndex];
    const previous = ZEPHYRA_CANYON_SAMPLES[Math.max(0, sampleIndex - 1)];
    const next = ZEPHYRA_CANYON_SAMPLES[Math.min(ZEPHYRA_CANYON_SAMPLES.length - 1, sampleIndex + 1)];
    along.copy(next).sub(previous);
    along.addScaledVector(normal, -along.dot(normal)).normalize();
    across.copy(along).cross(normal).normalize();
    const side = index % 2 === 0 ? -1 : 1;
    const edgeNormal = stepWorldNormal(normal, across, side * (2.35 + random() * 0.72), ZEPHYRA_RADIUS);
    const height = 0.42 + Math.pow(random(), 1.8) * 2.7;
    dummy.position.copy(surfacePositionForWorld('zephyra', edgeNormal, height * 0.46));
    dummy.quaternion.setFromUnitVectors(UP, edgeNormal);
    dummy.rotateY(random() * Math.PI * 2);
    dummy.rotateX((random() - 0.5) * 0.34);
    dummy.scale.set(
      0.16 + height * (0.09 + random() * 0.045),
      height,
      0.16 + height * (0.085 + random() * 0.05)
    );
    dummy.updateMatrix();
    shards.setMatrixAt(index, dummy.matrix);
    shards.setColorAt(index, color.setHSL(0.47 + random() * 0.08, 0.72, 0.38 + random() * 0.2));
  }
  shards.instanceMatrix.needsUpdate = true;
  if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
  group.add(shards);

  const seamPositions = new Float32Array(ZEPHYRA_CANYON_SAMPLES.length * 3);
  ZEPHYRA_CANYON_SAMPLES.forEach((normal, index) => {
    const position = surfacePositionForWorld('zephyra', normal, 0.075);
    seamPositions[index * 3] = position.x;
    seamPositions[index * 3 + 1] = position.y;
    seamPositions[index * 3 + 2] = position.z;
  });
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.BufferAttribute(seamPositions, 3));
  const seamMaterial = new THREE.LineBasicMaterial({
    color: 0x80fff0,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const energizedSeam = new THREE.Line(seamGeometry, seamMaterial);
  energizedSeam.name = 'Energized canyon floor fracture';
  group.add(energizedSeam);

  const landmarkLabel = makeLabelSprite('ION GLASS CANYON', '#7ffff0');
  landmarkLabel.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_CANYON_NORMAL, 6.2));
  landmarkLabel.scale.set(5.2, 0.96, 1);
  group.add(landmarkLabel);

  return { group, shards, glassMaterial, energizedSeam, seamMaterial, landmarkLabel };
}

const zephyraCanyonRuntime = buildZephyraIonCanyon();

function distanceToZephyraCanyon(normal) {
  let closestDot = -1;
  for (const sample of ZEPHYRA_CANYON_SAMPLES) closestDot = Math.max(closestDot, normal.dot(sample));
  return Math.acos(THREE.MathUtils.clamp(closestDot, -1, 1)) * ZEPHYRA_RADIUS;
}

function updateZephyraIonCanyon(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = distanceToZephyraCanyon(activePlayerNormal);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 4.5, 13.5);
    if (!zephyraCanyonDiscovered && distance < 7.2) {
      zephyraCanyonDiscovered = true;
      showBanner('ION GLASS CANYON DISCOVERED · FRACTURE CURRENT DETECTED');
    }
  }
  zephyraCanyonProximity = THREE.MathUtils.damp(zephyraCanyonProximity, targetProximity, 5, dt);
  const pulse = Math.sin(time * 3.6) * 0.5 + 0.5;
  zephyraCanyonRuntime.glassMaterial.emissiveIntensity = 0.82 + pulse * 0.72 + zephyraCanyonProximity * 0.55;
  zephyraCanyonRuntime.seamMaterial.opacity = 0.18 + pulse * 0.24 + zephyraCanyonProximity * 0.22;
  zephyraCanyonRuntime.landmarkLabel.material.opacity = 0.48 + Math.sin(time * 1.45) * 0.1 + zephyraCanyonProximity * 0.3;
}

function buildZephyraFluxWell() {
  const group = new THREE.Group();
  group.name = 'Zephyra · Flux Well magnetic anomaly';
  group.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_FLUX_NORMAL, 0.08));
  group.quaternion.setFromUnitVectors(UP, ZEPHYRA_FLUX_NORMAL);
  scene.add(group);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x090814,
    emissive: 0x371582,
    emissiveIntensity: 1.15,
    metalness: 0.96,
    roughness: 0.14,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), coreMaterial);
  core.scale.y = 0.42;
  core.position.y = 0.32;
  group.add(core);

  const groundRingMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b2870,
    emissive: 0x7a3cff,
    emissiveIntensity: 1.6,
    metalness: 0.54,
    roughness: 0.22,
  });
  const groundRings = [];
  [1.48, 2.28, 3.18].forEach((radius, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.075 - index * 0.012, 7, 56), groundRingMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08 + index * 0.025;
    group.add(ring);
    groundRings.push(ring);
  });

  const fieldMaterial = new THREE.MeshBasicMaterial({
    color: 0xa77aff,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fieldRings = [];
  for (let index = 0; index < 4; index++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.65 + index * 0.48, 0.035, 5, 72), fieldMaterial.clone());
    ring.position.y = 2.8;
    ring.rotation.set(index * 0.72 + 0.24, index * 0.91, index * 0.43);
    group.add(ring);
    fieldRings.push(ring);
  }

  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: 0x302b45,
    emissive: 0x4a2387,
    emissiveIntensity: 0.42,
    metalness: 0.72,
    roughness: 0.38,
    flatShading: false,
  });
  const debris = [];
  let seed = 0xf10a7e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < (isTouchDevice ? 8 : 14); index++) {
    const radius = 1.85 + random() * 3.2;
    const rockScale = 0.18 + random() * 0.38;
    const rock = new THREE.Mesh(
      createProceduralRockGeometry({
        THREE,
        seed: 0xf10a7e + index * 809,
        detail: isTouchDevice ? 1 : 2,
        archetype: 'basalt',
        ruggedness: 1.08,
      }),
      debrisMaterial
    );
    rock.scale.set(
      rockScale * (0.62 + random() * 1.1),
      rockScale * (0.72 + random() * 1.5),
      rockScale * (0.64 + random() * 1.15)
    );
    group.add(rock);
    debris.push({
      mesh: rock,
      radius,
      altitude: 1.2 + random() * 3.9,
      phase: random() * Math.PI * 2,
      speed: (0.22 + random() * 0.42) * (index % 2 ? 1 : -1),
      spin: 0.35 + random() * 1.1,
    });
  }

  const fluxLight = new THREE.PointLight(0x9a62ff, 7.5, 19, 2);
  fluxLight.position.y = 2.4;
  group.add(fluxLight);
  const landmarkLabel = makeLabelSprite('FLUX WELL · MAGNETIC ANOMALY', '#c6a8ff');
  landmarkLabel.position.set(0, 7.4, 0);
  landmarkLabel.scale.set(6.2, 1.02, 1);
  group.add(landmarkLabel);

  return { group, core, coreMaterial, groundRings, groundRingMaterial, fieldRings, debris, debrisMaterial, fluxLight, landmarkLabel };
}

const zephyraFluxRuntime = buildZephyraFluxWell();

function updateZephyraFluxWell(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('zephyra', activePlayerNormal, ZEPHYRA_FLUX_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 4.2, 15.5);
    if (!zephyraFluxDiscovered && distance < 8.4) {
      zephyraFluxDiscovered = true;
      showBanner('FLUX WELL DISCOVERED · MAGNETIC GRAVITY DISTORTION');
    }
  }
  zephyraFluxProximity = THREE.MathUtils.damp(zephyraFluxProximity, targetProximity, 5, dt);
  const pulse = Math.sin(time * 2.6) * 0.5 + 0.5;
  zephyraFluxRuntime.core.scale.y = 0.38 + pulse * 0.1;
  zephyraFluxRuntime.core.rotation.y -= dt * 0.9;
  zephyraFluxRuntime.coreMaterial.emissiveIntensity = 0.85 + pulse * 0.75 + zephyraFluxProximity * 0.6;
  zephyraFluxRuntime.groundRingMaterial.emissiveIntensity = 1.15 + pulse * 0.8 + zephyraFluxProximity * 0.55;
  zephyraFluxRuntime.groundRings.forEach((ring, index) => {
    const scale = 1 + Math.sin(time * (1.65 + index * 0.19) + index * 1.8) * 0.035;
    ring.scale.setScalar(scale);
    ring.rotation.z += dt * (index % 2 ? -0.12 : 0.16);
  });
  zephyraFluxRuntime.fieldRings.forEach((ring, index) => {
    ring.rotation.y += dt * (0.2 + index * 0.075) * (index % 2 ? -1 : 1);
    ring.rotation.z += dt * (0.08 + index * 0.03);
    ring.material.opacity = 0.1 + pulse * 0.12 + zephyraFluxProximity * 0.16;
  });
  zephyraFluxRuntime.debris.forEach((debris) => {
    const angle = debris.phase + time * debris.speed;
    debris.mesh.position.set(
      Math.cos(angle) * debris.radius,
      debris.altitude + Math.sin(angle * 1.7 + time * 0.68) * 0.42,
      Math.sin(angle) * debris.radius
    );
    debris.mesh.rotation.x += dt * debris.spin;
    debris.mesh.rotation.y -= dt * debris.spin * 0.72;
  });
  zephyraFluxRuntime.fluxLight.intensity = 5.2 + pulse * 3.8 + zephyraFluxProximity * 2.6;
  zephyraFluxRuntime.landmarkLabel.material.opacity = 0.5 + Math.sin(time * 1.35) * 0.1 + zephyraFluxProximity * 0.3;
}

function buildZephyraAuroralSquall() {
  const group = new THREE.Group();
  group.name = 'Zephyra · Ion Veil localized auroral squall';
  group.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_AURORA_NORMAL, 0.08));
  group.quaternion.setFromUnitVectors(UP, ZEPHYRA_AURORA_NORMAL);
  scene.add(group);

  const curtains = [];
  const curtainCount = isTouchDevice ? 3 : 5;
  for (let index = 0; index < curtainCount; index++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: index * 1.73 },
        uIntensity: { value: 0.72 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uPhase;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float envelope = sin(uv.y * 3.14159);
          p.x += sin(uv.y * 8.0 + uTime * 0.72 + uPhase) * 0.7 * envelope;
          p.z += sin(uv.y * 5.0 - uTime * 0.46 + uPhase * 1.8) * 0.34 * envelope;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPhase;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(0.0, 0.18, 1.0 - vUv.x);
          float foot = smoothstep(0.0, 0.1, vUv.y);
          float crown = 1.0 - smoothstep(0.62, 1.0, vUv.y);
          float folds = 0.54 + sin(vUv.x * 34.0 + vUv.y * 9.0 - uTime * 1.35 + uPhase) * 0.2;
          float filaments = pow(0.5 + 0.5 * sin(vUv.x * 73.0 + uTime * 0.72 + uPhase * 2.0), 4.0);
          vec3 cyan = vec3(0.18, 1.0, 0.82);
          vec3 violet = vec3(0.62, 0.26, 1.0);
          vec3 color = mix(cyan, violet, smoothstep(0.16, 0.86, vUv.x + sin(uTime * 0.3 + uPhase) * 0.16));
          float alpha = (folds * 0.16 + filaments * 0.12) * edge * foot * crown * uIntensity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 15.5, 28, 20), material);
    curtain.position.set((index - (curtainCount - 1) * 0.5) * 1.1, 8.1, (index % 2 ? -1 : 1) * (0.8 + index * 0.25));
    curtain.rotation.y = -0.72 + index * (1.44 / Math.max(1, curtainCount - 1));
    group.add(curtain);
    curtains.push(curtain);
  }

  const dropCount = isTouchDevice ? 38 : 72;
  const rainPositions = new Float32Array(dropCount * 2 * 3);
  const rainSeeds = [];
  let seed = 0x10a5c11;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < dropCount; index++) {
    rainSeeds.push({
      x: (random() - 0.5) * 13,
      z: (random() - 0.5) * 11,
      phase: random(),
      speed: 4.8 + random() * 7.2,
      length: 0.3 + random() * 0.9,
      sway: random() * Math.PI * 2,
    });
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.LineBasicMaterial({
    color: 0x7fffe3,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const electricRain = new THREE.LineSegments(rainGeometry, rainMaterial);
  electricRain.name = 'Localized electric rain';
  electricRain.frustumCulled = false;
  group.add(electricRain);

  const coronaMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fffe1,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const groundCoronas = [];
  [2.2, 4.1, 6.4].forEach((radius, index) => {
    const corona = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035 + index * 0.012, 5, 64), coronaMaterial.clone());
    corona.rotation.x = Math.PI / 2;
    corona.position.y = 0.1 + index * 0.025;
    group.add(corona);
    groundCoronas.push(corona);
  });

  const strikeGeometry = new THREE.BufferGeometry();
  strikeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
  const strikeMaterial = new THREE.LineBasicMaterial({
    color: 0xe8ffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const groundStrike = new THREE.Line(strikeGeometry, strikeMaterial);
  groundStrike.visible = false;
  group.add(groundStrike);

  const squallLight = new THREE.PointLight(0x72ffe4, 4.5, 24, 2);
  squallLight.position.set(0, 6.5, 0);
  group.add(squallLight);
  const landmarkLabel = makeLabelSprite('ION VEIL · AURORAL SQUALL', '#8fffe6');
  landmarkLabel.position.set(0, 11.3, 0);
  landmarkLabel.scale.set(6, 1.04, 1);
  group.add(landmarkLabel);

  return {
    group,
    curtains,
    rainPositions,
    rainSeeds,
    electricRain,
    rainMaterial,
    groundCoronas,
    groundStrike,
    strikeMaterial,
    squallLight,
    landmarkLabel,
  };
}

const zephyraAuroraRuntime = buildZephyraAuroralSquall();
let zephyraAuroraStrikeFrame = -1;

function regenerateZephyraAuroraStrike(time) {
  const positions = zephyraAuroraRuntime.groundStrike.geometry.attributes.position;
  const targetX = Math.sin(time * 2.7) * 3.8;
  const targetZ = Math.cos(time * 1.9) * 3.2;
  for (let index = 0; index < positions.count; index++) {
    const progress = index / (positions.count - 1);
    const jitter = Math.sin(progress * Math.PI);
    positions.setXYZ(
      index,
      targetX + (Math.random() - 0.5) * jitter * 1.15,
      15.2 * (1 - progress) + 0.12,
      targetZ + (Math.random() - 0.5) * jitter * 1.15
    );
  }
  positions.needsUpdate = true;
}

function updateZephyraAuroralSquall(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('zephyra', activePlayerNormal, ZEPHYRA_AURORA_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 5.6, 17.5);
    if (!zephyraAuroraDiscovered && distance < 9.2) {
      zephyraAuroraDiscovered = true;
      showBanner('ION VEIL DISCOVERED · AURORAL PRECIPITATION ACTIVE');
    }
  }
  zephyraAuroraProximity = THREE.MathUtils.damp(zephyraAuroraProximity, targetProximity, 4.5, dt);
  const pulse = Math.sin(time * 1.8) * 0.5 + 0.5;
  zephyraAuroraRuntime.curtains.forEach((curtain, index) => {
    curtain.material.uniforms.uTime.value = time;
    curtain.material.uniforms.uIntensity.value = 0.62 + pulse * 0.3 + zephyraAuroraProximity * 0.18;
    curtain.position.x += Math.sin(time * 0.34 + index * 1.7) * dt * 0.08;
  });
  zephyraAuroraRuntime.rainSeeds.forEach((drop, index) => {
    const cycle = (drop.phase + time * drop.speed / 15.5) % 1;
    const y = 0.3 + (1 - cycle) * 15.5;
    const x = drop.x + Math.sin(time * 1.1 + drop.sway) * 0.28;
    const z = drop.z + Math.sin(time * 0.73 + drop.sway * 1.4) * 0.22;
    const offset = index * 6;
    zephyraAuroraRuntime.rainPositions[offset] = x;
    zephyraAuroraRuntime.rainPositions[offset + 1] = y;
    zephyraAuroraRuntime.rainPositions[offset + 2] = z;
    zephyraAuroraRuntime.rainPositions[offset + 3] = x + 0.05;
    zephyraAuroraRuntime.rainPositions[offset + 4] = y + drop.length;
    zephyraAuroraRuntime.rainPositions[offset + 5] = z - 0.04;
  });
  zephyraAuroraRuntime.electricRain.geometry.attributes.position.needsUpdate = true;
  zephyraAuroraRuntime.rainMaterial.opacity = 0.28 + pulse * 0.24 + zephyraAuroraProximity * 0.12;
  zephyraAuroraRuntime.groundCoronas.forEach((corona, index) => {
    const wave = 1 + Math.sin(time * (1.7 + index * 0.22) + index * 2.1) * 0.06;
    corona.scale.setScalar(wave);
    corona.material.opacity = 0.065 + pulse * 0.085 + zephyraAuroraProximity * 0.07;
    corona.rotation.z += dt * (index % 2 ? -0.08 : 0.11);
  });

  const flashWave = Math.sin(time * 2.4) + Math.sin(time * 7.1) * 0.58;
  const flash = Math.pow(Math.max(0, flashWave - 1.16), 2);
  const strikeFrame = Math.floor(time * 10);
  if (flash > 0.015 && strikeFrame !== zephyraAuroraStrikeFrame) {
    zephyraAuroraStrikeFrame = strikeFrame;
    regenerateZephyraAuroraStrike(time);
  }
  zephyraAuroraRuntime.groundStrike.visible = flash > 0.018;
  zephyraAuroraRuntime.strikeMaterial.opacity = THREE.MathUtils.clamp(0.28 + flash * 1.8, 0, 1);
  zephyraAuroraRuntime.squallLight.intensity = 1.6 + pulse * 1.4 + flash * 14 + zephyraAuroraProximity * 0.8;
  zephyraAuroraRuntime.landmarkLabel.material.opacity = 0.48 + Math.sin(time * 1.05) * 0.08 + zephyraAuroraProximity * 0.32;
}

function buildZephyraPiezoelectricGrove() {
  const group = new THREE.Group();
  group.name = 'Zephyra · Piezoelectric Prism Grove';
  scene.add(group);

  let seed = 0x6f726f76;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stemMaterial = new THREE.MeshStandardMaterial({
    color: 0x183340,
    emissive: 0x13576b,
    emissiveIntensity: 0.72,
    metalness: 0.58,
    roughness: 0.28,
    flatShading: true,
  });
  const crownMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0x74ffe3,
      emissive: 0x2ce5c7,
      emissiveIntensity: 1.28,
      metalness: 0.32,
      roughness: 0.18,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xc18aff,
      emissive: 0x824cff,
      emissiveIntensity: 1.22,
      metalness: 0.38,
      roughness: 0.2,
      flatShading: true,
    }),
  ];
  const basaltMaterial = new THREE.MeshStandardMaterial({
    color: 0x111822,
    emissive: 0x152438,
    emissiveIntensity: 0.25,
    metalness: 0.42,
    roughness: 0.68,
    flatShading: true,
  });
  const ringBaseMaterial = new THREE.MeshBasicMaterial({
    color: 0x79ffe5,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const stemGeometry = new THREE.ConeGeometry(0.28, 1, 6);
  const branchGeometry = new THREE.ConeGeometry(0.16, 1, 5);
  const crownGeometry = new THREE.DodecahedronGeometry(1, 0);
  const basaltGeometry = new THREE.CylinderGeometry(0.68, 1.02, 0.34, 7);
  const rootRingGeometry = new THREE.TorusGeometry(0.92, 0.035, 5, 32);
  const trees = [];
  const treeNormals = [];
  const groveTangent = tangentHeadingForNormal(ZEPHYRA_GROVE_NORMAL);
  const treeCount = isTouchDevice ? 10 : 17;

  for (let index = 0; index < treeCount; index++) {
    const angle = index * 2.39996 + random() * 0.32;
    const radius = index === 0 ? 0 : 1.25 + Math.sqrt(index / treeCount) * 5.2 + random() * 0.72;
    const direction = groveTangent.clone().applyAxisAngle(ZEPHYRA_GROVE_NORMAL, angle);
    const normal = stepWorldNormal(ZEPHYRA_GROVE_NORMAL, direction, radius, ZEPHYRA_RADIUS);
    const tree = new THREE.Group();
    tree.position.copy(surfacePositionForWorld('zephyra', normal, 0.04));
    tree.quaternion.setFromUnitVectors(UP, normal);
    group.add(tree);

    const base = new THREE.Mesh(basaltGeometry, basaltMaterial);
    base.position.y = 0.12;
    base.scale.set(0.72 + random() * 0.55, 0.72 + random() * 0.42, 0.72 + random() * 0.55);
    base.rotation.y = random() * Math.PI;
    tree.add(base);

    const height = 2.2 + Math.pow(random(), 0.72) * 3.9;
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = height * 0.48;
    stem.scale.set(0.62 + height * 0.085, height, 0.62 + height * 0.085);
    stem.rotation.y = random() * Math.PI;
    tree.add(stem);

    const crystalCluster = new THREE.Group();
    crystalCluster.position.y = height * 0.72;
    tree.add(crystalCluster);
    for (let branchIndex = 0; branchIndex < 3; branchIndex++) {
      const branch = new THREE.Mesh(branchGeometry, crownMaterials[(index + branchIndex) % 2]);
      const side = branchIndex - 1;
      branch.position.set(side * 0.3, branchIndex * 0.34, (branchIndex % 2 ? -1 : 1) * 0.14);
      branch.scale.set(0.72, 1.35 + random() * 0.7, 0.72);
      branch.rotation.z = side * -0.72;
      branch.rotation.x = (random() - 0.5) * 0.38;
      crystalCluster.add(branch);
    }

    const crown = new THREE.Mesh(crownGeometry, crownMaterials[index % 2]);
    crown.position.y = height + 0.5;
    const crownScale = new THREE.Vector3(0.58 + random() * 0.32, 0.82 + random() * 0.52, 0.58 + random() * 0.34);
    crown.scale.copy(crownScale);
    crown.rotation.set(random() * 0.28, random() * Math.PI, random() * 0.25);
    tree.add(crown);

    const ringMaterial = ringBaseMaterial.clone();
    ringMaterial.color.set(index % 2 ? 0xc79aff : 0x75ffe4);
    const rootRing = new THREE.Mesh(rootRingGeometry, ringMaterial);
    rootRing.position.y = 0.08;
    rootRing.rotation.x = Math.PI / 2;
    rootRing.scale.setScalar(0.72 + random() * 0.62);
    tree.add(rootRing);

    trees.push({ tree, crown, crownScale, crystalCluster, rootRing, distance: radius, phase: random() * Math.PI * 2 });
    treeNormals.push(normal);
  }

  const veinPositions = [];
  treeNormals.slice(1).forEach((normal) => {
    let previous = surfacePositionForWorld('zephyra', ZEPHYRA_GROVE_NORMAL, 0.075);
    for (let sample = 1; sample <= 5; sample++) {
      const sampleNormal = slerpNormals(ZEPHYRA_GROVE_NORMAL, normal, sample / 5);
      const next = surfacePositionForWorld('zephyra', sampleNormal, 0.075);
      veinPositions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
      previous = next;
    }
  });
  const veinGeometry = new THREE.BufferGeometry();
  veinGeometry.setAttribute('position', new THREE.Float32BufferAttribute(veinPositions, 3));
  const veinMaterial = new THREE.LineBasicMaterial({
    color: 0x73ffe4,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rootVeins = new THREE.LineSegments(veinGeometry, veinMaterial);
  rootVeins.name = 'Piezoelectric subsurface root network';
  group.add(rootVeins);

  const pulseRoot = new THREE.Group();
  pulseRoot.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_GROVE_NORMAL, 0.08));
  pulseRoot.quaternion.setFromUnitVectors(UP, ZEPHYRA_GROVE_NORMAL);
  group.add(pulseRoot);
  const resonanceRings = [];
  for (let index = 0; index < 3; index++) {
    const material = ringBaseMaterial.clone();
    material.color.set(index % 2 ? 0xbd8cff : 0x65ffe1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.055, 5, 48), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    pulseRoot.add(ring);
    resonanceRings.push(ring);
  }

  const particleCount = isTouchDevice ? 26 : 52;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.8 + random() * 6.2;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = 0.5 + random() * 6.6;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0x9ffff0,
    size: 0.13,
    transparent: true,
    opacity: 0.48,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const chargeParticles = new THREE.Points(particleGeometry, particleMaterial);
  pulseRoot.add(chargeParticles);

  const groveLight = new THREE.PointLight(0x68ffe2, 4.5, 22, 2);
  groveLight.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_GROVE_NORMAL, 4.4));
  group.add(groveLight);
  const landmarkLabel = makeLabelSprite('PRISM GROVE · PIEZOELECTRIC FOREST', '#93ffe9');
  landmarkLabel.position.copy(surfacePositionForWorld('zephyra', ZEPHYRA_GROVE_NORMAL, 8.2));
  landmarkLabel.scale.set(6.4, 1.02, 1);
  group.add(landmarkLabel);

  return {
    group,
    trees,
    stemMaterial,
    crownMaterials,
    veinMaterial,
    resonanceRings,
    chargeParticles,
    particleMaterial,
    groveLight,
    landmarkLabel,
  };
}

const zephyraGroveRuntime = buildZephyraPiezoelectricGrove();

function updateZephyraPiezoelectricGrove(dt, time, activePlayerNormal) {
  let targetProximity = 0;
  if (activePlayerNormal) {
    const distance = arcDistanceForWorld('zephyra', activePlayerNormal, ZEPHYRA_GROVE_NORMAL);
    targetProximity = 1 - THREE.MathUtils.smoothstep(distance, 4.8, 15.2);
    if (!zephyraGroveDiscovered && distance < 8.2) {
      zephyraGroveDiscovered = true;
      showBanner('PRISM GROVE DISCOVERED · ROOT NETWORK RESONATING');
    }
  }
  zephyraGroveProximity = THREE.MathUtils.damp(zephyraGroveProximity, targetProximity, 4.8, dt);
  zephyraGroveArrivalCharge = Math.max(0, zephyraGroveArrivalCharge - dt * 0.055);
  const activation = Math.max(zephyraGroveProximity, zephyraGroveArrivalCharge);
  const breathingPulse = Math.sin(time * 2.15) * 0.5 + 0.5;

  zephyraGroveRuntime.stemMaterial.emissiveIntensity = 0.48 + breathingPulse * 0.25 + activation * 0.65;
  zephyraGroveRuntime.crownMaterials.forEach((material, index) => {
    material.emissiveIntensity = 0.92 + breathingPulse * 0.42 + activation * (0.75 + index * 0.12);
  });
  zephyraGroveRuntime.trees.forEach((tree, index) => {
    const wave = Math.max(0, Math.sin(time * 3.15 - tree.distance * 1.45 + tree.phase * 0.18));
    const response = activation * wave;
    tree.crown.scale.copy(tree.crownScale).multiplyScalar(1 + response * 0.16);
    tree.crown.rotation.y += dt * (0.12 + response * 0.46) * (index % 2 ? -1 : 1);
    tree.crystalCluster.rotation.y = Math.sin(time * 0.82 + tree.phase) * (0.035 + activation * 0.045);
    tree.rootRing.material.opacity = 0.035 + breathingPulse * 0.025 + response * 0.38;
    tree.rootRing.scale.setScalar((0.78 + tree.distance * 0.025) * (1 + response * 0.12));
  });
  zephyraGroveRuntime.veinMaterial.opacity = 0.12 + breathingPulse * 0.1 + activation * 0.32;
  zephyraGroveRuntime.resonanceRings.forEach((ring, index) => {
    const cycle = (time * (0.17 + activation * 0.22) + index / zephyraGroveRuntime.resonanceRings.length) % 1;
    ring.scale.setScalar(0.8 + cycle * 5.5);
    ring.material.opacity = (1 - cycle) * (0.035 + activation * 0.28);
  });
  zephyraGroveRuntime.chargeParticles.rotation.y += dt * (0.08 + activation * 0.3);
  zephyraGroveRuntime.chargeParticles.position.y = Math.sin(time * 0.72) * 0.22;
  zephyraGroveRuntime.particleMaterial.opacity = 0.24 + breathingPulse * 0.16 + activation * 0.28;
  zephyraGroveRuntime.groveLight.intensity = 2.4 + breathingPulse * 2.2 + activation * 5.8;
  zephyraGroveRuntime.landmarkLabel.material.opacity = 0.48 + Math.sin(time * 1.25) * 0.08 + activation * 0.34;
}

function makeCommandScreenTexture(screenIndex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext('2d');
  const palettes = [
    { accent: '#63e8ff', label: 'LUNA OPS', status: 'HABITAT NOMINAL' },
    { accent: '#ff9a62', label: 'MARS LINK', status: 'UPLINK 98.7%' },
    { accent: '#9dffab', label: 'LIFE SUPPORT', status: 'O₂ 21.4%' },
  ];
  const palette = palettes[screenIndex % palettes.length];
  ctx.fillStyle = '#020a12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(104, 221, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = palette.accent;
  ctx.font = '700 28px monospace';
  ctx.fillText(palette.label, 24, 42);
  ctx.font = '600 16px monospace';
  ctx.fillText(palette.status, 24, 70);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = 24; x < 488; x += 12) {
    const y = 188 + Math.sin(x * 0.034 + screenIndex * 1.7) * 34 + Math.cos(x * 0.081) * 13;
    if (x === 24) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? palette.accent : 'rgba(255,255,255,0.28)';
    ctx.fillRect(24 + i * 78, 235, 54, 10 + ((i * 19 + screenIndex * 11) % 30));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMoonCommandPath() {
  const markerCount = 9;
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.075, 12);
  const material = new THREE.MeshStandardMaterial({
    color: 0x8fe8ff,
    emissive: 0x3bd7ff,
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  const markers = new THREE.InstancedMesh(geometry, material, markerCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < markerCount; i++) {
    const normal = slerpNormals(MOON_PAD_NORMAL, MOON_COMMAND_NORMAL, (i + 1) / (markerCount + 1));
    dummy.position.copy(MOON_CENTER).addScaledVector(normal, MOON_RADIUS + getMoonHeight(normal) + 0.11);
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.updateMatrix();
    markers.setMatrixAt(i, dummy.matrix);
  }
  markers.instanceMatrix.needsUpdate = true;
  scene.add(markers);
  return markers;
}

function buildMoonCommandCenter() {
  const group = new THREE.Group();
  group.name = 'Luna Command Center · walk-in habitat';
  group.position.copy(MOON_COMMAND_POSITION);
  group.quaternion.copy(surfaceVehicleQuaternion(MOON_COMMAND_NORMAL, MOON_COMMAND_HEADING));
  scene.add(group);

  const shell = stdMat(0xb7c4ce, { metalness: 0.68, roughness: 0.36 });
  const darkShell = stdMat(0x19222e, { metalness: 0.52, roughness: 0.5 });
  const consoleMaterial = stdMat(0x101927, { metalness: 0.74, roughness: 0.3 });
  const doorAccent = new THREE.MeshStandardMaterial({
    color: 0xff8654,
    emissive: 0xff4a1f,
    emissiveIntensity: 1.35,
    metalness: 0.34,
    roughness: 0.32,
  });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.34, 10.2), darkShell);
  floor.position.y = 0.17;
  group.add(floor);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.38, 5.45, 10.2), shell);
  leftWall.position.set(-4.92, 2.85, 0);
  group.add(leftWall);
  const rightWall = leftWall.clone();
  rightWall.position.x = 4.92;
  group.add(rightWall);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(10.2, 5.45, 0.38), shell);
  backWall.position.set(0, 2.85, 4.92);
  group.add(backWall);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.42, 10.4), shell);
  roof.position.y = 5.56;
  group.add(roof);

  [-4.05, 4.05].forEach((x) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.72, 5.25, 0.52), shell);
    pillar.position.set(x, 2.72, -4.92);
    group.add(pillar);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.56, 0.54), shell);
  lintel.position.set(0, 5.14, -4.92);
  group.add(lintel);
  const doorRing = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.13, 8, 32, Math.PI), doorAccent);
  doorRing.position.set(0, 0.36, -5.2);
  group.add(doorRing);

  const commandLabel = makeLabelSprite('LUNA COMMAND', '#8fe8ff');
  commandLabel.position.set(0, 6.55, -5.35);
  commandLabel.scale.set(4.8, 0.92, 1);
  group.add(commandLabel);

  const desk = new THREE.Mesh(new THREE.BoxGeometry(8.55, 1.32, 1.35), consoleMaterial);
  desk.position.set(0, 0.94, 3.6);
  group.add(desk);
  const controlDeck = new THREE.Mesh(new THREE.BoxGeometry(8.65, 0.18, 1.7), darkShell);
  controlDeck.position.set(0, 1.68, 3.18);
  controlDeck.rotation.x = -0.16;
  group.add(controlDeck);

  const screenMaterials = [];
  [-2.65, 0, 2.65].forEach((x, screenIndex) => {
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: makeCommandScreenTexture(screenIndex),
      toneMapped: false,
      transparent: true,
      opacity: 1,
      side: THREE.FrontSide,
    });
    screenMaterials.push(screenMaterial);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.38, 1.58, 0.18), consoleMaterial);
    bezel.position.set(x, 3.65, 4.62);
    group.add(bezel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.14, 1.34), screenMaterial);
    screen.position.set(x, 3.65, 4.515);
    screen.rotation.y = Math.PI;
    group.add(screen);
  });

  const buttonMaterials = [0x60dcff, 0xff6b3c, 0xa6ff82].map((color) => new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.65,
    roughness: 0.25,
  }));
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 12; column++) {
      const button = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.13, 0.3), buttonMaterials[(row + column) % buttonMaterials.length]);
      button.position.set(-3.7 + column * 0.67, 1.86 + row * 0.015, 2.72 + row * 0.38);
      group.add(button);
    }
  }

  [-3.92, 3.92].forEach((x, sideIndex) => {
    const sideConsole = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.42, 4.35), consoleMaterial);
    sideConsole.position.set(x, 0.9, 0.65);
    group.add(sideConsole);
    for (let z = -0.9; z <= 2.1; z += 1) {
      const statusLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.44), buttonMaterials[(sideIndex + Math.round(z + 1)) % buttonMaterials.length]);
      statusLight.position.set(x + (sideIndex === 0 ? 0.56 : -0.56), 1.25, z);
      group.add(statusLight);
    }
  });

  const holoBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.38, 1.05, 16), consoleMaterial);
  holoBase.position.set(0, 0.67, 0.2);
  group.add(holoBase);
  const hologramMaterial = new THREE.MeshBasicMaterial({
    color: 0x5ce8ff,
    wireframe: true,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const hologram = new THREE.Mesh(new THREE.IcosahedronGeometry(0.86, 2), hologramMaterial);
  hologram.position.set(0, 2.05, 0.2);
  group.add(hologram);
  const orbitRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.22, 0.025, 6, 48),
    new THREE.MeshBasicMaterial({ color: 0xff9a62, transparent: true, opacity: 0.72, toneMapped: false })
  );
  orbitRing.position.copy(hologram.position);
  orbitRing.rotation.x = Math.PI / 2.5;
  group.add(orbitRing);

  [-2.25, 2.25].forEach((x) => {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.2, 1.05), darkShell);
    seat.position.y = 1.02;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.25, 0.18), darkShell);
    back.position.set(0, 1.52, -0.45);
    chair.add(back);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.9, 8), consoleMaterial);
    stem.position.y = 0.48;
    chair.add(stem);
    chair.position.set(x, 0, 1.65);
    chair.rotation.y = Math.PI;
    group.add(chair);
  });

  const interiorLight = new THREE.PointLight(0x70dfff, 2.25, 14, 2);
  interiorLight.position.set(0, 4.6, 0.7);
  group.add(interiorLight);
  const doorLight = new THREE.PointLight(0xff7044, 1.2, 9, 2);
  doorLight.position.set(0, 3.8, -4.35);
  group.add(doorLight);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 8), darkShell);
  antenna.position.set(3.3, 7.25, 1.4);
  group.add(antenna);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), doorAccent);
  beacon.position.set(3.3, 8.9, 1.4);
  group.add(beacon);

  return {
    group,
    screenMaterials,
    buttonMaterials,
    hologram,
    hologramMaterial,
    orbitRing,
    interiorLight,
    beacon,
  };
}

const moonCommandPath = buildMoonCommandPath();
const moonCommandRuntime = buildMoonCommandCenter();
const moonCommandDeltaNormal = new THREE.Vector3();

function isNearMoonCommand(normal, radius = MOON_COMMAND_INTERACT_RADIUS) {
  return arcDistanceForWorld('moon', normal, MOON_COMMAND_NORMAL) < radius;
}

function updateMoonCommandCenter(dt, time, listenerNormal) {
  let targetInterior = 0;
  if (listenerNormal) {
    moonCommandDeltaNormal.copy(listenerNormal).sub(MOON_COMMAND_NORMAL);
    const along = Math.abs(moonCommandDeltaNormal.dot(MOON_COMMAND_HEADING) * MOON_RADIUS);
    const across = Math.abs(moonCommandDeltaNormal.dot(MOON_COMMAND_RIGHT) * MOON_RADIUS);
    const depthInfluence = 1 - THREE.MathUtils.smoothstep(along, 4.35, 5.25);
    const widthInfluence = 1 - THREE.MathUtils.smoothstep(across, 4.1, 5.05);
    targetInterior = depthInfluence * widthInfluence;

    if (!moonCommandDiscovered && arcDistanceForWorld('moon', listenerNormal, MOON_COMMAND_NORMAL) < 7.2) {
      moonCommandDiscovered = true;
      showBanner('LUNA COMMAND CENTER DISCOVERED · WALK INSIDE');
    }
  }
  moonCommandInterior = THREE.MathUtils.damp(moonCommandInterior, targetInterior, 6, dt);

  const systemLevel = moonCommandSystemsActive ? 1 : 0.16;
  moonCommandRuntime.screenMaterials.forEach((material, index) => {
    material.opacity = THREE.MathUtils.lerp(0.18, 0.92 + Math.sin(time * 2.3 + index) * 0.08, systemLevel);
  });
  moonCommandRuntime.buttonMaterials.forEach((material, index) => {
    material.emissiveIntensity = 0.18 + systemLevel * (1.15 + Math.max(0, Math.sin(time * (3.2 + index) + index)) * 1.1);
  });
  moonCommandRuntime.hologram.rotation.y += dt * (moonCommandSystemsActive ? 0.72 : 0.12);
  moonCommandRuntime.hologram.rotation.x = Math.sin(time * 0.7) * 0.16;
  moonCommandRuntime.hologramMaterial.opacity = 0.08 + systemLevel * (0.42 + Math.sin(time * 2) * 0.08);
  moonCommandRuntime.orbitRing.rotation.z += dt * (moonCommandSystemsActive ? 0.42 : 0.08);
  moonCommandRuntime.interiorLight.intensity = 0.28 + systemLevel * (1.72 + Math.sin(time * 1.8) * 0.18);
  moonCommandRuntime.beacon.material.emissiveIntensity = 0.5 + systemLevel * (1.1 + Math.sin(time * 4.2) * 0.35);
}

function buildMoonShuttle() {
  const shuttle = new THREE.Group();
  shuttle.name = 'Ares–Luna Open-Top Space Bus';

  const shell = stdMat(0xffe5ad, { metalness: 0.34, roughness: 0.4 });
  const dark = stdMat(0x171c28, { metalness: 0.72, roughness: 0.28 });
  const orange = stdMat(0xe84c25, { metalness: 0.28, roughness: 0.43 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x75ddff, emissive: 0x43cfff, emissiveIntensity: 1.6, roughness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x80dfff,
    emissive: 0x164a66,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.34,
    transmission: 0.34,
    roughness: 0.08,
    metalness: 0.08,
    depthWrite: false,
  });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.58, 7.5), dark);
  chassis.position.y = 0.62;
  shuttle.add(chassis);

  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(4.45, 1.2, 7.15), orange);
  lowerBody.position.y = 1.28;
  shuttle.add(lowerBody);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.18, 6.65), dark);
  deck.position.y = 1.96;
  shuttle.add(deck);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(3.95, 1.36, 0.12), glass);
  windshield.position.set(0, 2.62, -3.48);
  windshield.rotation.x = -0.1;
  shuttle.add(windshield);

  const frontCap = new THREE.Mesh(new THREE.BoxGeometry(4.38, 0.72, 0.48), shell);
  frontCap.position.set(0, 1.55, -3.57);
  shuttle.add(frontCap);

  [-1.1, 1.1].forEach((x) => {
    const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 14), glow);
    headlight.rotation.x = Math.PI / 2;
    headlight.position.set(x, 1.48, -3.85);
    shuttle.add(headlight);
  });

  [-1.35, 0.25, 1.85].forEach((z) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.82), shell);
    seat.position.set(0, 2.18, z);
    shuttle.add(seat);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.72, 0.16), shell);
    seatBack.position.set(0, 2.52, z + 0.34);
    seatBack.rotation.x = -0.1;
    shuttle.add(seatBack);
  });

  [-1, 1].forEach((side) => {
    [-2.75, -0.9, 0.95, 2.8].forEach((z) => {
      const railPost = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 8), side > 0 ? glow : shell);
      railPost.position.set(side * 2.05, 2.68, z);
      shuttle.add(railPost);
    });
    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 6.4, 8), side > 0 ? glow : shell);
    topRail.rotation.x = Math.PI / 2;
    topRail.position.set(side * 2.05, 3.34, 0);
    shuttle.add(topRail);

    [-2.45, 2.45].forEach((z) => {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.44, 16), dark);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(side * 2.4, 0.62, z);
      shuttle.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.47, 14), glow);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(tire.position);
      shuttle.add(hub);
    });

    const step = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 2.2), shell);
    step.position.set(side * 2.5, 1.1, 0.3);
    shuttle.add(step);
  });

  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 8, 20), dark);
  steeringWheel.position.set(-1.25, 2.55, -2.92);
  steeringWheel.rotation.x = -0.35;
  shuttle.add(steeringWheel);

  const shuttleSeat = new THREE.Group();
  shuttleSeat.position.set(0, 2.23, 0.25);
  shuttle.add(shuttleSeat);

  const exhaust = new THREE.Group();
  [-1.25, 1.25].forEach((x) => {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.65, 14), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, 1.1, 3.82);
    shuttle.add(nozzle);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 2.9, 14),
      new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, 1.1, 5.2);
    exhaust.add(flame);
  });
  exhaust.visible = false;
  shuttle.add(exhaust);

  const navLight = new THREE.PointLight(0x79dcff, 2.4, 20, 2);
  navLight.position.set(0, 3.35, -2.7);
  shuttle.add(navLight);

  const label = makeLabelSprite('OPEN-TOP SPACE BUS', '#dff7ff');
  label.position.set(0, 4.15, 0.25);
  label.scale.set(3.7, 0.78, 1);
  shuttle.add(label);

  shuttle.position.copy(MARS_DOCK_POSITION);
  shuttle.quaternion.copy(MARS_DOCK_QUATERNION);
  scene.add(shuttle);
  return { shuttle, shuttleSeat, exhaust, navLight };
}

const shuttleRuntime = buildMoonShuttle();
const moonShuttle = shuttleRuntime.shuttle;
const shuttleFlightDirection = new THREE.Vector3(0, 1, 0);

/* ---------- alien character ---------- */

function buildAlien() {
  const alien = new THREE.Group();
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8fb95a,
    roughness: 0.66,
    metalness: 0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.68,
    sheen: 0.28,
    sheenColor: new THREE.Color(0xcce79a),
  });
  const limbMaterial = new THREE.MeshPhysicalMaterial({ color: 0x668b42, roughness: 0.76, clearcoat: 0.08 });
  const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x4c6c32, roughness: 0.9 });
  const detailMaterial = new THREE.MeshStandardMaterial({ color: 0x405b30, roughness: 0.92 });
  const sneakerRedMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd92332,
    roughness: 0.48,
    clearcoat: 0.32,
    clearcoatRoughness: 0.42,
  });
  const sneakerSoleMaterial = new THREE.MeshStandardMaterial({ color: 0xf4ede2, roughness: 0.7 });
  const sneakerLaceMaterial = new THREE.MeshBasicMaterial({ color: 0xfff8eb, toneMapped: false });
  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x010404,
    roughness: 0.025,
    metalness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    emissive: 0x071718,
    emissiveIntensity: 0.3,
  });
  const hipY = 1.0;
  const thighLen = 0.5;
  const shinLen = 0.5;

  const legs = [];
  [-0.24, 0.24].forEach((x) => {
    const thigh = new THREE.Group();
    thigh.position.set(x, hipY, 0);
    thigh.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), jointMaterial));

    const thighMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, thighLen, 14), limbMaterial);
    thighMesh.position.y = -thighLen / 2;
    thigh.add(thighMesh);

    const shin = new THREE.Group();
    shin.position.y = -thighLen;
    shin.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), jointMaterial));

    const shinMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, shinLen, 14), limbMaterial);
    shinMesh.position.y = -shinLen / 2;
    shin.add(shinMesh);

    const sneaker = new THREE.Group();
    sneaker.name = 'Red Martian sneaker';
    sneaker.position.set(0, -shinLen, -0.09);
    const sneakerUpper = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), sneakerRedMaterial);
    sneakerUpper.position.y = 0.025;
    sneakerUpper.scale.set(1.2, 0.7, 1.72);
    sneaker.add(sneakerUpper);
    const sneakerSole = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8), sneakerSoleMaterial);
    sneakerSole.position.set(0, -0.055, -0.015);
    sneakerSole.scale.set(1.22, 0.2, 1.7);
    sneaker.add(sneakerSole);
    for (let laceIndex = 0; laceIndex < 3; laceIndex++) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.018, 0.025), sneakerLaceMaterial);
      lace.position.set(0, 0.14, -0.12 + laceIndex * 0.08);
      lace.rotation.y = laceIndex % 2 === 0 ? 0.08 : -0.08;
      sneaker.add(lace);
    }
    shin.add(sneaker);

    thigh.add(shin);
    alien.add(thigh);
    legs.push({ thigh, shin });
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.7, 8, 20), skinMaterial);
  body.position.y = 1.85;
  body.scale.set(1, 1, 0.92);
  alien.add(body);

  const shoulderY = 1.92;
  const upperLen = 0.62;
  const foreLen = 0.66;
  const arms = [];
  [-0.62, 0.62].forEach((x, i) => {
    const upper = new THREE.Group();
    upper.position.set(x, shoulderY, 0);
    upper.rotation.z = i === 0 ? -0.15 : 0.15;
    upper.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), jointMaterial));

    const upperMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, upperLen, 14), limbMaterial);
    upperMesh.position.y = -upperLen / 2;
    upper.add(upperMesh);

    const fore = new THREE.Group();
    fore.position.y = -upperLen;
    fore.add(new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), jointMaterial));

    const foreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.07, foreLen, 14), limbMaterial);
    foreMesh.position.y = -foreLen / 2;
    fore.add(foreMesh);

    const hand = new THREE.Group();
    hand.position.y = -foreLen;
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), limbMaterial);
    palm.scale.set(1, 0.86, 0.65);
    hand.add(palm);
    [-0.05, 0, 0.05].forEach((fx) => {
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.012, 0.23, 8), limbMaterial);
      finger.position.set(fx, -0.17, -0.025);
      hand.add(finger);
    });
    fore.add(hand);

    upper.add(fore);
    alien.add(upper);
    arms.push({ upper, fore });
  });

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.58, 16), limbMaterial);
  neck.position.y = 2.9;
  alien.add(neck);

  const headGeo = new THREE.SphereGeometry(0.95, 48, 32);
  const headPos = headGeo.attributes.position;
  for (let i = 0; i < headPos.count; i++) {
    const hx = headPos.getX(i);
    const hy = headPos.getY(i);
    const hz = headPos.getZ(i);
    let px = hx;
    let pz = hz;
    if (hy < 0) {
      const taper = 1 + (hy / 0.95) * 0.4;
      px *= taper;
      pz *= taper;
    }
    const dermalTexture = 1 + noise3(hx * 6.2 + 13, hy * 6.2 - 7, hz * 6.2 + 4) * 0.022;
    headPos.setXYZ(i, px * dermalTexture, hy * dermalTexture, pz * dermalTexture);
  }
  headPos.needsUpdate = true;
  headGeo.computeVertexNormals();
  const head = new THREE.Mesh(headGeo, skinMaterial);
  head.position.y = 3.85;
  head.scale.set(1.08, 1.24, 0.92);
  alien.add(head);

  const eyeW = 0.34;
  const eyeH = 0.22;
  const eyeShape = new THREE.Shape();
  eyeShape.moveTo(-eyeW, 0);
  eyeShape.quadraticCurveTo(0, eyeH, eyeW, 0);
  eyeShape.quadraticCurveTo(0, -eyeH, -eyeW, 0);
  const eyeGeo = new THREE.ExtrudeGeometry(eyeShape, {
    depth: 0.09,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 3,
    curveSegments: 20,
  });
  eyeGeo.translate(0, 0, -0.045);
  eyeGeo.rotateY(Math.PI);

  [-0.38, 0.38].forEach((x, i) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMaterial);
    eye.position.set(x, 3.82, -0.72);
    eye.rotation.z = i === 0 ? -0.35 : 0.35;
    alien.add(eye);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), stdMat(0xeaffff, { emissive: 0xeaffff, emissiveIntensity: 0.75 }));
    glint.position.set(x + (i === 0 ? -0.08 : 0.08), 3.9, -0.78);
    alien.add(glint);
  });

  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.31, 4, 12), stdMat(0x172014, { roughness: 0.72 }));
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, 3.48, -0.9);
  alien.add(mouth);

  [-0.1, 0.1].forEach((x) => {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), eyeMaterial);
    nostril.scale.set(1.25, 0.55, 0.42);
    nostril.position.set(x, 3.62, -0.91);
    alien.add(nostril);
  });

  [-1, 1].forEach((side) => {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.44, 4, 10), detailMaterial);
    brow.position.set(side * 0.38, 4.08, -0.76);
    brow.rotation.z = side * 1.18;
    brow.scale.set(1, 1, 0.5);
    alien.add(brow);

    const templePatch = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), detailMaterial);
    templePatch.scale.set(1.6, 0.5, 0.18);
    templePatch.position.set(side * 0.72, 4.15, -0.58);
    templePatch.rotation.z = side * 0.35;
    alien.add(templePatch);

    const neckTendon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.54, 8), detailMaterial);
    neckTendon.position.set(side * 0.12, 3.08, -0.06);
    neckTendon.rotation.z = side * 0.16;
    alien.add(neckTendon);

    const earFold = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), limbMaterial);
    earFold.scale.set(0.32, 1.15, 0.62);
    earFold.position.set(side * 1.01, 3.82, 0.03);
    earFold.rotation.z = side * 0.18;
    alien.add(earFold);
  });

  const foreheadWrinkles = [0, 1, 2];
  foreheadWrinkles.forEach((index) => {
    const wrinkle = new THREE.Mesh(new THREE.TorusGeometry(0.26 + index * 0.045, 0.012, 6, 24, Math.PI * 0.68), detailMaterial);
    wrinkle.position.set(0, 4.32 + index * 0.12, -0.7 + index * 0.035);
    wrinkle.rotation.z = Math.PI * 0.16;
    alien.add(wrinkle);
  });

  const jetpack = new THREE.Group();
  jetpack.name = 'Alien micro-thruster pack';
  const jetpackShell = stdMat(0x263440, { metalness: 0.74, roughness: 0.3 });
  const jetpackGlow = stdMat(0x79ddff, { emissive: 0x45cbff, emissiveIntensity: 1.7, roughness: 0.2 });
  const jetpackBody = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.08, 0.34), jetpackShell);
  jetpackBody.position.set(0, 2.06, 0.48);
  jetpack.add(jetpackBody);

  const thrusterFlames = new THREE.Group();
  [-0.28, 0.28].forEach((x) => {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.9, 12), jetpackShell);
    tank.position.set(x, 2.02, 0.57);
    jetpack.add(tank);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.24, 12), jetpackGlow);
    nozzle.position.set(x, 1.49, 0.57);
    jetpack.add(nozzle);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.21, 1.34, 12),
      new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.96, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.z = Math.PI;
    flame.position.set(x, 0.72, 0.57);
    thrusterFlames.add(flame);
    const flameCore = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.9, 10),
      new THREE.MeshBasicMaterial({ color: 0xf3ffff, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flameCore.rotation.z = Math.PI;
    flameCore.position.set(x, 0.93, 0.58);
    thrusterFlames.add(flameCore);
  });
  thrusterFlames.visible = false;
  jetpack.add(thrusterFlames);
  alien.add(jetpack);

  // Preserve the articulated silhouette while batching the rigid facial,
  // neck, and jetpack details that otherwise cost dozens of calls everywhere
  // the third-person character is visible.
  const articulatedRoots = [body, head, thrusterFlames, ...legs.map((leg) => leg.thigh), ...arms.map((arm) => arm.upper)];
  const isArticulatedMesh = (mesh) => articulatedRoots.some((root) => {
    let current = mesh;
    while (current && current !== alien) {
      if (current === root) return true;
      current = current.parent;
    }
    return false;
  });
  const lowDetail = buildLowDetailProxy(alien, 'Alien rigid details', (mesh) => !isArticulatedMesh(mesh));

  return { alien, legs, arms, body, head, thrusterFlames, lowDetail };
}

function makeRoverLabel(text, background, foreground) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = foreground;
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = foreground;
  ctx.font = '900 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMarsRover(driver) {
  const rover = new THREE.Group();
  rover.name = 'Lil G-Rover';
  rover.position.copy(surfaceWorldPosition(playerNormal));
  rover.quaternion.setFromUnitVectors(UP, playerNormal);
  scene.add(rover);

  const chassis = new THREE.Group();
  rover.add(chassis);

  const orange = stdMat(0xf15422, { roughness: 0.48, metalness: 0.22 });
  const orangeDark = stdMat(0x9e2f17, { roughness: 0.56, metalness: 0.18 });
  const cream = stdMat(0xffd477, { roughness: 0.44, metalness: 0.12 });
  const trim = stdMat(0x171818, { roughness: 0.6, metalness: 0.52 });
  const glass = stdMat(0x163b49, { roughness: 0.14, metalness: 0.42, emissive: 0x102c37, emissiveIntensity: 0.22 });

  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.78, 4.05), orange);
  lowerBody.position.y = 1.12;
  chassis.add(lowerBody);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.5, 1.28), orange);
  hood.position.set(0, 1.72, -1.35);
  chassis.add(hood);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.66, 2.12), orangeDark);
  cabin.position.set(0, 1.72, 0.55);
  chassis.add(cabin);

  const frontWindow = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.54, 0.055), glass);
  frontWindow.position.set(0, 2.18, -0.535);
  frontWindow.rotation.x = -0.12;
  chassis.add(frontWindow);

  [-1, 1].forEach((side) => {
    const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.38, 1.1), glass);
    sideWindow.position.set(side * 1.267, 2.12, 0.45);
    chassis.add(sideWindow);

    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.08), trim);
    mirrorArm.position.set(side * 1.42, 2.08, -0.47);
    chassis.add(mirrorArm);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.28, 0.3), orangeDark);
    mirror.position.set(side * 1.61, 2.1, -0.46);
    chassis.add(mirror);

    const sideStep = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 2.55), trim);
    sideStep.position.set(side * 1.48, 0.83, 0.2);
    chassis.add(sideStep);
  });

  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.9, 0.2), trim);
  seatBack.position.set(0, 1.88, 1.24);
  chassis.add(seatBack);

  [-1.03, 1.03].forEach((x) => {
    const rollBarPost = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.52, 10), trim);
    rollBarPost.position.set(x, 2.62, 1.25);
    chassis.add(rollBarPost);
  });
  const rollBarTop = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.12, 10), trim);
  rollBarTop.rotation.z = Math.PI / 2;
  rollBarTop.position.set(0, 3.37, 1.25);
  chassis.add(rollBarTop);

  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.24, 0.28), trim);
  frontBumper.position.set(0, 0.82, -2.13);
  chassis.add(frontBumper);
  const rearBumper = frontBumper.clone();
  rearBumper.position.z = 2.13;
  chassis.add(rearBumper);

  const grill = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.54, 0.08), trim);
  grill.position.set(0, 1.34, -2.055);
  chassis.add(grill);

  [-0.91, 0.91].forEach((x) => {
    const headlight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.11, 16),
      stdMat(0xfff2b2, { emissive: 0xffd66b, emissiveIntensity: 1.5, roughness: 0.22 })
    );
    headlight.rotation.x = Math.PI / 2;
    headlight.position.set(x, 1.48, -2.1);
    chassis.add(headlight);
  });

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.31),
    new THREE.MeshBasicMaterial({ map: makeRoverLabel('MARS 38', '#fff0bd', '#24140e') })
  );
  plate.rotation.y = Math.PI;
  plate.position.set(0, 0.78, -2.285);
  chassis.add(plate);

  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.72, 6), trim);
  flagPole.position.set(1.12, 3.92, 1.25);
  chassis.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.4), cream);
  flag.position.set(0.73, 4.55, 1.25);
  chassis.add(flag);

  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 10, 24), trim);
  steeringWheel.position.set(0, 2.08, -0.62);
  steeringWheel.rotation.x = -0.23;
  chassis.add(steeringWheel);

  const wheelSpinners = [];
  const frontWheelMounts = [];
  [-1, 1].forEach((side) => {
    [-1.48, 1.48].forEach((z) => {
      const steeringMount = new THREE.Group();
      steeringMount.position.set(side * 1.42, 0.71, z);
      chassis.add(steeringMount);

      const spinner = new THREE.Group();
      steeringMount.add(spinner);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.79, 0.79, 0.48, 16), trim);
      tire.rotation.z = Math.PI / 2;
      spinner.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.5, 14), cream);
      hub.rotation.z = Math.PI / 2;
      spinner.add(hub);
      wheelSpinners.push(spinner);
      if (z < 0) frontWheelMounts.push(steeringMount);
    });
  });

  driver.alien.scale.setScalar(0.9);
  driver.alien.position.set(0, 0.42, 0.28);
  driver.legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.3;
    leg.shin.rotation.x = 1.45;
  });
  driver.arms.forEach((arm, index) => {
    arm.upper.rotation.x = 1.12;
    arm.upper.rotation.z = index === 0 ? -0.18 : 0.18;
    arm.fore.rotation.x = 0.34;
  });
  chassis.add(driver.alien);

  [-1, 1].forEach((side) => {
    const harness = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.02, 0.045), cream);
    harness.position.set(side * 0.28, 2.04, -0.145);
    harness.rotation.z = side * 0.18;
    chassis.add(harness);
  });

  const headlightGlow = new THREE.SpotLight(0xffd68a, 4.5, 25, Math.PI / 7, 0.65, 1.5);
  headlightGlow.position.set(0, 1.5, -2.0);
  headlightGlow.target.position.set(0, 0.4, -13);
  chassis.add(headlightGlow, headlightGlow.target);

  const roverThrusters = new THREE.Group();
  roverThrusters.name = 'G-Rover hover thrusters';
  [-0.92, 0.92].forEach((x) => {
    [-1.12, 1.12].forEach((z) => {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.29, 2.05, 12),
        new THREE.MeshBasicMaterial({ color: 0x60dfff, transparent: true, opacity: 0.94, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      flame.rotation.z = Math.PI;
      flame.position.set(x, -0.7, z);
      roverThrusters.add(flame);
    });
  });
  roverThrusters.visible = false;
  chassis.add(roverThrusters);

  return { rover, chassis, wheelSpinners, frontWheelMounts, driver, roverThrusters };
}

const alienDriver = buildAlien();
function applyAlienQuality(settings) {
  setLowDetailProxyEnabled(alienDriver, settings.materialQuality !== 'high');
}
applyAlienQuality(qualitySettings);
qualityManager.subscribe(({ settings }) => applyAlienQuality(settings), { emitCurrent: false });
const {
  rover: alien,
  chassis: roverChassis,
  wheelSpinners: roverWheels,
  frontWheelMounts,
  roverThrusters,
  driver: { legs, arms },
} = buildMarsRover(alienDriver);

/* ---------- Ares rock garage + efficient vehicle suite ---------- */

const rockGarage = buildRockGarage({
  THREE,
  normal: GARAGE_NORMAL,
  heading: GARAGE_OUTWARD_HEADING,
  position: surfaceWorldPosition(GARAGE_NORMAL, 0.08),
  quaternion: surfaceVehicleQuaternion(GARAGE_NORMAL, GARAGE_OUTWARD_HEADING),
  makeStandardMaterial: stdMat,
  isTouchDevice,
  name: 'ARES MOTOR CAVERN',
  bayLabels: ['G-ROVER', 'ROCKHOPPER', 'DUSTCRAWLER', 'ZEPHYR SKIMMER'],
});
scene.add(rockGarage.root);
rockGarage.updateWorldAnchors();
rockGarage.root.traverse((child) => {
  if (!child.isMesh && !child.isInstancedMesh) return;
  child.castShadow = false;
  child.receiveShadow = true;
});

const vehicleSuite = buildMarsVehicleSuite({
  rockhopper: { name: 'Rockhopper' },
  dustcrawler: { name: 'Dustcrawler', treadSegments: isTouchDevice ? 22 : 28 },
  zephyrSkimmer: { name: 'Zephyr Skimmer' },
});

const VEHICLE_PROFILES = {
  'g-rover': {
    label: 'G-ROVER', locomotion: 'wheel-hover', maxForwardSpeed: 16, maxReverseSpeed: 8,
    acceleration: 5.8, braking: 11, coastDrag: 3.3, turnRate: 1.65,
    stationarySteering: 0.2, fullSteerSpeed: 3.2, collisionRadius: 1.45,
    collisionBounce: 0.08, halfWheelbase: 1.45, halfTrack: 1.25, wheelRadius: 0.79,
    caveAllowed: true, caveMaxSpeed: 8.5, boardRadius: 4.4, exitSpeed: 1.2,
    terrainHz: isTouchDevice ? 24 : 30, dustScale: 1, cameraHeight: 20, cameraTrail: -18,
    driverPosition: [0, 0.42, 0.28], driverScale: 0.9,
    lift: { fuel: 5.5, initialRise: 0.8, targetHeight: 14, acceleration: 25.5, maxRise: 11.5, spoolUp: 5.8, spoolDown: 13, dropSpeed: -2.8 },
  },
  rockhopper: {
    label: 'ROCKHOPPER', locomotion: 'wheel-hop', maxForwardSpeed: 22, maxReverseSpeed: 10,
    acceleration: 8.4, braking: 14, coastDrag: 4.6, turnRate: 2.25,
    stationarySteering: 0.12, fullSteerSpeed: 4, collisionRadius: 1.25,
    collisionBounce: 0.16, halfWheelbase: 1.22, halfTrack: 1.02, wheelRadius: 0.72,
    caveAllowed: true, caveMaxSpeed: 8.5, boardRadius: 4.2, exitSpeed: 1.25,
    terrainHz: isTouchDevice ? 30 : 45, dustScale: 1.25, cameraHeight: 16, cameraTrail: -16,
    driverPosition: [0, 0, 0], driverScale: 0.72,
    lift: { fuel: 3, initialRise: 2.2, targetHeight: 9, acceleration: 31, maxRise: 14, spoolUp: 9, spoolDown: 17, dropSpeed: -3.4 },
  },
  dustcrawler: {
    label: 'DUSTCRAWLER', locomotion: 'tracked-heavy', maxForwardSpeed: 10, maxReverseSpeed: 5.5,
    acceleration: 2.7, braking: 7.5, coastDrag: 2.2, turnRate: 1.05,
    stationarySteering: 0.75, fullSteerSpeed: 2.2, collisionRadius: 2.2,
    collisionBounce: 0.02, halfWheelbase: 2.2, halfTrack: 1.7, wheelRadius: 0.58,
    caveAllowed: false, caveMaxSpeed: 0, boardRadius: 5, exitSpeed: 0.8,
    terrainHz: isTouchDevice ? 20 : 24, dustScale: 1.8, cameraHeight: 24, cameraTrail: -23,
    driverPosition: [0, 0.08, -1.35], driverScale: 0.7,
    lift: { fuel: 1.6, initialRise: 0.35, targetHeight: 2.2, acceleration: 14, maxRise: 3.8, spoolUp: 4, spoolDown: 10, dropSpeed: -3.8 },
  },
  'zephyr-skimmer': {
    label: 'ZEPHYR SKIMMER', locomotion: 'hover-drift', maxForwardSpeed: 28, maxReverseSpeed: 12,
    acceleration: 10.5, braking: 12, coastDrag: 2, turnRate: 1.85,
    stationarySteering: 0.25, fullSteerSpeed: 7, collisionRadius: 1.65,
    collisionBounce: 0.05, halfWheelbase: 1.55, halfTrack: 1.4, wheelRadius: 1,
    caveAllowed: false, caveMaxSpeed: 0, boardRadius: 4.6, exitSpeed: 1.2,
    terrainHz: isTouchDevice ? 20 : 24, dustScale: 0.5, cameraHeight: 18, cameraTrail: -22,
    driverPosition: [0, -0.35, -0.38], driverScale: 0.68,
    lift: { fuel: 4.2, initialRise: 0.95, targetHeight: 7.5, acceleration: 29, maxRise: 10.5, spoolUp: 8, spoolDown: 15, dropSpeed: -3.1 },
  },
};

let gRoverWheelDistance = 0;
const gRoverRuntime = {
  id: 'g-rover',
  label: 'G-ROVER',
  root: roverChassis,
  chassis: roverChassis,
  seat: roverChassis,
  wheels: roverWheels,
  steeringNodes: frontWheelMounts,
  thrusterVisual: roverThrusters,
  profile: VEHICLE_PROFILES['g-rover'],
  updateMotion({ distance = gRoverWheelDistance, steering = 0, thrust = 0, time = 0 } = {}) {
    const deltaDistance = distance - gRoverWheelDistance;
    gRoverWheelDistance = distance;
    roverWheels.forEach((wheel) => { wheel.rotation.x -= deltaDistance / 0.79; });
    frontWheelMounts.forEach((mount) => {
      mount.rotation.y = THREE.MathUtils.damp(mount.rotation.y, steering * 0.42, 10, 1 / 60);
    });
    roverThrusters.visible = thrust > 0.015;
    if (roverThrusters.visible) roverThrusters.scale.y = (0.34 + thrust * 0.9) * (0.94 + Math.sin(time * 57) * 0.06);
  },
};

function createVehicleRuntime(id, label, vehicle, profile, chassis) {
  return {
    id,
    label,
    root: vehicle.root,
    chassis,
    seat: vehicle.seat,
    wheels: vehicle.wheels || [],
    steeringNodes: vehicle.frontWheelMounts || [],
    thrusterVisual: vehicle.thrusterFlames || null,
    updateMotion: vehicle.updateMotion,
    profile,
    parkedNormal: new THREE.Vector3(),
    parkedHeading: new THREE.Vector3(),
    parked: true,
  };
}

Object.assign(gRoverRuntime, {
  parkedNormal: new THREE.Vector3(),
  parkedHeading: new THREE.Vector3(),
  parked: true,
});
const vehicleRuntimes = [
  gRoverRuntime,
  createVehicleRuntime('rockhopper', 'ROCKHOPPER', vehicleSuite.rockhopper, VEHICLE_PROFILES.rockhopper, vehicleSuite.rockhopper.chassis),
  createVehicleRuntime('dustcrawler', 'DUSTCRAWLER', vehicleSuite.dustcrawler, VEHICLE_PROFILES.dustcrawler, vehicleSuite.dustcrawler.body),
  createVehicleRuntime('zephyr-skimmer', 'ZEPHYR SKIMMER', vehicleSuite.zephyrSkimmer, VEHICLE_PROFILES['zephyr-skimmer'], vehicleSuite.zephyrSkimmer.driftRoot),
];

function parkVehicleAtGarageBay(runtime, bay) {
  scene.add(runtime.root);
  runtime.root.matrixAutoUpdate = true;
  runtime.root.position.copy(bay.world.parkingPosition);
  runtime.root.quaternion.copy(bay.world.parkingQuaternion);
  runtime.parkedNormal.copy(runtime.root.position).normalize();
  runtime.parkedHeading.copy(bay.world.outward)
    .addScaledVector(runtime.parkedNormal, -bay.world.outward.dot(runtime.parkedNormal))
    .normalize();
  runtime.parked = true;
  runtime.root.updateMatrix();
  runtime.root.matrixAutoUpdate = false;
}

vehicleRuntimes.forEach((runtime, index) => parkVehicleAtGarageBay(runtime, rockGarage.bays[index]));
let activeVehicle = null;
let activeProfile = null;
let activeVehicleTravelDistance = 0;
let vehicleLateralSpeed = 0;
let vehicleVisualAccumulator = 0;
let garageDepartureCamera = false;

const footRoot = new THREE.Group();
footRoot.name = 'Alien on foot';
footRoot.visible = false;
scene.add(footRoot);

let travelMode = 'walking';
let currentWorld = 'mars';
let footNormal = START_NORMAL.clone();
let footHeading = new THREE.Vector3(0, 0, -1);
let footSpeed = 0;
let alienSwimming = false;
let oasisBoatSpeed = 0;
const oasisBoatMoveAxis = new THREE.Vector3();
const oasisBoatCandidateNormal = new THREE.Vector3();
const oasisBoatCandidateHeading = new THREE.Vector3();
const oasisBoatExitDirection = new THREE.Vector3();
let footJumpHeight = 0;
let footVerticalVelocity = 0;
let footGrounded = true;
const WALK_SPEED_BY_WORLD = { mars: 11.4, moon: 8.6, zephyra: 10.2 };
const FOOT_THRUSTER_FUEL_MAX = 3.2;
const ROVER_THRUSTER_FUEL_MAX = 5.5;
let footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
let roverThrusterFuel = ROVER_THRUSTER_FUEL_MAX;
let footThrusterWasActive = false;
let roverThrusterWasActive = false;
let roverLiftSpool = 0;
let shuttleLocation = 'mars';
let shuttleTransit = null;
let shuttleDisplaySpeed = 0;
let shuttleDockTimer = SHUTTLE_DOCK_DURATION;
const HYPERBIKE_BOARD_RADIUS = 5.8;
const HYPERBIKE_TRAVEL_DURATION = 7.2;
let hyperBikeLocation = 'moon';
let hyperBikeTransit = null;
let hyperBikeDisplaySpeed = 0;
const zephyraFluxToward = new THREE.Vector3();
const zephyraFluxAxis = new THREE.Vector3();

/* ---------- procedural soundscape ---------- */

const audioToggleEl = document.getElementById('audio-toggle');
const audioStateEl = document.getElementById('audio-state');
let audioContext = null;
let audioMasterGain = null;
let ambientBusGain = null;
let chillHopBusGain = null;
let engineBusGain = null;
let engineFilter = null;
let engineOscillator = null;
let engineSubOscillator = null;
let engineNoiseGain = null;
let thrusterBusGain = null;
let thrusterNoiseFilter = null;
let thrusterToneOscillator = null;
let thrusterSubOscillator = null;
let caveWaterGain = null;
let caveWaterFilter = null;
let audioEnabled = true;
let audioStarted = false;
let audioSystemReady = false;
let audioStartPromise = null;

const AUDIO_SYNTHESIS_CHUNK_SIZE = 8192;

function yieldAudioSynthesis() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function updateAudioIndicator() {
  audioToggleEl.classList.toggle('audio-live', audioStarted && audioEnabled);
  audioToggleEl.setAttribute('aria-pressed', String(audioEnabled));
  audioStateEl.textContent = !audioStarted ? 'TAP TO START' : audioEnabled ? 'ON' : 'OFF';
  audioToggleEl.setAttribute(
    'aria-label',
    !audioStarted ? 'Start game soundtrack' : audioEnabled ? 'Mute game soundtrack' : 'Enable game soundtrack'
  );
}

async function createBrownNoiseBuffer(context, seconds = 3) {
  const frameCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let lastSample = 0;
  for (let start = 0; start < frameCount; start += AUDIO_SYNTHESIS_CHUNK_SIZE) {
    const end = Math.min(frameCount, start + AUDIO_SYNTHESIS_CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      const white = Math.random() * 2 - 1;
      lastSample = (lastSample + white * 0.025) / 1.025;
      samples[i] = lastSample * 3.2;
    }
    if (end < frameCount) await yieldAudioSynthesis();
  }
  return buffer;
}

async function createWhiteNoiseBuffer(context, seconds = 2) {
  const frameCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let start = 0; start < frameCount; start += AUDIO_SYNTHESIS_CHUNK_SIZE) {
    const end = Math.min(frameCount, start + AUDIO_SYNTHESIS_CHUNK_SIZE);
    for (let i = start; i < end; i++) samples[i] = Math.random() * 2 - 1;
    if (end < frameCount) await yieldAudioSynthesis();
  }
  return buffer;
}

async function createChillHopBuffer(context) {
  const bpm = 72;
  const beatDuration = 60 / bpm;
  // Sixteen beats complete the four-chord progression. The old 32-beat
  // buffer repeated the same structure and doubled first-use synthesis work.
  const duration = beatDuration * 16;
  const frameCount = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  const roots = [110, 98, 82.41, 92.5];
  const melody = [2, 2.244, 2.52, 2.244, 2, 1.887, 1.682, 1.887, 2, 2.52, 2.244, 1.887, 1.682, 1.498, 1.682, 1.887];
  let noiseSeed = 0x325a91;
  let previousNoise = 0;

  for (let start = 0; start < frameCount; start += AUDIO_SYNTHESIS_CHUNK_SIZE) {
    const end = Math.min(frameCount, start + AUDIO_SYNTHESIS_CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      const time = i / context.sampleRate;
      const beat = time / beatDuration;
      const beatIndex = Math.floor(beat);
      const beatFraction = beat - beatIndex;
      const chordRoot = roots[Math.floor(beat / 4) % roots.length];
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      const noise = (noiseSeed / 0xffffffff) * 2 - 1;
      const highNoise = noise - previousNoise;
      previousNoise = noise;

      const padWobble = 0.82 + Math.sin(time * Math.PI * 0.34) * 0.08;
      const chord = (
        Math.sin(Math.PI * 2 * chordRoot * time) * 0.068
        + Math.sin(Math.PI * 2 * chordRoot * 1.1892 * time) * 0.052
        + Math.sin(Math.PI * 2 * chordRoot * 1.4983 * time) * 0.043
        + Math.sin(Math.PI * 2 * chordRoot * 0.5 * time) * 0.035
      ) * padWobble;

      const stepIndex = Math.floor(beat * 2) % melody.length;
      const stepPhase = (beat * 2 - Math.floor(beat * 2)) * beatDuration * 0.5;
      const melodyEnvelope = Math.exp(-stepPhase * 3.7) * (stepIndex % 4 === 3 ? 0.35 : 1);
      const melodyTone = Math.sin(Math.PI * 2 * chordRoot * melody[stepIndex] * time) * melodyEnvelope * 0.034;

      const kickPhase = beatFraction * beatDuration;
      const kickActive = beatIndex % 4 === 0 || beatIndex % 4 === 2;
      const kick = kickActive
        ? Math.sin(Math.PI * 2 * (48 + Math.exp(-kickPhase * 18) * 42) * kickPhase) * Math.exp(-kickPhase * 13) * 0.2
        : 0;

      const snareActive = beatIndex % 4 === 1 || beatIndex % 4 === 3;
      const snare = snareActive ? highNoise * Math.exp(-kickPhase * 18) * 0.055 : 0;
      const halfBeatPhase = (beat * 2 - Math.floor(beat * 2)) * beatDuration * 0.5;
      const brushedHat = highNoise * Math.exp(-halfBeatPhase * 42) * 0.018;
      const vinyl = noise * 0.0035;
      samples[i] = THREE.MathUtils.clamp((chord + melodyTone + kick + snare + brushedHat + vinyl) * 0.82, -0.72, 0.72);
    }
    if (end < frameCount) await yieldAudioSynthesis();
  }
  return buffer;
}

function buildGlobalChillHopAudio(context, output, chillHopBuffer) {
  const now = context.currentTime;
  const chillSource = context.createBufferSource();
  chillSource.buffer = chillHopBuffer;
  chillSource.loop = true;
  const chillFilter = context.createBiquadFilter();
  chillFilter.type = 'lowpass';
  chillFilter.frequency.setValueAtTime(2100, now);
  chillFilter.Q.setValueAtTime(0.48, now);
  const chillWarmthFilter = context.createBiquadFilter();
  chillWarmthFilter.type = 'highpass';
  chillWarmthFilter.frequency.setValueAtTime(46, now);
  chillWarmthFilter.Q.setValueAtTime(0.36, now);
  chillHopBusGain = context.createGain();
  chillHopBusGain.gain.setValueAtTime(0.12, now);
  chillSource.connect(chillWarmthFilter).connect(chillFilter).connect(chillHopBusGain).connect(output);
  chillSource.start(now);
}

async function buildAudioSystem() {
  if (audioSystemReady) return true;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    audioEnabled = false;
    audioStateEl.textContent = 'N/A';
    audioToggleEl.disabled = true;
    audioToggleEl.setAttribute('aria-pressed', 'false');
    return false;
  }

  audioContext = new AudioContextClass();
  // Resume immediately while this call still belongs to the user gesture.
  // The expensive buffer synthesis below yields between small chunks.
  const resumePromise = audioContext.state === 'running'
    ? Promise.resolve()
    : audioContext.resume().catch(() => {});
  const [chillHopBuffer, brownNoiseBuffer, whiteNoiseBuffer] = await Promise.all([
    createChillHopBuffer(audioContext),
    createBrownNoiseBuffer(audioContext),
    createWhiteNoiseBuffer(audioContext),
  ]);
  const now = audioContext.currentTime;

  audioMasterGain = audioContext.createGain();
  audioMasterGain.gain.setValueAtTime(0.0001, now);
  const limiter = audioContext.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-22, now);
  limiter.knee.setValueAtTime(14, now);
  limiter.ratio.setValueAtTime(5, now);
  limiter.attack.setValueAtTime(0.018, now);
  limiter.release.setValueAtTime(0.32, now);
  audioMasterGain.connect(limiter).connect(audioContext.destination);

  buildGlobalChillHopAudio(audioContext, audioMasterGain, chillHopBuffer);

  ambientBusGain = audioContext.createGain();
  ambientBusGain.gain.setValueAtTime(0.052, now);
  ambientBusGain.connect(audioMasterGain);

  const droneFilter = audioContext.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.setValueAtTime(145, now);
  droneFilter.Q.setValueAtTime(0.8, now);
  droneFilter.connect(ambientBusGain);

  const droneA = audioContext.createOscillator();
  const droneAGain = audioContext.createGain();
  droneA.type = 'sine';
  droneA.frequency.setValueAtTime(36, now);
  droneAGain.gain.setValueAtTime(0.58, now);
  droneA.connect(droneAGain).connect(droneFilter);

  const droneB = audioContext.createOscillator();
  const droneBGain = audioContext.createGain();
  droneB.type = 'triangle';
  droneB.frequency.setValueAtTime(54.35, now);
  droneBGain.gain.setValueAtTime(0.22, now);
  droneB.connect(droneBGain).connect(droneFilter);

  const ambienceLfo = audioContext.createOscillator();
  const ambienceLfoGain = audioContext.createGain();
  ambienceLfo.type = 'sine';
  ambienceLfo.frequency.setValueAtTime(0.07, now);
  ambienceLfoGain.gain.setValueAtTime(0.008, now);
  ambienceLfo.connect(ambienceLfoGain).connect(ambientBusGain.gain);

  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = brownNoiseBuffer;
  noiseSource.loop = true;
  const spaceNoiseFilter = audioContext.createBiquadFilter();
  const spaceNoiseGain = audioContext.createGain();
  spaceNoiseFilter.type = 'bandpass';
  spaceNoiseFilter.frequency.setValueAtTime(240, now);
  spaceNoiseFilter.Q.setValueAtTime(0.45, now);
  spaceNoiseGain.gain.setValueAtTime(0.09, now);
  noiseSource.connect(spaceNoiseFilter).connect(spaceNoiseGain).connect(ambientBusGain);

  engineBusGain = audioContext.createGain();
  engineBusGain.gain.setValueAtTime(0.012, now);
  engineBusGain.connect(audioMasterGain);
  engineFilter = audioContext.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.setValueAtTime(115, now);
  engineFilter.Q.setValueAtTime(1.25, now);
  engineFilter.connect(engineBusGain);

  engineOscillator = audioContext.createOscillator();
  const engineToneGain = audioContext.createGain();
  engineOscillator.type = 'sawtooth';
  engineOscillator.frequency.setValueAtTime(32, now);
  engineToneGain.gain.setValueAtTime(0.55, now);
  engineOscillator.connect(engineToneGain).connect(engineFilter);

  engineSubOscillator = audioContext.createOscillator();
  const engineSubGain = audioContext.createGain();
  engineSubOscillator.type = 'triangle';
  engineSubOscillator.frequency.setValueAtTime(16, now);
  engineSubGain.gain.setValueAtTime(0.38, now);
  engineSubOscillator.connect(engineSubGain).connect(engineFilter);

  const engineNoiseFilter = audioContext.createBiquadFilter();
  engineNoiseFilter.type = 'bandpass';
  engineNoiseFilter.frequency.setValueAtTime(88, now);
  engineNoiseFilter.Q.setValueAtTime(0.9, now);
  engineNoiseGain = audioContext.createGain();
  engineNoiseGain.gain.setValueAtTime(0.075, now);
  noiseSource.connect(engineNoiseFilter).connect(engineNoiseGain).connect(engineFilter);

  thrusterBusGain = audioContext.createGain();
  thrusterBusGain.gain.setValueAtTime(0.0001, now);
  thrusterBusGain.connect(audioMasterGain);
  thrusterNoiseFilter = audioContext.createBiquadFilter();
  thrusterNoiseFilter.type = 'bandpass';
  thrusterNoiseFilter.frequency.setValueAtTime(420, now);
  thrusterNoiseFilter.Q.setValueAtTime(0.88, now);
  thrusterNoiseFilter.connect(thrusterBusGain);

  const thrusterNoiseSource = audioContext.createBufferSource();
  thrusterNoiseSource.buffer = whiteNoiseBuffer;
  thrusterNoiseSource.loop = true;
  thrusterNoiseSource.connect(thrusterNoiseFilter);

  caveWaterGain = audioContext.createGain();
  caveWaterGain.gain.setValueAtTime(0.0001, now);
  caveWaterGain.connect(audioMasterGain);
  caveWaterFilter = audioContext.createBiquadFilter();
  caveWaterFilter.type = 'lowpass';
  caveWaterFilter.frequency.setValueAtTime(680, now);
  caveWaterFilter.Q.setValueAtTime(0.55, now);
  caveWaterFilter.connect(caveWaterGain);
  thrusterNoiseSource.connect(caveWaterFilter);

  thrusterToneOscillator = audioContext.createOscillator();
  const thrusterToneGain = audioContext.createGain();
  thrusterToneOscillator.type = 'triangle';
  thrusterToneOscillator.frequency.setValueAtTime(48, now);
  thrusterToneGain.gain.setValueAtTime(0.085, now);
  thrusterToneOscillator.connect(thrusterToneGain).connect(thrusterBusGain);

  thrusterSubOscillator = audioContext.createOscillator();
  const thrusterSubGain = audioContext.createGain();
  thrusterSubOscillator.type = 'sine';
  thrusterSubOscillator.frequency.setValueAtTime(28, now);
  thrusterSubGain.gain.setValueAtTime(0.26, now);
  thrusterSubOscillator.connect(thrusterSubGain).connect(thrusterBusGain);

  droneA.start(now);
  droneB.start(now);
  ambienceLfo.start(now);
  noiseSource.start(now);
  engineOscillator.start(now);
  engineSubOscillator.start(now);
  thrusterNoiseSource.start(now);
  thrusterToneOscillator.start(now);
  thrusterSubOscillator.start(now);
  // Some browsers leave resume() pending until they finish validating the
  // gesture. The graph is ready regardless, so do not keep the entire build
  // promise chained to that browser-controlled state transition.
  void resumePromise;
  audioSystemReady = true;
  return true;
}

function ensureMarsAudio() {
  if (!audioEnabled || (audioStarted && audioContext?.state === 'running')) return Promise.resolve();
  if (audioStartPromise) return audioStartPromise;
  audioStartPromise = (async () => {
    try {
      const wasStarted = audioStarted;
      if (!await buildAudioSystem()) return;
      if (audioContext.state !== 'running') {
        audioContext.resume().then(() => {
          if (audioContext.state !== 'running') return;
          audioStarted = true;
          const resumedAt = audioContext.currentTime;
          audioMasterGain.gain.cancelScheduledValues(resumedAt);
          audioMasterGain.gain.setTargetAtTime(0.78, resumedAt, 0.22);
          updateAudioIndicator();
          if (!wasStarted) showBanner('CHILLHOP SOUNDTRACK · PLAYING SOFTLY');
        }).catch(() => {});
        updateAudioIndicator();
        return;
      }
      audioStarted = audioContext.state === 'running';
      const now = audioContext.currentTime;
      audioMasterGain.gain.cancelScheduledValues(now);
      audioMasterGain.gain.setTargetAtTime(0.78, now, 0.22);
      updateAudioIndicator();
      if (audioStarted && !wasStarted) showBanner('CHILLHOP SOUNDTRACK · PLAYING SOFTLY');
    } catch (error) {
      console.warn('Mars audio could not start:', error);
    } finally {
      audioStartPromise = null;
    }
  })();
  return audioStartPromise;
}

function muteMarsAudio() {
  if (!audioContext || !audioMasterGain) return;
  const now = audioContext.currentTime;
  audioMasterGain.gain.cancelScheduledValues(now);
  audioMasterGain.gain.setTargetAtTime(0.0001, now, 0.08);
}

function updateRoverAudio(speed, throttleInput) {
  if (!audioStarted || !audioEnabled || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const speedRatio = THREE.MathUtils.clamp(Math.abs(speed) / (activeProfile?.maxForwardSpeed || 16), 0, 1);
  const throttle = Math.abs(throttleInput);
  const baseFrequency = 32 + speedRatio * 43 + throttle * 4;
  engineOscillator.frequency.setTargetAtTime(baseFrequency, now, 0.09);
  engineSubOscillator.frequency.setTargetAtTime(baseFrequency * 0.5, now, 0.11);
  engineFilter.frequency.setTargetAtTime(115 + speedRatio * 250 + throttle * 35, now, 0.12);
  engineBusGain.gain.setTargetAtTime(0.012 + speedRatio * 0.043 + throttle * 0.006, now, 0.1);
  engineNoiseGain.gain.setTargetAtTime(0.075 + speedRatio * 0.1, now, 0.15);
}

function updateThrusterAudio(active, isRover, pulse) {
  if (!audioStarted || !audioEnabled || audioContext.state !== 'running' || !thrusterBusGain) return;
  const now = audioContext.currentTime;
  const pulseLevel = THREE.MathUtils.clamp(pulse, 0, 1);
  const targetGain = active ? (isRover ? 0.04 : 0.029) * (0.58 + pulseLevel * 0.42) : 0.0001;
  thrusterBusGain.gain.setTargetAtTime(targetGain, now, active ? 0.012 : 0.025);
  thrusterNoiseFilter.frequency.setTargetAtTime((isRover ? 270 : 390) + pulseLevel * 240, now, 0.018);
  thrusterToneOscillator.frequency.setTargetAtTime((isRover ? 42 : 54) + pulseLevel * 18, now, 0.018);
  thrusterSubOscillator.frequency.setTargetAtTime((isRover ? 25 : 32) + pulseLevel * 11, now, 0.014);
}

audioToggleEl.addEventListener('click', () => {
  if (!audioStarted) {
    audioEnabled = true;
    ensureMarsAudio();
    return;
  }
  audioEnabled = !audioEnabled;
  if (audioEnabled) ensureMarsAudio();
  else muteMarsAudio();
  updateAudioIndicator();
});

window.addEventListener('keydown', () => ensureMarsAudio(), { passive: true });
window.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#audio-toggle')) ensureMarsAudio();
}, { passive: true });
updateAudioIndicator();

/* ---------- input ---------- */

const keys = {};
const caveWarpButtonEl = document.getElementById('cave-warp-btn');
let lookingAtCamera = false;
let jumpQueued = false;
let interactionQueued = false;

function resetCaveTravelState() {
  caveTravelZone = 'surface';
  caveRouteDistance = 0;
  caveRouteFacing = 1;
  caveLateral = 0;
  caveLocalPosition.copy(CAVE_ROUTE_POINTS[0]);
  caveLocalForward.set(0, 0, -1);
  caveLocalUp.copy(UP);
  caveEntryBlend = 1;
  caveDarkness = 0;
  caveWasInside = false;
  mineTrainSpeed = 0;
  caveFootSpeed = 0;
  caveFootLocalPosition.copy(CAVE_FOOT_STATION_LOCAL);
  caveFootHeading.set(0, 0, -1);
  if (hubRuntime.nightfall?.mineTrain) {
    hubRuntime.nightfall.mineTrain.update({ distance: 0, direction: 1, speed: 0, dt: 0, time: 0, visible: true });
    hubRuntime.nightfall.mineTrain.infrastructure.visible = false;
  }
  if (scene.fog === caveFog) scene.fog = null;
  renderer.toneMappingExposure = 1.12;
  caveWarpButtonEl.classList.remove('show');
  caveWarpButtonEl.setAttribute('aria-hidden', 'true');
}

function warpToMarsStart() {
  if (travelMode !== 'driving' || caveTravelZone === 'surface') return;
  resetCaveTravelState();
  playerNormal.copy(START_NORMAL);
  playerHeading.set(0, 0, -1);
  currentWorld = 'mars';
  driveSpeed = 0;
  verticalVelocity = 0;
  jumpHeight = 0;
  grounded = true;
  roverLiftSpool = 0;
  roverThrusterWasActive = false;
  roverThrusterFuel = activeProfile?.lift.fuel || ROVER_THRUSTER_FUEL_MAX;
  if (activeVehicle?.thrusterVisual) activeVehicle.thrusterVisual.visible = false;
  alien.position.copy(surfaceWorldPosition(START_NORMAL));
  alien.quaternion.copy(surfaceVehicleQuaternion(START_NORMAL, playerHeading));
  camLookTarget.copy(alien.position).addScaledVector(START_NORMAL, 2.2);
  camera.position.copy(alien.position).addScaledVector(START_NORMAL, 18).addScaledVector(playerHeading, -16);
  camera.up.copy(START_NORMAL);
  camera.lookAt(camLookTarget);
  showBanner(`WARP COMPLETE · ${activeVehicle?.label || 'VEHICLE'} AT MARS START`);
}

function returnActiveVehicleToGarage() {
  if (!activeVehicle) return;
  const runtime = activeVehicle;
  if (runtime.thrusterVisual) runtime.thrusterVisual.visible = false;
  if (runtime.chassis !== runtime.root) {
    runtime.chassis.rotation.x = 0;
    runtime.chassis.rotation.z = 0;
    runtime.chassis.position.y = runtime.chassisBaseY || 0;
  }
  const bayIndex = vehicleRuntimes.indexOf(runtime);
  const bay = rockGarage.bays[bayIndex];
  if (bay) parkVehicleAtGarageBay(runtime, bay);
  activeVehicle = null;
  activeProfile = null;
}

function warpAlienHome() {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  jumpQueued = false;
  interactionQueued = false;
  lookingAtCamera = false;

  if (ufoInteriorActive) exitUfoInterior();
  returnActiveVehicleToGarage();
  oasisLake.boat.label.visible = true;
  oasisLake.boat.wakes.forEach((wake) => { wake.material.opacity = 0; });
  oasisBoatSpeed = 0;
  resetCaveTravelState();

  currentWorld = 'mars';
  travelMode = 'walking';
  playerNormal.copy(START_NORMAL);
  playerHeading.set(0, 0, -1);
  attachAlienOnFoot('mars', START_NORMAL, playerHeading);
  alien.position.copy(surfaceWorldPosition(START_NORMAL));
  alien.quaternion.copy(surfaceVehicleQuaternion(START_NORMAL, playerHeading));
  alienDriver.thrusterFlames.visible = false;
  footSpeed = 0;
  alienSwimming = false;
  driveSpeed = 0;
  vehicleLateralSpeed = 0;
  verticalVelocity = 0;
  jumpHeight = 0;
  grounded = true;
  roverLiftSpool = 0;
  roverThrusterWasActive = false;
  footThrusterWasActive = false;
  roverThrusterFuel = ROVER_THRUSTER_FUEL_MAX;
  footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
  garageDepartureCamera = false;
  moonCommandInterior = 0;
  alienHomeInterior = 0;
  drivingCourses.reset();
  drivingCoursePrompt = '';
  activeDrivingCourse = null;

  camLookTarget.copy(footRoot.position).addScaledVector(START_NORMAL, 2.2).addScaledVector(playerHeading, 2.2);
  camera.position.copy(footRoot.position).addScaledVector(START_NORMAL, 10.5).addScaledVector(playerHeading, -11);
  camera.up.copy(START_NORMAL);
  camera.lookAt(camLookTarget);
  showBanner('HOME WARP COMPLETE · CENTRAL TRAILHEAD');
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;
  if (key === 'q' && !e.repeat) {
    const modes = ['auto', 'high', 'medium', 'low'];
    const nextMode = modes[(modes.indexOf(qualityManager.mode) + 1) % modes.length];
    const snapshot = qualityManager.setMode(nextMode);
    showBanner(`VISUAL QUALITY · ${snapshot.mode.toUpperCase()} · ${snapshot.tier.toUpperCase()}`);
  }
  if (key === 'f' && !e.repeat) lookingAtCamera = !lookingAtCamera;
  if (key === 'e' && !e.repeat) interactionQueued = true;
  if (key === 'r' && !e.repeat) warpToMarsStart();
  if (key === 'h' && !e.repeat) warpAlienHome();
  if ((key === ' ' || key === 'spacebar') && !e.repeat) {
    e.preventDefault();
    jumpQueued = true;
  }
});
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

document.querySelectorAll('.dpad-btn').forEach((btn) => {
  const key = btn.dataset.key;
  const press = (e) => {
    e.preventDefault();
    keys[key] = true;
  };
  const release = (e) => {
    e.preventDefault();
    keys[key] = false;
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

document.getElementById('look-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  lookingAtCamera = !lookingAtCamera;
});

document.getElementById('jump-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keys[' '] = true;
  jumpQueued = true;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
  document.getElementById('jump-btn').addEventListener(eventName, (e) => {
    e.preventDefault();
    keys[' '] = false;
  });
});

document.getElementById('action-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  interactionQueued = true;
});

caveWarpButtonEl.addEventListener('click', (e) => {
  e.preventDefault();
  warpAlienHome();
});

/* ---------- in-world project archive ---------- */

const PORTFOLIO_HUB_KEY = 'outpost';
const PORTFOLIO_REVEAL_RADIUS = 11.5 * PROJECT_SHIP_SCALE;
const PROJECT_INTERIOR_ENTER_RADIUS = 10.8;
const PROJECT_INTERIOR_EXIT_RADIUS = 12.6;
let ufoInteriorActive = false;
let ufoProjectScreensRequested = false;
const projectRampCenterNormal = new THREE.Vector3();

function isNearUfoEntry(normal) {
  if (currentWorld !== 'mars' || !normal) return false;
  const portfolioHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  return arcDistanceForWorld('mars', normal, portfolioHub.normal) < PORTFOLIO_REVEAL_RADIUS;
}

function projectRampDeckLift(normal) {
  if (currentWorld !== 'mars' || !normal) return 0;
  const ramp = hubRuntime.outpost?.rampSurface;
  if (!ramp) return 0;
  const alongAngle = Math.atan2(normal.dot(ramp.forwardStart), normal.dot(ramp.startNormal));
  if (alongAngle < -0.012 || alongAngle > ramp.arcAngle + 0.025) return 0;
  const routeRatio = THREE.MathUtils.clamp(alongAngle / ramp.arcAngle, 0, 1);
  if (ramp.arcAngle < 0.0001) {
    projectRampCenterNormal.copy(ramp.startNormal);
  } else {
    const sinAngle = Math.sin(ramp.arcAngle);
    projectRampCenterNormal.copy(ramp.startNormal)
      .multiplyScalar(Math.sin((1 - routeRatio) * ramp.arcAngle) / sinAngle)
      .addScaledVector(ramp.endNormal, Math.sin(routeRatio * ramp.arcAngle) / sinAngle)
      .normalize();
  }
  const lateralDistance = Math.acos(THREE.MathUtils.clamp(normal.dot(projectRampCenterNormal), -1, 1)) * PLANET_RADIUS;
  if (lateralDistance > ramp.halfWidth + 0.24) return 0;
  const terrainContact = THREE.MathUtils.smoothstep(routeRatio, 0, 0.46);
  return THREE.MathUtils.lerp(ramp.startLift, ramp.endLift, terrainContact);
}

function projectArchiveFloorLift(normal) {
  if (!normal) return 0;
  const portfolioHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const distance = arcDistanceForWorld('mars', normal, portfolioHub.normal);
  const insideBlend = 1 - THREE.MathUtils.smoothstep(distance, 11.2, 15.2);
  if (insideBlend <= 0) return 0;
  const localSurfaceRadius = PLANET_RADIUS + getSurfaceHeight(portfolioHub.normal);
  const clampedDistance = Math.min(distance, localSurfaceRadius - 0.001);
  const curvatureDrop = localSurfaceRadius
    - Math.sqrt(Math.max(0, localSurfaceRadius * localSurfaceRadius - clampedDistance * clampedDistance));
  return (3.06 + curvatureDrop) * insideBlend;
}

function updatePhysicalUfoInteriorState() {
  if (travelMode !== 'walking' || currentWorld !== 'mars') return;
  const portfolioHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const distance = arcDistanceForWorld('mars', footNormal, portfolioHub.normal);
  if (!ufoInteriorActive && distance < PROJECT_INTERIOR_ENTER_RADIUS) {
    ufoInteriorActive = true;
    hubRuntime.outpost.saucer.visible = false;
    hubRuntime.outpost.archiveLabel.visible = false;
    hubRuntime.outpost.entryFrame.visible = false;
    loadUfoProjectScreens();
    showBanner("PROJECT ARCHIVE ENTERED · WALK FREELY · CLICK A SCREEN");
  } else if (ufoInteriorActive && distance > PROJECT_INTERIOR_EXIT_RADIUS) {
    setHoveredProjectScreen(null);
    ufoInteriorActive = false;
    hubRuntime.outpost.saucer.visible = true;
    hubRuntime.outpost.archiveLabel.visible = true;
    hubRuntime.outpost.entryFrame.visible = true;
    showBanner('UFO HATCH CROSSED · RETURNED TO MARS');
  }
}

function xenobiologyMuseumFloorLift(normal) {
  if (!normal) return 0;
  const distance = arcDistanceForWorld('mars', normal, xenobiologyTrailHub.normal);
  const insideBlend = 1 - THREE.MathUtils.smoothstep(distance, 25.3, 29.1);
  if (insideBlend <= 0) return 0;
  const localSurfaceRadius = PLANET_RADIUS + getSurfaceHeight(xenobiologyTrailHub.normal);
  const clampedDistance = Math.min(distance, localSurfaceRadius - 0.001);
  const curvatureDrop = localSurfaceRadius
    - Math.sqrt(Math.max(0, localSurfaceRadius * localSurfaceRadius - clampedDistance * clampedDistance));
  return (0.68 + curvatureDrop) * insideBlend;
}

const alienHomeLocalProbe = new THREE.Vector3();
let alienHomeInterior = 0;

function alienMountainHomeLocalPosition(normal, target = alienHomeLocalProbe) {
  if (!normal || !hubRuntime.home?.root) return null;
  target.copy(surfaceWorldPosition(normal));
  hubRuntime.home.root.worldToLocal(target);
  return target;
}

function alienMountainHomeFloorLift(normal) {
  if (currentWorld !== 'mars' || !normal || arcDistanceForWorld('mars', normal, ALIEN_MOUNTAIN_HOME.normal) > 34) return 0;
  if (!hubRuntime.home?.local) return 0;
  const local = alienMountainHomeLocalPosition(normal);
  if (!local) return 0;
  const { bounds, thresholdBounds, floorY } = hubRuntime.home.local;
  const onInterior = local.x >= bounds.min.x && local.x <= bounds.max.x
    && local.z >= bounds.min.z && local.z <= bounds.max.z;
  const onThreshold = local.x >= thresholdBounds.min.x && local.x <= thresholdBounds.max.x
    && local.z >= thresholdBounds.min.z && local.z <= thresholdBounds.max.z;
  if (!onInterior && !onThreshold) return 0;
  return Math.max(0, floorY - local.y + 0.025);
}

function isInsideAlienMountainHome(normal = footNormal) {
  if (currentWorld !== 'mars' || !normal || arcDistanceForWorld('mars', normal, ALIEN_MOUNTAIN_HOME.normal) > 20) return false;
  const local = alienMountainHomeLocalPosition(normal);
  const bounds = hubRuntime.home?.local?.bounds;
  return Boolean(bounds
    && local.x >= bounds.min.x + 0.25
    && local.x <= bounds.max.x - 0.25
    && local.z >= bounds.min.z + 0.25
    && local.z <= bounds.max.z - 0.25);
}

function isNearAlienMountainHome(normal = footNormal, radius = 25) {
  return currentWorld === 'mars'
    && normal
    && arcDistanceForWorld('mars', normal, ALIEN_MOUNTAIN_HOME.normal) < radius;
}

function loadUfoProjectScreens() {
  if (ufoProjectScreensRequested) return;
  ufoProjectScreensRequested = true;
  const textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin('anonymous');
  hubRuntime.outpost.projectScreens.forEach((screen) => {
    if (!screen.project.preview) {
      screen.loaded = true;
      return;
    }
    textureLoader.load(screen.project.preview, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const placeholder = screen.material.map;
      screen.material.map = texture;
      screen.material.needsUpdate = true;
      screen.loaded = true;
      placeholder?.dispose();
    }, undefined, () => {
      screen.loaded = false;
    });
  });
}

const projectScreenRaycaster = new THREE.Raycaster();
const projectScreenPointer = new THREE.Vector2(2, 2);
let hoveredProjectScreen = null;

function setHoveredProjectScreen(nextScreen) {
  if (hoveredProjectScreen === nextScreen) return;
  if (hoveredProjectScreen) {
    hoveredProjectScreen.frameMaterial.emissiveIntensity = 0.32;
    hoveredProjectScreen.material.color.set(0xffffff);
  }
  hoveredProjectScreen = nextScreen;
  if (hoveredProjectScreen) {
    hoveredProjectScreen.frameMaterial.emissiveIntensity = 1.25;
    hoveredProjectScreen.material.color.set(0xd8f8ff);
  }
  renderer.domElement.style.cursor = hoveredProjectScreen ? 'pointer' : '';
}

function projectScreenFromPointer(event) {
  if (!ufoInteriorActive) return null;
  const bounds = renderer.domElement.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  projectScreenPointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1
  );
  projectScreenRaycaster.setFromCamera(projectScreenPointer, camera);
  const targets = hubRuntime.outpost.projectScreens.map((entry) => entry.screen);
  const hit = projectScreenRaycaster.intersectObjects(targets, false)[0];
  return hit ? hubRuntime.outpost.projectScreens[hit.object.userData.projectScreenIndex] : null;
}

function openProjectLive(projectScreen) {
  if (!projectScreen) return;
  const liveWindow = window.open(projectScreen.project.url, '_blank', 'noopener,noreferrer');
  if (liveWindow) liveWindow.opener = null;
  showBanner(projectScreen.project.kind === 'contact'
    ? 'CONTACT TERMINAL · OPENING EMAIL TO CAITLIN'
    : `OPENING LIVE · ${projectScreen.project.title.toUpperCase()}`);
}

renderer.domElement.addEventListener('pointermove', (event) => {
  setHoveredProjectScreen(projectScreenFromPointer(event));
});
renderer.domElement.addEventListener('pointerleave', () => setHoveredProjectScreen(null));
renderer.domElement.addEventListener('click', (event) => {
  if (!ufoInteriorActive) return;
  const selectedScreen = projectScreenFromPointer(event);
  if (selectedScreen) openProjectLive(selectedScreen);
});

function enterUfoInterior() {
  if (travelMode !== 'walking' || !isNearUfoEntry(footNormal)) return;
  ufoInteriorActive = true;
  hubRuntime.outpost.saucer.visible = false;
  hubRuntime.outpost.archiveLabel.visible = false;
  hubRuntime.outpost.entryFrame.visible = false;
  loadUfoProjectScreens();
  showBanner("PROJECT ARCHIVE ONLINE · WALK INSIDE AND SELECT A SCREEN");
}

function exitUfoInterior() {
  if (!ufoInteriorActive) return;
  setHoveredProjectScreen(null);
  ufoInteriorActive = false;
  hubRuntime.outpost.saucer.visible = true;
  hubRuntime.outpost.archiveLabel.visible = true;
  hubRuntime.outpost.entryFrame.visible = true;
  showBanner('WALK BACK THROUGH THE OPEN HATCH TO EXIT');
}

/* ---------- HUD ---------- */

const hubListEl = document.getElementById('hub-list');
SURFACE_WAYPOINT_HUBS.forEach((hub) => {
  const row = document.createElement('div');
  row.className = 'hub-row';
  row.id = `hub-row-${hub.key}`;
  row.innerHTML = `<span class="mark">&#9675;</span>${hub.name}`;
  hubListEl.appendChild(row);
});

const bannerEl = document.getElementById('banner');
let bannerTimeout = null;
function showBanner(text) {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => bannerEl.classList.remove('show'), 2600);
}

function discoverHub(hub) {
  hub.discovered = true;
  const row = document.getElementById(`hub-row-${hub.key}`);
  if (row) {
    row.classList.add('found');
    row.querySelector('.mark').innerHTML = '&#10003;';
  }
  showBanner(`Discovered: ${hub.name}`);
}

const locationLabelEl = document.getElementById('location-label');
const controlsHintEl = document.getElementById('controls-hint');
const gravityValueEl = document.getElementById('gravity-value');
const interactionPromptEl = document.getElementById('interaction-prompt');
const shuttleStatusEl = document.getElementById('shuttle-status');
const shuttleStatusTextEl = document.getElementById('shuttle-status-text');
const shuttleCountdownValueEl = document.getElementById('shuttle-countdown-value');
const shuttleRouteBusEl = document.getElementById('shuttle-route-bus');
const travelBasisRight = new THREE.Vector3();
const travelBasisBack = new THREE.Vector3();
const travelBasisMatrix = new THREE.Matrix4();
const shuttleFlightQuaternion = new THREE.Quaternion();
const shuttleFlightRight = new THREE.Vector3();
const shuttleFlightUp = new THREE.Vector3();
const shuttleFlightBack = new THREE.Vector3();
const shuttleFlightMatrix = new THREE.Matrix4();
const shuttleFlightDelta = new THREE.Vector3();
const hyperBikeFlightDirection = new THREE.Vector3(0, 1, 0);
const hyperBikeFlightRight = new THREE.Vector3();
const hyperBikeFlightUp = new THREE.Vector3();
const hyperBikeFlightBack = new THREE.Vector3();
const hyperBikeFlightMatrix = new THREE.Matrix4();
const hyperBikeFlightDelta = new THREE.Vector3();

function setInteractionPrompt(text) {
  interactionPromptEl.textContent = text;
  interactionPromptEl.classList.toggle('show', Boolean(text));
}

function tangentHeadingForNormal(normal) {
  const reference = Math.abs(normal.y) < 0.88 ? UP : new THREE.Vector3(0, 0, -1);
  return reference.clone().addScaledVector(normal, -reference.dot(normal)).normalize();
}

function stepWorldNormal(normal, direction, distance, radius) {
  const axis = new THREE.Vector3().crossVectors(normal, direction).normalize();
  return normal.clone().applyAxisAngle(axis, distance / radius).normalize();
}

function surfacePositionForWorld(world, normal, offset = 0) {
  if (world === 'moon') return MOON_CENTER.clone().addScaledVector(normal, MOON_RADIUS + getMoonHeight(normal) + offset);
  if (world === 'zephyra') return ZEPHYRA_CENTER.clone().addScaledVector(normal, ZEPHYRA_RADIUS + getZephyraHeight(normal) + offset);
  return surfaceWorldPosition(normal, offset);
}

function arcDistanceForWorld(world, a, b) {
  const radius = world === 'moon' ? MOON_RADIUS : world === 'zephyra' ? ZEPHYRA_RADIUS : PLANET_RADIUS;
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * radius;
}

function orientSurfaceRoot(root, normal, heading) {
  travelBasisRight.copy(heading).cross(normal).normalize();
  travelBasisBack.copy(heading).multiplyScalar(-1);
  travelBasisMatrix.makeBasis(travelBasisRight, normal, travelBasisBack);
  root.quaternion.setFromRotationMatrix(travelBasisMatrix);
}

/* ---------- Lumi · autonomous moon friend ---------- */

const MOON_FRIEND_ACTIVITIES = [
  { id: 'patrol', label: 'PATROLLING LUNA COMMAND', kind: 'walk', target: 'roam', move: true, min: 10, max: 17, speed: 1.45, weight: 1.35, moods: ['FOCUSED', 'BRAVE'] },
  { id: 'life-support', label: 'CHECKING LIFE SUPPORT', kind: 'console', target: 'command', move: true, min: 9, max: 15, speed: 1.25, weight: 1.1, moods: ['RESPONSIBLE', 'FOCUSED'] },
  { id: 'dust-relay', label: 'DUSTING THE SOLAR RELAY', kind: 'repair', target: 'command', move: true, min: 8, max: 14, speed: 1.2, weight: 1, moods: ['HELPFUL', 'BUSY'] },
  { id: 'samples', label: 'CATALOGING MOON ROCKS', kind: 'sample', target: 'roam', move: true, min: 10, max: 17, speed: 1.15, weight: 1.25, moods: ['CURIOUS', 'DELIGHTED'] },
  { id: 'map-crater', label: 'MAPPING A CRATER EDGE', kind: 'scan', target: 'lookout', move: true, min: 11, max: 18, speed: 1.35, weight: 1.15, moods: ['CURIOUS', 'FOCUSED'] },
  { id: 'moon-hops', label: 'PRACTICING LOW-G HOPS', kind: 'hop', target: 'roam', move: true, min: 9, max: 16, speed: 1.65, weight: 1, moods: ['PLAYFUL', 'EXCITED'] },
  { id: 'stargaze', label: 'STARGAZING FOR A MINUTE', kind: 'stargaze', target: 'lookout', move: true, min: 8, max: 14, speed: 1.1, weight: 0.9, moods: ['DREAMY', 'PEACEFUL'] },
  { id: 'radio-mars', label: 'RADIOING MARS', kind: 'radio', target: 'lookout', move: true, min: 7, max: 12, speed: 1.2, weight: 0.9, moods: ['CHATTY', 'HOPEFUL'] },
  { id: 'watch-shuttle', label: 'WATCHING FOR YOUR SHUTTLE', kind: 'wave', target: 'pad', move: true, min: 8, max: 15, speed: 1.3, weight: 1.05, moods: ['HOPEFUL', 'FRIENDLY'] },
  { id: 'repair-beacon', label: 'REPAIRING THE LANDING BEACON', kind: 'repair', target: 'beacon', move: true, min: 9, max: 16, speed: 1.2, weight: 1.05, moods: ['HELPFUL', 'DETERMINED'] },
  { id: 'follow', label: 'FOLLOWING YOUR FOOTPRINTS', kind: 'wave', target: 'player', move: true, min: 8, max: 14, speed: 1.55, weight: 0.95, moods: ['FRIENDLY', 'CURIOUS'] },
  { id: 'dance', label: 'DOING A TINY VICTORY DANCE', kind: 'dance', target: 'hold', move: false, min: 6, max: 10, speed: 0, weight: 0.7, moods: ['SILLY', 'PROUD'] },
  { id: 'meditate', label: 'MEDITATING IN 0.16 G', kind: 'meditate', target: 'hold', move: false, min: 7, max: 13, speed: 0, weight: 0.7, moods: ['PEACEFUL', 'FLOATY'] },
  { id: 'inspect-bus', label: 'INSPECTING THE SPACE BUS PAD', kind: 'scan', target: 'pad', move: true, min: 9, max: 15, speed: 1.25, weight: 1, moods: ['THOROUGH', 'CURIOUS'] },
  { id: 'shooting-stars', label: 'COUNTING SHOOTING STARS', kind: 'stargaze', target: 'lookout', move: true, min: 8, max: 14, speed: 1.1, weight: 0.85, moods: ['DREAMY', 'AMAZED'] },
  { id: 'footprint-trail', label: 'LEAVING A FRIENDLY FOOTPRINT TRAIL', kind: 'walk', target: 'roam', move: true, min: 11, max: 18, speed: 1.4, weight: 1.1, moods: ['PLAYFUL', 'BUSY'] },
  { id: 'nap', label: 'TAKING A TINY HABITAT NAP', kind: 'nap', target: 'command', move: true, min: 7, max: 12, speed: 1.05, weight: 0.6, moods: ['SLEEPY', 'COZY'] },
  { id: 'safety', label: 'RUNNING A MOON SAFETY CHECK', kind: 'scan', target: 'roam', move: true, min: 10, max: 17, speed: 1.4, weight: 1.15, moods: ['CAREFUL', 'PROUD'] },
  { id: 'screens', label: 'READING COMMAND CENTER SCREENS', kind: 'console', target: 'command', move: true, min: 8, max: 14, speed: 1.15, weight: 1, moods: ['NERDY', 'FOCUSED'] },
  { id: 'hello', label: 'WAVING HELLO TO YOU', kind: 'wave', target: 'player', move: true, min: 7, max: 11, speed: 1.5, weight: 0.8, moods: ['FRIENDLY', 'EXCITED'] },
];

const MOON_FRIEND_HOME_NORMAL = slerpNormals(MOON_PAD_NORMAL, MOON_COMMAND_NORMAL, 0.46);
const moonFriendNormal = MOON_FRIEND_HOME_NORMAL.clone();
const moonFriendHeading = tangentHeadingForNormal(moonFriendNormal);
const moonFriendTargetNormal = moonFriendNormal.clone();
const moonFriendMoveAxis = new THREE.Vector3();
const moonFriendDesiredHeading = new THREE.Vector3();
const moonFriendStatusEl = document.getElementById('moon-friend-status');
const moonFriendActivityEl = document.getElementById('moon-friend-activity');
const moonFriendMoodEl = document.getElementById('moon-friend-mood');
const moonFriendDecisionsEl = document.getElementById('moon-friend-decisions');

function buildMoonFriend() {
  const root = new THREE.Group();
  root.name = 'Lumi · autonomous moon friend';
  scene.add(root);

  const actor = buildAlien();
  actor.alien.name = 'Lumi';
  actor.alien.scale.setScalar(0.74);
  actor.alien.position.y = 0.04;
  actor.alien.traverse((child) => {
    if (!child.isMesh || !child.material?.color) return;
    const color = child.material.color.getHex();
    if (color === 0x8fb95a) child.material.color.setHex(0x70d3ad);
    else if (color === 0x668b42) child.material.color.setHex(0x48947c);
    else if (color === 0x4c6c32) child.material.color.setHex(0x356c61);
    else if (color === 0x405b30) child.material.color.setHex(0x294f4c);
  });

  const headRig = new THREE.Group();
  headRig.name = 'Lumi head rig';
  headRig.position.y = 3.6;
  const headParts = actor.alien.children.filter((child) => child.position.y >= 3.35);
  headParts.forEach((part) => {
    actor.alien.remove(part);
    part.position.y -= headRig.position.y;
    headRig.add(part);
  });
  actor.alien.add(headRig);
  root.add(actor.alien);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 32, 22),
    new THREE.MeshPhysicalMaterial({
      color: 0xa7efff,
      transparent: true,
      opacity: 0.16,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  helmet.position.y = 0.28;
  helmet.scale.set(1, 1.1, 0.96);
  helmet.renderOrder = 3;
  headRig.add(helmet);

  const suitOrange = new THREE.MeshStandardMaterial({
    color: 0xff8b4f,
    emissive: 0x7a260e,
    emissiveIntensity: 0.55,
    metalness: 0.24,
    roughness: 0.38,
  });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.075, 9, 28), suitOrange);
  collar.position.y = 2.93;
  collar.rotation.x = Math.PI / 2;
  actor.alien.add(collar);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.65, 8), stdMat(0x7e98a8, { metalness: 0.7, roughness: 0.3 }));
  antenna.position.set(0.72, 1.37, 0.04);
  antenna.rotation.z = -0.24;
  headRig.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), suitOrange);
  antennaTip.position.set(0.8, 1.68, 0.04);
  headRig.add(antennaTip);

  const scanner = new THREE.Group();
  const scannerBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.16), stdMat(0x172a36, { metalness: 0.68, roughness: 0.32 }));
  scanner.add(scannerBody);
  const scannerScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x7effdf, toneMapped: false })
  );
  scannerScreen.position.z = -0.085;
  scanner.add(scannerScreen);
  scanner.position.set(0.13, -0.56, -0.13);
  actor.arms[1].fore.add(scanner);

  const label = makeLabelSprite('LUMI · MOON FRIEND', '#75f4d2');
  label.position.set(0, 4.65, 0);
  label.scale.set(4.25, 0.82, 1);
  root.add(label);

  return { root, actor, headRig, label, antennaTip, scannerScreen };
}

const moonFriendRuntime = buildMoonFriend();
let moonFriendActivity = MOON_FRIEND_ACTIVITIES[0];
let moonFriendActivityRemaining = 0;
let moonFriendActivityElapsed = 0;
let moonFriendDecisionCount = 0;
let moonFriendMood = 'CURIOUS';
let moonFriendHopHeight = 0;
let moonFriendHopVelocity = 0;
let moonFriendHopCooldown = 0.6;
let moonFriendGrounded = true;
let moonFriendDiscovered = false;
let moonFriendWelcomeTimer = 0;
const moonFriendHistory = [];

function moonFriendDestination(targetType) {
  if (targetType === 'hold') return moonFriendNormal.clone();
  if (targetType === 'player' && currentWorld === 'moon' && travelMode === 'walking') return footNormal.clone();
  if (targetType === 'pad') return stepWorldNormal(MOON_PAD_NORMAL, MOON_BUS_HEADING, 5.4, MOON_RADIUS);
  if (targetType === 'command') return stepWorldNormal(MOON_COMMAND_NORMAL, MOON_COMMAND_HEADING, 3.3, MOON_RADIUS);
  if (targetType === 'beacon') {
    const side = MOON_COMMAND_RIGHT.clone().addScaledVector(MOON_COMMAND_NORMAL, -MOON_COMMAND_RIGHT.dot(MOON_COMMAND_NORMAL)).normalize();
    return stepWorldNormal(MOON_COMMAND_NORMAL, side, 3.1, MOON_RADIUS);
  }
  const direction = tangentHeadingForNormal(MOON_FRIEND_HOME_NORMAL)
    .applyAxisAngle(MOON_FRIEND_HOME_NORMAL, Math.random() * Math.PI * 2)
    .normalize();
  const distance = targetType === 'lookout' ? 8.5 + Math.random() * 4.5 : 3.5 + Math.random() * 8.5;
  return stepWorldNormal(MOON_FRIEND_HOME_NORMAL, direction, distance, MOON_RADIUS);
}

function chooseMoonFriendActivity(forcedId = null) {
  let selected = forcedId ? MOON_FRIEND_ACTIVITIES.find((activity) => activity.id === forcedId) : null;
  if (!selected) {
    const recentIds = new Set(moonFriendHistory.slice(-3));
    let choices = MOON_FRIEND_ACTIVITIES.filter((activity) => !recentIds.has(activity.id));
    if (currentWorld !== 'moon' || travelMode !== 'walking') choices = choices.filter((activity) => activity.target !== 'player');
    let roll = Math.random() * choices.reduce((sum, activity) => sum + activity.weight, 0);
    selected = choices[choices.length - 1];
    for (const activity of choices) {
      roll -= activity.weight;
      if (roll <= 0) {
        selected = activity;
        break;
      }
    }
  }

  moonFriendActivity = selected;
  moonFriendActivityRemaining = THREE.MathUtils.lerp(selected.min, selected.max, Math.random());
  moonFriendActivityElapsed = 0;
  moonFriendTargetNormal.copy(moonFriendDestination(selected.target));
  moonFriendMood = selected.moods[Math.floor(Math.random() * selected.moods.length)];
  moonFriendDecisionCount += 1;
  moonFriendHistory.push(selected.id);
  if (moonFriendHistory.length > 6) moonFriendHistory.shift();
  moonFriendActivityEl.textContent = selected.label;
  moonFriendMoodEl.textContent = moonFriendMood;
  moonFriendDecisionsEl.textContent = String(moonFriendDecisionCount).padStart(3, '0');
}

function isNearMoonFriend(normal, radius = 3.8) {
  return arcDistanceForWorld('moon', normal, moonFriendNormal) < radius;
}

function greetMoonFriend() {
  chooseMoonFriendActivity('hello');
  const replies = [
    'LUMI SAVED YOU THE SHINIEST MOON ROCK',
    'LUMI SAYS YOUR FOOTPRINTS LOOK EXCELLENT',
    'LUMI IS VERY GLAD YOU CAUGHT THE SPACE BUS',
    'LUMI HAS BEEN KEEPING THE MOON COZY FOR YOU',
  ];
  showBanner(replies[Math.floor(Math.random() * replies.length)]);
}

function updateMoonFriend(dt, time, activePlayerNormal) {
  moonFriendActivityRemaining -= dt;
  moonFriendActivityElapsed += dt;
  if (moonFriendActivityRemaining <= 0) chooseMoonFriendActivity();

  if (moonFriendActivity.target === 'player' && activePlayerNormal) moonFriendTargetNormal.copy(activePlayerNormal);
  const distanceToTarget = arcDistanceForWorld('moon', moonFriendNormal, moonFriendTargetNormal);
  const stopDistance = moonFriendActivity.target === 'player' ? 2.7 : 0.55;
  const tooCloseToPlayer = activePlayerNormal && arcDistanceForWorld('moon', moonFriendNormal, activePlayerNormal) < 1.9;
  const moving = moonFriendActivity.move && distanceToTarget > stopDistance && !tooCloseToPlayer;

  if (moving) {
    moonFriendDesiredHeading.copy(moonFriendTargetNormal)
      .addScaledVector(moonFriendNormal, -moonFriendTargetNormal.dot(moonFriendNormal));
    if (moonFriendDesiredHeading.lengthSq() > 0.00001) {
      moonFriendDesiredHeading.normalize();
      moonFriendHeading.lerp(moonFriendDesiredHeading, 1 - Math.exp(-dt * 4.2));
      moonFriendHeading.addScaledVector(moonFriendNormal, -moonFriendHeading.dot(moonFriendNormal)).normalize();
      const step = Math.min(distanceToTarget - stopDistance, moonFriendActivity.speed * dt);
      moonFriendMoveAxis.crossVectors(moonFriendNormal, moonFriendHeading).normalize();
      moonFriendNormal.applyAxisAngle(moonFriendMoveAxis, step / MOON_RADIUS).normalize();
      moonFriendHeading.applyAxisAngle(moonFriendMoveAxis, step / MOON_RADIUS)
        .addScaledVector(moonFriendNormal, -moonFriendHeading.dot(moonFriendNormal)).normalize();
    }
  } else if (activePlayerNormal && moonFriendActivity.target === 'player') {
    moonFriendDesiredHeading.copy(activePlayerNormal)
      .addScaledVector(moonFriendNormal, -activePlayerNormal.dot(moonFriendNormal));
    if (moonFriendDesiredHeading.lengthSq() > 0.00001) {
      moonFriendHeading.lerp(moonFriendDesiredHeading.normalize(), 1 - Math.exp(-dt * 5.5));
      moonFriendHeading.addScaledVector(moonFriendNormal, -moonFriendHeading.dot(moonFriendNormal)).normalize();
    }
  }

  if (moonFriendActivity.kind === 'hop') {
    moonFriendHopCooldown -= dt;
    if (moonFriendGrounded && moonFriendHopCooldown <= 0) {
      moonFriendHopVelocity = 4.4 + Math.random() * 1.2;
      moonFriendGrounded = false;
      moonFriendHopCooldown = 2.4 + Math.random() * 1.8;
    }
  }
  if (!moonFriendGrounded) {
    moonFriendHopVelocity -= 1.62 * dt;
    moonFriendHopHeight += moonFriendHopVelocity * dt;
    if (moonFriendHopHeight <= 0) {
      moonFriendHopHeight = 0;
      moonFriendHopVelocity = 0;
      moonFriendGrounded = true;
    }
  }
  if (!worldDetailResidency.moon) {
    moonFriendRuntime.actor.thrusterFlames.visible = false;
    moonFriendStatusEl.classList.remove('show');
    return;
  }
  const friendThrustersActive = moonFriendActivity.kind === 'hop' && !moonFriendGrounded && moonFriendHopVelocity > 2.2;
  moonFriendRuntime.actor.thrusterFlames.visible = friendThrustersActive;
  if (friendThrustersActive) moonFriendRuntime.actor.thrusterFlames.scale.y = 0.5 + Math.sin(time * 38) * 0.16;

  moonFriendRuntime.root.position.copy(surfacePositionForWorld('moon', moonFriendNormal, moonFriendHopHeight + 0.04));
  orientSurfaceRoot(moonFriendRuntime.root, moonFriendNormal, moonFriendHeading);

  const actor = moonFriendRuntime.actor;
  const walkAmount = moving ? 1 : 0;
  const stride = Math.sin(time * 7.2) * walkAmount;
  let crouch = 0;
  let headPitch = 0;
  let headYaw = Math.sin(time * 0.7) * 0.08;
  let bodyRoll = Math.sin(time * 1.15) * 0.018;
  const armTargetX = [stride * -0.48, stride * 0.48];
  const armTargetZ = [0.1, -0.1];
  const foreTargetX = [0.12, 0.12];
  const thighTargetX = [stride * 0.72, stride * -0.72];
  const shinTargetX = [Math.max(0, -stride) * 0.62, Math.max(0, stride) * 0.62];

  if (!moving) {
    if (moonFriendActivity.kind === 'wave') {
      armTargetZ[1] = -1.52;
      armTargetX[1] = Math.sin(time * 6.8) * 0.32;
      foreTargetX[1] = 0.75;
      headYaw = Math.sin(time * 1.9) * 0.16;
    } else if (moonFriendActivity.kind === 'scan') {
      armTargetX[1] = 1.22;
      foreTargetX[1] = 0.64;
      headYaw = Math.sin(time * 0.8) * 0.48;
    } else if (moonFriendActivity.kind === 'repair') {
      armTargetX[0] = 1.18 + Math.sin(time * 5.2) * 0.18;
      armTargetX[1] = 1.34 - Math.sin(time * 5.2) * 0.18;
      foreTargetX[0] = 0.72;
      foreTargetX[1] = 0.56;
    } else if (moonFriendActivity.kind === 'console') {
      armTargetX[0] = 1.35 + Math.sin(time * 4.4) * 0.12;
      armTargetX[1] = 1.35 + Math.cos(time * 4.1) * 0.12;
      foreTargetX[0] = 0.52;
      foreTargetX[1] = 0.52;
      headPitch = 0.16;
    } else if (moonFriendActivity.kind === 'sample') {
      crouch = 0.32;
      armTargetX[1] = 1.72;
      foreTargetX[1] = 0.2;
      thighTargetX[0] = -0.52;
      thighTargetX[1] = -0.52;
      shinTargetX[0] = 1.08;
      shinTargetX[1] = 1.08;
      headPitch = 0.34;
    } else if (moonFriendActivity.kind === 'stargaze') {
      headPitch = -0.42;
      armTargetX[0] = -0.18;
      armTargetX[1] = -0.18;
    } else if (moonFriendActivity.kind === 'radio') {
      armTargetZ[0] = 1.32;
      foreTargetX[0] = 1.22;
      headYaw = -0.18;
    } else if (moonFriendActivity.kind === 'dance') {
      bodyRoll = Math.sin(time * 5.8) * 0.22;
      armTargetZ[0] = 1.1 + Math.sin(time * 4.6) * 0.45;
      armTargetZ[1] = -1.1 - Math.sin(time * 4.6) * 0.45;
      thighTargetX[0] = Math.sin(time * 7) * 0.48;
      thighTargetX[1] = -Math.sin(time * 7) * 0.48;
    } else if (moonFriendActivity.kind === 'meditate') {
      crouch = 0.38;
      thighTargetX[0] = -1.05;
      thighTargetX[1] = -1.05;
      shinTargetX[0] = 1.72;
      shinTargetX[1] = 1.72;
      armTargetX[0] = 0.42;
      armTargetX[1] = 0.42;
      foreTargetX[0] = 1.1;
      foreTargetX[1] = 1.1;
    } else if (moonFriendActivity.kind === 'nap') {
      crouch = 0.45;
      thighTargetX[0] = -0.92;
      thighTargetX[1] = -0.92;
      shinTargetX[0] = 1.55;
      shinTargetX[1] = 1.55;
      headPitch = 0.52;
      headYaw = Math.sin(time * 0.45) * 0.04;
    }
  }

  actor.legs.forEach((leg, index) => {
    leg.thigh.rotation.x = THREE.MathUtils.damp(leg.thigh.rotation.x, thighTargetX[index], 10, dt);
    leg.shin.rotation.x = THREE.MathUtils.damp(leg.shin.rotation.x, shinTargetX[index], 10, dt);
  });
  actor.arms.forEach((arm, index) => {
    arm.upper.rotation.x = THREE.MathUtils.damp(arm.upper.rotation.x, armTargetX[index], 9, dt);
    arm.upper.rotation.z = THREE.MathUtils.damp(arm.upper.rotation.z, armTargetZ[index], 9, dt);
    arm.fore.rotation.x = THREE.MathUtils.damp(arm.fore.rotation.x, foreTargetX[index], 9, dt);
  });
  actor.alien.position.y = THREE.MathUtils.damp(actor.alien.position.y, 0.04 - crouch, 9, dt);
  actor.alien.rotation.z = THREE.MathUtils.damp(actor.alien.rotation.z, bodyRoll, 9, dt);
  moonFriendRuntime.headRig.rotation.x = THREE.MathUtils.damp(moonFriendRuntime.headRig.rotation.x, headPitch, 7, dt);
  moonFriendRuntime.headRig.rotation.y = THREE.MathUtils.damp(moonFriendRuntime.headRig.rotation.y, headYaw, 7, dt);
  actor.body.scale.y = 1 + Math.sin(time * 1.65) * 0.018;
  moonFriendRuntime.label.position.y = 4.65 + Math.sin(time * 1.8) * 0.08;
  moonFriendRuntime.antennaTip.material.emissiveIntensity = 0.65 + Math.sin(time * 5.2) * 0.45;
  moonFriendRuntime.scannerScreen.material.color.setHSL(0.45 + Math.sin(time * 0.7) * 0.04, 0.82, 0.66);

  const playerIsOnMoon = Boolean(activePlayerNormal);
  moonFriendStatusEl.classList.toggle('show', playerIsOnMoon);
  if (playerIsOnMoon && !moonFriendDiscovered) {
    moonFriendWelcomeTimer += dt;
    if (moonFriendWelcomeTimer > 2.1 && arcDistanceForWorld('moon', activePlayerNormal, moonFriendNormal) < 10) {
      moonFriendDiscovered = true;
      showBanner('LUMI THE AUTONOMOUS MOON FRIEND FOUND YOU');
    }
  }
}

chooseMoonFriendActivity('watch-shuttle');

function poseAlienForRover() {
  alienDriver.thrusterFlames.visible = false;
  alienDriver.alien.scale.setScalar(0.9);
  alienDriver.alien.position.set(0, 0.42, 0.28);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.3;
    leg.shin.rotation.x = 1.45;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 1.12;
    arm.upper.rotation.z = index === 0 ? -0.18 : 0.18;
    arm.fore.rotation.x = 0.34;
  });
}

function attachAlienOnFoot(world, normal, heading) {
  currentWorld = world;
  alienSwimming = false;
  footNormal.copy(normal);
  footHeading.copy(heading).addScaledVector(footNormal, -heading.dot(footNormal)).normalize();
  footRoot.add(alienDriver.alien);
  footRoot.visible = true;
  alienDriver.alien.scale.setScalar(0.9);
  alienDriver.alien.position.set(0, 0.04, 0);
  alienDriver.alien.rotation.set(0, 0, 0);
  footJumpHeight = 0;
  footVerticalVelocity = 0;
  footGrounded = true;
  footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
  footRoot.position.copy(surfacePositionForWorld(currentWorld, footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
}

// Every surface expedition begins at the shared trailhead. The garage remains
// a short walk away, and every dirt route radiates from this exact point.
attachAlienOnFoot('mars', START_NORMAL, playerHeading);

function isNearOasisBoat(normal, radius = OASIS_BOAT_BOARD_RADIUS) {
  if (currentWorld !== 'mars' || travelMode !== 'walking') return false;
  return arcDistanceForWorld('mars', normal, oasisLake.boat.normal) < radius;
}

function poseAlienForOasisBoat() {
  alienDriver.thrusterFlames.visible = false;
  oasisLake.boat.seat.add(alienDriver.alien);
  footRoot.visible = false;
  alienDriver.alien.scale.setScalar(0.66);
  alienDriver.alien.position.set(0, -0.68, 0.02);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.24;
    leg.shin.rotation.x = 1.48;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 1.14;
    arm.upper.rotation.z = index === 0 ? -0.14 : 0.14;
    arm.fore.rotation.x = 0.5;
  });
}

function boardOasisBoat() {
  if (!isNearOasisBoat(footNormal)) return;
  alienSwimming = false;
  footSpeed = 0;
  footJumpHeight = 0;
  footVerticalVelocity = 0;
  footGrounded = true;
  oasisBoatSpeed = 0;
  lookingAtCamera = false;
  poseAlienForOasisBoat();
  oasisLake.boat.label.visible = false;
  travelMode = 'boating';
  currentWorld = 'mars';
  showBanner('OASIS SKIFF ONLINE · KEEP INSIDE THE GLOWING SHORE');
}

function exitOasisBoat() {
  if (Math.abs(oasisBoatSpeed) > 0.8) {
    showBanner('SLOW THE OASIS SKIFF TO DISEMBARK');
    return;
  }
  const boat = oasisLake.boat;
  oasisBoatExitDirection.copy(boat.heading).cross(boat.normal).normalize();
  const exitNormal = stepWorldNormal(boat.normal, oasisBoatExitDirection, 2.65, PLANET_RADIUS);
  attachAlienOnFoot('mars', exitNormal, boat.heading);
  travelMode = 'walking';
  oasisBoatSpeed = 0;
  boat.label.visible = true;
  lookingAtCamera = false;
  showBanner(oasisWaterRatio(exitNormal) < OASIS_SWIM_EXIT_RATIO
    ? 'SKIFF PARKED · ALIEN SPLASHED INTO THE OASIS'
    : 'SKIFF PARKED · ALIEN ASHORE');
}

function updateOasisBoat(dt, time, throttleInput, steeringInput) {
  const boat = oasisLake.boat;
  const targetSpeed = throttleInput > 0 ? 8.5 : throttleInput < 0 ? -2.8 : 0;
  const acceleration = throttleInput === 0 ? 1.9 : oasisBoatSpeed * throttleInput < 0 ? 5.8 : 3.25;
  oasisBoatSpeed = THREE.MathUtils.damp(oasisBoatSpeed, targetSpeed, acceleration, dt);
  if (Math.abs(oasisBoatSpeed) < 0.012) oasisBoatSpeed = 0;

  const steerAuthority = 0.24 + THREE.MathUtils.clamp(Math.abs(oasisBoatSpeed) / 5.2, 0, 0.76);
  const reverseSteer = oasisBoatSpeed < -0.08 ? -1 : 1;
  boat.heading.applyAxisAngle(
    boat.normal,
    steeringInput * reverseSteer * 1.28 * steerAuthority * dt
  ).normalize();

  if (Math.abs(oasisBoatSpeed) > 0.001) {
    oasisBoatMoveAxis.crossVectors(boat.normal, boat.heading).normalize();
    oasisBoatCandidateNormal.copy(boat.normal)
      .applyAxisAngle(oasisBoatMoveAxis, (oasisBoatSpeed * dt) / PLANET_RADIUS)
      .normalize();
    oasisBoatCandidateHeading.copy(boat.heading)
      .applyAxisAngle(oasisBoatMoveAxis, (oasisBoatSpeed * dt) / PLANET_RADIUS)
      .addScaledVector(oasisBoatCandidateNormal, -oasisBoatCandidateHeading.dot(oasisBoatCandidateNormal))
      .normalize();
    if (oasisWaterRatio(oasisBoatCandidateNormal) <= OASIS_BOAT_LIMIT_RATIO) {
      boat.normal.copy(oasisBoatCandidateNormal);
      boat.heading.copy(oasisBoatCandidateHeading);
    } else {
      oasisBoatSpeed = THREE.MathUtils.damp(oasisBoatSpeed, 0, 13, dt);
    }
  }

  const speedRatio = THREE.MathUtils.clamp(Math.abs(oasisBoatSpeed) / 8.5, 0, 1);
  const bob = Math.sin(time * 1.75) * 0.055 + Math.sin(time * 3.8) * 0.018 * (1 + speedRatio);
  boat.root.position.copy(surfaceWorldPosition(boat.normal, 0.48 + bob));
  boat.root.quaternion.copy(surfaceVehicleQuaternion(boat.normal, boat.heading));
  boat.visual.rotation.x = THREE.MathUtils.damp(
    boat.visual.rotation.x,
    -throttleInput * 0.035 + Math.sin(time * 2.4) * 0.012,
    4.5,
    dt
  );
  boat.visual.rotation.z = THREE.MathUtils.damp(
    boat.visual.rotation.z,
    -steeringInput * oasisBoatSpeed * 0.018 + Math.sin(time * 1.6) * 0.014,
    4.2,
    dt
  );
  boat.propeller.rotation.z += dt * (2.2 + Math.abs(oasisBoatSpeed) * 4.8);
  boat.navLight.intensity = 1.65 + Math.sin(time * 5.4) * 0.32;
  boat.wakes.forEach((wake, index) => {
    wake.material.opacity = THREE.MathUtils.damp(wake.material.opacity, speedRatio * 0.42, 5.5, dt);
    wake.scale.y = 0.5 + speedRatio * (1.05 + index * 0.08);
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = THREE.MathUtils.damp(arm.upper.rotation.x, 1.14 + steeringInput * (index === 0 ? -0.18 : 0.18), 8, dt);
    arm.fore.rotation.x = THREE.MathUtils.damp(arm.fore.rotation.x, 0.5 + Math.sin(time * 3.2 + index) * speedRatio * 0.04, 8, dt);
  });
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.7) * 0.016;
  updateRoverAudio(oasisBoatSpeed * 0.62, throttleInput * 0.55);
}

function exitActiveVehicle() {
  if (!activeVehicle || !activeProfile) return;
  if (caveTravelZone !== 'surface') {
    showBanner('CAVE ROAD SAFETY · EXIT VEHICLE ON THE SURFACE');
    return;
  }
  if (Math.abs(driveSpeed) > activeProfile.exitSpeed || !grounded) {
    showBanner(`STOP ${activeVehicle.label} TO EXIT`);
    return;
  }
  const parkedVehicle = activeVehicle;
  if (parkedVehicle.thrusterVisual) parkedVehicle.thrusterVisual.visible = false;
  scene.add(parkedVehicle.root);
  parkedVehicle.root.matrixAutoUpdate = true;
  parkedVehicle.root.position.copy(surfaceWorldPosition(playerNormal, 0.08));
  parkedVehicle.root.quaternion.copy(surfaceVehicleQuaternion(playerNormal, playerHeading));
  if (parkedVehicle.chassis !== parkedVehicle.root) {
    parkedVehicle.chassis.rotation.x = 0;
    parkedVehicle.chassis.rotation.z = 0;
    parkedVehicle.chassis.position.y = parkedVehicle.chassisBaseY || 0;
  }
  parkedVehicle.parkedNormal.copy(playerNormal);
  parkedVehicle.parkedHeading.copy(playerHeading);
  parkedVehicle.parked = true;
  parkedVehicle.root.updateMatrix();
  parkedVehicle.root.matrixAutoUpdate = false;
  const exitingGarageBay = arcDistanceForWorld('mars', playerNormal, GARAGE_NORMAL) < 15;
  const exitDirection = exitingGarageBay
    ? playerHeading.clone()
    : playerHeading.clone().cross(playerNormal).normalize();
  const exitNormal = stepWorldNormal(
    playerNormal,
    exitDirection,
    exitingGarageBay ? 7 : activeProfile.collisionRadius + 2.15,
    PLANET_RADIUS
  );
  const exitHeading = exitingGarageBay ? playerHeading.clone().multiplyScalar(-1) : playerHeading;
  attachAlienOnFoot('mars', exitNormal, exitHeading);
  travelMode = 'walking';
  driveSpeed = 0;
  vehicleLateralSpeed = 0;
  garageDepartureCamera = false;
  lookingAtCamera = false;
  activeVehicle = null;
  activeProfile = null;
  drivingCourses.reset();
  drivingCoursePrompt = '';
  activeDrivingCourse = null;
  showBanner(`${parkedVehicle.label} PARKED · ALIEN ON FOOT`);
}

function poseAlienForVehicle(runtime) {
  alienDriver.thrusterFlames.visible = false;
  runtime.seat.add(alienDriver.alien);
  alienDriver.alien.scale.setScalar(runtime.profile.driverScale);
  alienDriver.alien.position.set(...runtime.profile.driverPosition);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.3;
    leg.shin.rotation.x = 1.45;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 1.12;
    arm.upper.rotation.z = index === 0 ? -0.18 : 0.18;
    arm.fore.rotation.x = 0.34;
  });
}

function findNearestBoardableVehicle(normal, maximumDistance = Infinity) {
  let nearest = null;
  let nearestDistance = maximumDistance;
  vehicleRuntimes.forEach((runtime) => {
    if (!runtime.parked) return;
    const distance = arcDistanceForWorld('mars', normal, runtime.parkedNormal);
    const boardDistance = Math.min(nearestDistance, runtime.profile.boardRadius);
    if (distance <= boardDistance) {
      nearest = runtime;
      nearestDistance = distance;
    }
  });
  return nearest ? { runtime: nearest, distance: nearestDistance } : null;
}

function boardVehicle(runtime) {
  if (!runtime?.parked) return;
  playerNormal.copy(runtime.parkedNormal);
  playerHeading.copy(runtime.parkedHeading)
    .addScaledVector(playerNormal, -runtime.parkedHeading.dot(playerNormal))
    .normalize();
  runtime.root.matrixAutoUpdate = true;
  alien.add(runtime.root);
  runtime.root.position.set(0, 0, 0);
  runtime.root.quaternion.identity();
  runtime.root.scale.setScalar(1);
  runtime.parked = false;
  runtime.chassisBaseY = runtime.chassis.position.y;
  activeVehicle = runtime;
  activeProfile = runtime.profile;
  activeVehicleTravelDistance = runtime.motionDistance || 0;
  vehicleLateralSpeed = 0;
  terrainSampleAccumulator = Infinity;
  vehicleVisualAccumulator = 0;
  driveSpeed = 0;
  verticalVelocity = 0;
  jumpHeight = 0;
  grounded = true;
  roverLiftSpool = 0;
  roverThrusterWasActive = false;
  roverThrusterFuel = activeProfile.lift.fuel;
  garageDepartureCamera = arcDistanceForWorld('mars', playerNormal, GARAGE_NORMAL) < 15;
  if (garageDepartureCamera) lookingAtCamera = true;
  alien.position.copy(surfaceWorldPosition(playerNormal));
  alien.quaternion.copy(surfaceVehicleQuaternion(playerNormal, playerHeading));
  poseAlienForVehicle(runtime);
  footRoot.visible = false;
  travelMode = 'driving';
  currentWorld = 'mars';
  showBanner(`${runtime.label} ONLINE · ${runtime.profile.locomotion.toUpperCase()} PHYSICS`);
}

function poseAlienForShuttle() {
  alienDriver.thrusterFlames.visible = false;
  shuttleRuntime.shuttleSeat.add(alienDriver.alien);
  footRoot.visible = false;
  alienDriver.alien.scale.setScalar(0.58);
  alienDriver.alien.position.set(0, -0.18, -0.1);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.14;
    leg.shin.rotation.x = 1.32;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 0.82;
    arm.upper.rotation.z = index === 0 ? -0.12 : 0.12;
    arm.fore.rotation.x = 0.48;
  });
}

function boardShuttle() {
  poseAlienForShuttle();
  travelMode = 'boarded';
  showBanner(`ABOARD SPACE BUS · DEPARTS IN ${Math.max(1, Math.ceil(shuttleDockTimer))} SEC`);
}

function hyperBikeDockNormal(world) {
  return world === 'zephyra' ? ZEPHYRA_PAD_NORMAL : MOON_BIKE_DOCK_NORMAL;
}

function isNearHyperBike(normal, radius = HYPERBIKE_BOARD_RADIUS) {
  if (hyperBikeTransit || hyperBikeLocation !== currentWorld) return false;
  if (currentWorld !== 'moon' && currentWorld !== 'zephyra') return false;
  return arcDistanceForWorld(currentWorld, normal, hyperBikeDockNormal(currentWorld)) < radius;
}

function poseAlienForHyperBike() {
  alienDriver.thrusterFlames.visible = false;
  hyperBikeRuntime.bikeSeat.add(alienDriver.alien);
  footRoot.visible = false;
  alienDriver.alien.scale.setScalar(0.62);
  alienDriver.alien.position.set(0, -0.2, -0.08);
  alienDriver.alien.rotation.set(0, 0, 0);
  legs.forEach((leg) => {
    leg.thigh.rotation.x = -1.08;
    leg.shin.rotation.x = 1.58;
  });
  arms.forEach((arm, index) => {
    arm.upper.rotation.x = 1.28;
    arm.upper.rotation.z = index === 0 ? -0.18 : 0.18;
    arm.fore.rotation.x = 0.34;
  });
}

function startHyperBikeTrip() {
  const destination = hyperBikeLocation === 'moon' ? 'zephyra' : 'moon';
  const start = (hyperBikeLocation === 'moon' ? MOON_BIKE_DOCK_POSITION : ZEPHYRA_BIKE_DOCK_POSITION).clone();
  const end = (destination === 'moon' ? MOON_BIKE_DOCK_POSITION : ZEPHYRA_BIKE_DOCK_POSITION).clone();
  const control = start.clone().add(end).multiplyScalar(0.5);
  control.y += 98 * PLANET_SCALE;
  control.z -= 38 * PLANET_SCALE;
  hyperBikeTransit = {
    from: hyperBikeLocation,
    to: destination,
    start,
    end,
    control,
    elapsed: 0,
    duration: HYPERBIKE_TRAVEL_DURATION,
  };
  hyperBikeRuntime.warpTail.visible = true;
  const departureDirection = control.clone().sub(start).normalize();
  camera.position.copy(start).addScaledVector(departureDirection, -18).addScaledVector(UP, 10);
  camera.up.copy(UP);
  camLookTarget.copy(start).addScaledVector(departureDirection, 3.5);
  showBanner(`VOLT BIKE HYPERSPEED · DESTINATION ${destination.toUpperCase()}`);
}

function boardHyperBike() {
  poseAlienForHyperBike();
  travelMode = 'hyperbike';
  startHyperBikeTrip();
}

function disembarkHyperBike() {
  const world = hyperBikeLocation;
  const padNormal = hyperBikeDockNormal(world);
  const radius = world === 'zephyra' ? ZEPHYRA_RADIUS : MOON_RADIUS;
  const heading = world === 'zephyra' ? ZEPHYRA_BIKE_HEADING : MOON_BIKE_HEADING;
  const exitDirection = heading.clone().cross(padNormal).normalize();
  const exitNormal = stepWorldNormal(padNormal, exitDirection, 4.3, radius);
  const exitHeading = heading.clone().applyAxisAngle(new THREE.Vector3().crossVectors(padNormal, exitDirection).normalize(), 4.3 / radius);
  attachAlienOnFoot(world, exitNormal, exitHeading);
  travelMode = 'walking';
  showBanner(world === 'zephyra' ? 'ZEPHYRA LANDFALL · ELECTRIC SKY ACTIVE' : 'VOLT BIKE RETURNED TO THE MOON');
}

function updateHyperBikeTravel(dt, time) {
  hyperBikeRuntime.electricMaterial.emissiveIntensity = 1.75 + Math.sin(time * 8.4) * 0.5;
  hyperBikeRuntime.electricCore.scale.setScalar(0.9 + Math.sin(time * 10.5) * 0.12);
  hyperBikeRuntime.wheelRings.forEach((wheel, index) => {
    wheel.rotation.x += dt * (hyperBikeTransit ? 22 + index * 2 : 2.2);
  });
  if (!hyperBikeTransit) {
    hyperBikeDisplaySpeed = 0;
    hyperBikeRuntime.warpTail.visible = false;
    hyperBikeRuntime.headlight.intensity = 2.2 + Math.sin(time * 4.8) * 0.45;
    return;
  }

  hyperBikeTransit.elapsed += dt;
  const rawProgress = THREE.MathUtils.clamp(hyperBikeTransit.elapsed / hyperBikeTransit.duration, 0, 1);
  const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
  const oneMinus = 1 - progress;
  hyperBike.position.set(0, 0, 0)
    .addScaledVector(hyperBikeTransit.start, oneMinus * oneMinus)
    .addScaledVector(hyperBikeTransit.control, 2 * oneMinus * progress)
    .addScaledVector(hyperBikeTransit.end, progress * progress);
  hyperBikeFlightDirection.copy(hyperBikeTransit.control).sub(hyperBikeTransit.start).multiplyScalar(2 * oneMinus)
    .addScaledVector(hyperBikeFlightDelta.copy(hyperBikeTransit.end).sub(hyperBikeTransit.control), 2 * progress)
    .normalize();
  const upReference = Math.abs(hyperBikeFlightDirection.dot(UP)) > 0.92 ? travelBasisRight.set(1, 0, 0) : UP;
  hyperBikeFlightRight.copy(hyperBikeFlightDirection).cross(upReference).normalize();
  hyperBikeFlightUp.copy(hyperBikeFlightRight).cross(hyperBikeFlightDirection).normalize();
  hyperBikeFlightBack.copy(hyperBikeFlightDirection).multiplyScalar(-1);
  hyperBikeFlightMatrix.makeBasis(hyperBikeFlightRight, hyperBikeFlightUp, hyperBikeFlightBack);
  hyperBike.quaternion.setFromRotationMatrix(hyperBikeFlightMatrix);
  hyperBikeRuntime.warpTail.scale.z = 0.72 + Math.sin(time * 34) * 0.16 + Math.sin(progress * Math.PI) * 1.35;
  hyperBikeRuntime.headlight.intensity = 5.2 + Math.sin(time * 28) * 1.4;
  hyperBikeDisplaySpeed = Math.round(18000 + Math.sin(progress * Math.PI) * 82000);

  if (rawProgress >= 1) {
    hyperBikeLocation = hyperBikeTransit.to;
    if (hyperBikeLocation === 'zephyra') zephyraGroveArrivalCharge = 1;
    const dockPosition = hyperBikeLocation === 'moon' ? MOON_BIKE_DOCK_POSITION : ZEPHYRA_BIKE_DOCK_POSITION;
    const dockQuaternion = hyperBikeLocation === 'moon' ? MOON_BIKE_DOCK_QUATERNION : ZEPHYRA_BIKE_DOCK_QUATERNION;
    hyperBike.position.copy(dockPosition);
    hyperBike.quaternion.copy(dockQuaternion);
    hyperBikeTransit = null;
    hyperBikeDisplaySpeed = 0;
    hyperBikeRuntime.warpTail.visible = false;
    showBanner(`${hyperBikeLocation.toUpperCase()} ARRIVAL · PRESS E TO DISEMBARK`);
  }
}

function startScheduledShuttleTrip() {
  const playerWasNearDepartingBus = isPlayerNearCurrentShuttlePad();
  const destination = shuttleLocation === 'mars' ? 'moon' : 'mars';
  const start = (shuttleLocation === 'mars' ? MARS_DOCK_POSITION : MOON_DOCK_POSITION).clone();
  const end = (destination === 'mars' ? MARS_DOCK_POSITION : MOON_DOCK_POSITION).clone();
  const control = start.clone().add(end).multiplyScalar(0.5);
  control.y += 116 * PLANET_SCALE;
  control.x -= 18 * PLANET_SCALE;
  shuttleTransit = {
    from: shuttleLocation,
    to: destination,
    start,
    end,
    control,
    elapsed: 0,
    duration: SHUTTLE_TRAVEL_DURATION,
  };
  if (travelMode === 'boarded') {
    const departureDirection = control.clone().sub(start).normalize();
    camera.position.copy(start).addScaledVector(departureDirection, -28).addScaledVector(UP, 32);
    camera.up.copy(UP);
    camLookTarget.copy(start).addScaledVector(departureDirection, 2.5);
    showBanner(`SPACE BUS DEPARTING · NEXT STOP ${destination.toUpperCase()}`);
  } else if (currentWorld === shuttleLocation && playerWasNearDepartingBus) {
    showBanner(`SPACE BUS DEPARTED · YOU MISSED IT`);
  }
}

function disembarkShuttle() {
  const world = shuttleLocation;
  const padNormal = world === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
  const radius = world === 'moon' ? MOON_RADIUS : PLANET_RADIUS;
  const heading = tangentHeadingForNormal(padNormal);
  const exitNormal = stepWorldNormal(padNormal, heading, 4.8, radius);
  const exitHeading = heading.clone().applyAxisAngle(new THREE.Vector3().crossVectors(padNormal, heading).normalize(), 4.8 / radius);
  attachAlienOnFoot(world, exitNormal, exitHeading.multiplyScalar(-1));
  travelMode = 'walking';
  showBanner(world === 'moon' ? 'ONE SMALL STEP · WELCOME TO THE MOON' : 'TOUCHDOWN · BACK ON MARS');
}

function handleInteraction() {
  if (!interactionQueued) return;
  interactionQueued = false;

  if (travelMode === 'driving') {
    exitActiveVehicle();
    return;
  }

  if (travelMode === 'boating') {
    exitOasisBoat();
    return;
  }

  if (travelMode === 'mine-train') {
    disembarkNightfallMineTrain();
    return;
  }

  if (travelMode === 'cave-walking') {
    if (isNearCavernMineTrain()) boardNightfallMineTrain(true);
    else showBanner('VASTWATER · RETURN TO THE GLOWING TRAIN PLATFORM TO LEAVE');
    return;
  }

  if (travelMode === 'boarded') {
    if (shuttleTransit) showBanner('SPACE BUS IN FLIGHT · NEXT STOP LOCKED');
    else disembarkShuttle();
    return;
  }

  if (travelMode === 'hyperbike') {
    if (hyperBikeTransit) showBanner(`HYPERSPEED LOCKED · ${hyperBikeTransit.to.toUpperCase()} INBOUND`);
    else disembarkHyperBike();
    return;
  }

  if (travelMode !== 'walking') return;
  if (ufoInteriorActive) {
    showBanner('PROJECT ARCHIVE · WALK BACK THROUGH THE OPEN HATCH TO EXIT');
    return;
  }
  if (isNearAlienMountainHome(footNormal)) {
    showBanner(isInsideAlienMountainHome(footNormal)
      ? 'WELCOME HOME · KITCHEN · BEDROOM · BATHROOM'
      : 'ALIEN MOUNTAIN HOME · WALK THROUGH THE OPEN DOOR');
    return;
  }
  if (currentWorld === 'mars' && isNearUfoEntry(footNormal)) {
    loadUfoProjectScreens();
    showBanner('OPEN HATCH AHEAD · WALK UP THE RAMP TO ENTER');
    return;
  }
  if (isNearOasisBoat(footNormal)) {
    boardOasisBoat();
    return;
  }
  if (isNearSurfaceMineTrain(footNormal)) {
    boardNightfallMineTrain(false);
    return;
  }
  if (isNearHyperBike(footNormal)) {
    boardHyperBike();
    return;
  }
  if (currentWorld === 'moon' && isNearMoonFriend(footNormal)) {
    greetMoonFriend();
    return;
  }
  if (currentWorld === 'moon' && isNearMoonCommand(footNormal)) {
    moonCommandSystemsActive = !moonCommandSystemsActive;
    showBanner(moonCommandSystemsActive
      ? 'LUNA COMMAND ONLINE · MARS UPLINK LOCKED'
      : 'LUNA COMMAND STANDBY · CONSOLES DIMMED');
    return;
  }
  if (currentWorld === 'zephyra') {
    showBanner('VOLT BIKE OUT OF RANGE');
    return;
  }
  const padNormal = currentWorld === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
  const nearPad = arcDistanceForWorld(currentWorld, footNormal, padNormal) < SHUTTLE_BOARD_RADIUS;
  const nearShuttle = !shuttleTransit && shuttleLocation === currentWorld && nearPad;
  if (nearShuttle) {
    boardShuttle();
    return;
  }

  if (nearPad) {
    const eta = Math.max(1, Math.ceil(shuttleEtaToWorld(currentWorld)));
    showBanner(`SPACE BUS AWAY · RETURNS IN ${eta} SEC`);
    return;
  }

  const nearbyVehicle = currentWorld === 'mars' ? findNearestBoardableVehicle(footNormal) : null;
  if (nearbyVehicle) {
    boardVehicle(nearbyVehicle.runtime);
    return;
  }

  showBanner('NO VEHICLE IN RANGE');
}

function shuttleEtaToWorld(world) {
  if (shuttleTransit) {
    const remaining = Math.max(0, shuttleTransit.duration - shuttleTransit.elapsed);
    return shuttleTransit.to === world
      ? remaining
      : remaining + SHUTTLE_DOCK_DURATION + SHUTTLE_TRAVEL_DURATION;
  }
  if (shuttleLocation === world) return 0;
  return shuttleDockTimer + SHUTTLE_TRAVEL_DURATION;
}

function isPlayerNearCurrentShuttlePad(radius = SHUTTLE_STATUS_RADIUS) {
  if (travelMode === 'driving' && shuttleLocation === 'mars') {
    return geodesicDistance(playerNormal, MARS_PORT.normal) < radius;
  }
  if (travelMode === 'walking') {
    const padNormal = currentWorld === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
    return arcDistanceForWorld(currentWorld, footNormal, padNormal) < radius;
  }
  return false;
}

function updateShuttleFlight(dt, time) {
  if (!shuttleTransit) {
    shuttleRuntime.exhaust.visible = false;
    shuttleDisplaySpeed = 0;
    shuttleDockTimer -= dt;
    if (shuttleDockTimer <= 0) startScheduledShuttleTrip();
    return;
  }

  shuttleTransit.elapsed += dt;
  const rawProgress = THREE.MathUtils.clamp(shuttleTransit.elapsed / shuttleTransit.duration, 0, 1);
  const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
  const oneMinus = 1 - progress;
  moonShuttle.position.set(0, 0, 0)
    .addScaledVector(shuttleTransit.start, oneMinus * oneMinus)
    .addScaledVector(shuttleTransit.control, 2 * oneMinus * progress)
    .addScaledVector(shuttleTransit.end, progress * progress);

  shuttleFlightDirection.copy(shuttleTransit.control).sub(shuttleTransit.start).multiplyScalar(2 * oneMinus)
    .addScaledVector(shuttleFlightDelta.copy(shuttleTransit.end).sub(shuttleTransit.control), 2 * progress)
    .normalize();
  const flightUpReference = Math.abs(shuttleFlightDirection.dot(UP)) > 0.92 ? travelBasisRight.set(1, 0, 0) : UP;
  shuttleFlightRight.copy(shuttleFlightDirection).cross(flightUpReference).normalize();
  shuttleFlightUp.copy(shuttleFlightRight).cross(shuttleFlightDirection).normalize();
  shuttleFlightBack.copy(shuttleFlightDirection).multiplyScalar(-1);
  shuttleFlightMatrix.makeBasis(shuttleFlightRight, shuttleFlightUp, shuttleFlightBack);
  shuttleFlightQuaternion.setFromRotationMatrix(shuttleFlightMatrix);
  if (rawProgress < 0.1) {
    const startDock = shuttleTransit.from === 'mars' ? MARS_DOCK_QUATERNION : MOON_DOCK_QUATERNION;
    moonShuttle.quaternion.copy(startDock).slerp(shuttleFlightQuaternion, THREE.MathUtils.smoothstep(rawProgress, 0.02, 0.1));
  } else if (rawProgress > 0.9) {
    const endDock = shuttleTransit.to === 'mars' ? MARS_DOCK_QUATERNION : MOON_DOCK_QUATERNION;
    moonShuttle.quaternion.copy(shuttleFlightQuaternion).slerp(endDock, THREE.MathUtils.smoothstep(rawProgress, 0.9, 0.99));
  } else {
    moonShuttle.quaternion.copy(shuttleFlightQuaternion);
  }

  shuttleRuntime.exhaust.visible = true;
  shuttleRuntime.exhaust.scale.z = 0.84 + Math.sin(time * 22) * 0.13;
  shuttleRuntime.navLight.intensity = 2.4 + Math.sin(time * 8) * 0.7;
  shuttleDisplaySpeed = Math.round(240 + Math.sin(progress * Math.PI) * 620);

  if (rawProgress >= 1) {
    shuttleLocation = shuttleTransit.to;
    const dockPosition = shuttleLocation === 'mars' ? MARS_DOCK_POSITION : MOON_DOCK_POSITION;
    const dockQuaternion = shuttleLocation === 'mars' ? MARS_DOCK_QUATERNION : MOON_DOCK_QUATERNION;
    moonShuttle.position.copy(dockPosition);
    moonShuttle.quaternion.copy(dockQuaternion);
    shuttleTransit = null;
    shuttleDockTimer = SHUTTLE_DOCK_DURATION;
    shuttleRuntime.exhaust.visible = false;
    shuttleDisplaySpeed = 0;
    if (travelMode === 'boarded') {
      showBanner(`${shuttleLocation.toUpperCase()} ARRIVAL · 10 SEC TO DISEMBARK`);
    } else if (currentWorld === shuttleLocation && isPlayerNearCurrentShuttlePad()) {
      showBanner(`SPACE BUS LANDED · DEPARTS IN 10 SEC`);
    }
  }
}

function updateOnFoot(dt, time, throttleInput, steeringInput) {
  if (performanceQuery?.has('ufo-cabin-static-qa')) {
    throttleInput = 0;
    steeringInput = 0;
    keys.w = false;
    keys.arrowup = false;
  }
  const oasisRatio = currentWorld === 'mars' && !ufoInteriorActive
    ? oasisWaterRatio(footNormal)
    : Infinity;
  const shouldSwim = alienSwimming
    ? oasisRatio < OASIS_SWIM_EXIT_RATIO
    : oasisRatio < OASIS_SWIM_ENTER_RATIO;
  if (shouldSwim !== alienSwimming) {
    alienSwimming = shouldSwim;
    footJumpHeight = 0;
    footVerticalVelocity = 0;
    footGrounded = true;
    footThrusterWasActive = false;
    alienDriver.thrusterFlames.visible = false;
    showBanner(alienSwimming
      ? 'OASIS SWIM MODE · WASD TO PADDLE · FIND THE SKIFF'
      : 'ALIEN CLIMBED OUT OF THE OASIS');
  }
  const radius = currentWorld === 'moon' ? MOON_RADIUS : currentWorld === 'zephyra' ? ZEPHYRA_RADIUS : PLANET_RADIUS;
  const walkTarget = throttleInput * (alienSwimming ? 6.2 : (WALK_SPEED_BY_WORLD[currentWorld] || WALK_SPEED_BY_WORLD.mars));
  footSpeed = THREE.MathUtils.damp(footSpeed, walkTarget, throttleInput === 0 ? 6.5 : 11.5, dt);
  footHeading.applyAxisAngle(footNormal, steeringInput * (alienSwimming ? 1.72 : 2.15) * dt).normalize();

  if (Math.abs(footSpeed) > 0.01) {
    const axis = new THREE.Vector3().crossVectors(footNormal, footHeading).normalize();
    const candidateNormal = footNormal.clone().applyAxisAngle(axis, (footSpeed * dt) / radius).normalize();
    const candidateHeading = footHeading.clone().applyAxisAngle(axis, (footSpeed * dt) / radius);
    footNormal.copy(candidateNormal);
    footHeading.copy(candidateHeading).addScaledVector(footNormal, -candidateHeading.dot(footNormal)).normalize();
  }

  let zephyraFluxStrength = 0;
  if (currentWorld === 'zephyra') {
    const fluxDistance = arcDistanceForWorld('zephyra', footNormal, ZEPHYRA_FLUX_NORMAL);
    zephyraFluxStrength = 1 - THREE.MathUtils.smoothstep(fluxDistance, 3.4, 14.2);
    if (zephyraFluxStrength > 0.015 && fluxDistance > 1.15) {
      zephyraFluxToward.copy(ZEPHYRA_FLUX_NORMAL)
        .addScaledVector(footNormal, -ZEPHYRA_FLUX_NORMAL.dot(footNormal))
        .normalize();
      zephyraFluxAxis.crossVectors(footNormal, zephyraFluxToward).normalize();
      const pullSpeed = zephyraFluxStrength * (0.22 + (Math.sin(time * 2.6) * 0.5 + 0.5) * 0.34);
      const pullAngle = pullSpeed * dt / ZEPHYRA_RADIUS;
      footNormal.applyAxisAngle(zephyraFluxAxis, pullAngle).normalize();
      footHeading.applyAxisAngle(zephyraFluxAxis, pullAngle)
        .addScaledVector(footNormal, -footHeading.dot(footNormal))
        .normalize();
    }
  }

  if (alienSwimming) {
    jumpQueued = false;
    footJumpHeight = 0;
    footVerticalVelocity = 0;
    footGrounded = true;
  } else if (jumpQueued && footGrounded) {
    footVerticalVelocity = 1.35;
    footGrounded = false;
    footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
    showBanner('JETPACK FIRING · RELEASE SPACE TO DROP');
  }
  jumpQueued = false;
  const footThrusterHeld = Boolean(keys[' '] || keys.space || keys.spacebar);
  const footThrusterActive = !alienSwimming && !footGrounded && footThrusterHeld && footThrusterFuel > 0;
  const footThrusterPulse = footThrusterActive
    ? (Math.sin(time * 33.5) > -0.08 ? 1 : 0.16) * (Math.sin(time * 76) > 0.32 ? 1 : 0.78)
    : 0;
  if (footThrusterWasActive && !footThrusterActive && !footGrounded) {
    footVerticalVelocity = Math.min(footVerticalVelocity, currentWorld === 'moon' ? -1.4 : currentWorld === 'zephyra' ? -2.2 : -2.8);
    if (footJumpHeight > 0.8) showBanner('THRUST CUT · DROPPING');
  }
  footThrusterWasActive = footThrusterActive;
  alienDriver.thrusterFlames.visible = footThrusterActive;
  if (footThrusterActive) {
    footThrusterFuel = Math.max(0, footThrusterFuel - dt);
    const thrustAcceleration = (currentWorld === 'moon' ? 13.5 : currentWorld === 'zephyra' ? 17 : 19.5) * (0.34 + footThrusterPulse * 0.66);
    footVerticalVelocity = Math.min(12.5, footVerticalVelocity + thrustAcceleration * dt);
    alienDriver.thrusterFlames.scale.y = 0.42 + footThrusterPulse * 1.02;
  }
  updateThrusterAudio(footThrusterActive, false, footThrusterPulse);
  if (!footGrounded) {
    const zephyraGravity = THREE.MathUtils.lerp(-5.1, -1.28, zephyraFluxStrength);
    footVerticalVelocity += (currentWorld === 'moon' ? -1.62 : currentWorld === 'zephyra' ? zephyraGravity : marsGravity) * dt;
    footJumpHeight += footVerticalVelocity * dt;
    if (footJumpHeight <= 0) {
      footJumpHeight = 0;
      footVerticalVelocity = 0;
      footGrounded = true;
      footThrusterWasActive = false;
      alienDriver.thrusterFlames.visible = false;
    }
  } else {
    footThrusterFuel = Math.min(FOOT_THRUSTER_FUEL_MAX, footThrusterFuel + dt * 1.8);
  }

  const walkableSurfaceLift = currentWorld === 'mars' && !alienSwimming
    ? Math.max(
      projectRampDeckLift(footNormal),
      projectArchiveFloorLift(footNormal),
      alienMountainHomeFloorLift(footNormal)
    )
      + xenobiologyMuseumFloorLift(footNormal)
    : 0;
  const swimBob = alienSwimming ? Math.sin(time * 2.15) * 0.055 + Math.abs(footSpeed) * 0.008 : 0;
  const footSurfaceLift = alienSwimming ? 0.24 + swimBob : walkableSurfaceLift + footJumpHeight + 0.04;
  footRoot.position.copy(surfacePositionForWorld(currentWorld, footNormal, footSurfaceLift));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  alienHomeInterior = THREE.MathUtils.damp(
    alienHomeInterior,
    isInsideAlienMountainHome(footNormal) ? 1 : 0,
    6.5,
    dt
  );
  updatePhysicalUfoInteriorState();
  if (currentWorld === 'moon' && footGrounded && Math.abs(footSpeed) > 0.32) {
    moonFootprintTravel += Math.abs(footSpeed) * dt;
    if (moonFootprintTravel >= 0.68) {
      moonFootprintTravel %= 0.68;
      spawnMoonFootprint(footNormal, footHeading, moonFootprintSide);
      moonFootprintSide *= -1;
    }
  } else if (currentWorld !== 'moon') {
    moonFootprintTravel = 0;
  }

  const walkAmount = THREE.MathUtils.clamp(
    Math.abs(footSpeed) / (alienSwimming ? 6.2 : (WALK_SPEED_BY_WORLD[currentWorld] || WALK_SPEED_BY_WORLD.mars)),
    0,
    1
  );
  const stride = Math.sin(time * (alienSwimming ? 6.8 : 5.6 + walkAmount * 3.2)) * walkAmount;
  if (alienSwimming) {
    legs.forEach((leg, index) => {
      const side = index === 0 ? 1 : -1;
      leg.thigh.rotation.x = THREE.MathUtils.damp(leg.thigh.rotation.x, -0.28 + stride * side * 0.42, 9, dt);
      leg.shin.rotation.x = THREE.MathUtils.damp(leg.shin.rotation.x, 0.48 - stride * side * 0.24, 9, dt);
    });
    arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      const paddle = Math.sin(time * 4.6 + index * Math.PI);
      arm.upper.rotation.x = THREE.MathUtils.damp(arm.upper.rotation.x, -0.38 + paddle * 0.74 * walkAmount, 8, dt);
      arm.upper.rotation.z = THREE.MathUtils.damp(arm.upper.rotation.z, side * (0.86 + Math.cos(time * 4.6) * 0.24 * walkAmount), 8, dt);
      arm.fore.rotation.x = THREE.MathUtils.damp(arm.fore.rotation.x, 0.82 + Math.max(0, -paddle) * 0.52, 8, dt);
    });
    alienDriver.alien.position.y = THREE.MathUtils.damp(alienDriver.alien.position.y, -1.42, 7, dt);
    alienDriver.alien.rotation.x = THREE.MathUtils.damp(alienDriver.alien.rotation.x, -0.28 - walkAmount * 0.18, 7, dt);
    alienDriver.alien.rotation.z = THREE.MathUtils.damp(
      alienDriver.alien.rotation.z,
      -steeringInput * 0.12 + Math.sin(time * 2.4) * 0.025,
      7,
      dt
    );
  } else {
    legs.forEach((leg, index) => {
      const side = index === 0 ? 1 : -1;
      leg.thigh.rotation.x = THREE.MathUtils.damp(leg.thigh.rotation.x, stride * side * 0.72, 11, dt);
      leg.shin.rotation.x = THREE.MathUtils.damp(leg.shin.rotation.x, Math.max(0, -stride * side) * 0.62, 11, dt);
    });
    arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      arm.upper.rotation.x = THREE.MathUtils.damp(arm.upper.rotation.x, stride * side * 0.48, 10, dt);
      arm.upper.rotation.z = THREE.MathUtils.damp(arm.upper.rotation.z, side * -0.1, 8, dt);
      arm.fore.rotation.x = THREE.MathUtils.damp(arm.fore.rotation.x, 0.12, 8, dt);
    });
    alienDriver.alien.position.y = THREE.MathUtils.damp(alienDriver.alien.position.y, 0.04, 8, dt);
    alienDriver.alien.rotation.x = THREE.MathUtils.damp(alienDriver.alien.rotation.x, 0, 8, dt);
    alienDriver.alien.rotation.z = -steeringInput * 0.06 + Math.sin(time * 2.1) * 0.012
      + (footThrusterActive ? Math.sin(time * 71) * 0.022 : 0);
  }
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.8) * 0.018;
}

function updateTravelPrompt() {
  const caveWarpAvailable = travelMode === 'mine-train' || travelMode === 'cave-walking';
  caveWarpButtonEl.classList.toggle('show', caveWarpAvailable);
  caveWarpButtonEl.setAttribute('aria-hidden', String(!caveWarpAvailable));
  if (travelMode === 'mine-train') {
    if (caveRouteDistance >= CAVE_ROUTE_LENGTH - 0.7) setInteractionPrompt('E · STEP OFF AT VASTWATER TERMINUS  /  S · RETURN TO MARS');
    else if (caveRouteDistance <= 0.7) setInteractionPrompt('E · STEP OFF AT SURFACE STATION  /  W · DESCEND');
    else setInteractionPrompt('W · DESCEND  /  S · CLIMB  /  H · WARP HOME');
    return;
  }
  if (travelMode === 'cave-walking') {
    setInteractionPrompt(isNearCavernMineTrain()
      ? 'E · BOARD MINE TRAIN TO MARS  /  H · WARP HOME'
      : 'WASD · EXPLORE VASTWATER  /  RETURN TO TRAIN PLATFORM  /  H · HOME');
    return;
  }
  if (travelMode === 'driving') {
    if (caveTravelZone === 'tunnel') setInteractionPrompt('FOLLOW GLOWSTONE ROAD · REVERSE OUT OR WARP TO START');
    else if (caveTravelZone === 'chamber') setInteractionPrompt(`MORROW: ${hubRuntime.nightfall.bearActivity.toUpperCase()} · R OR BUTTON TO WARP HOME`);
    else if (drivingCoursePrompt) setInteractionPrompt(`${drivingCoursePrompt} · E EXIT`);
    else if (arcDistanceForWorld('mars', playerNormal, GARAGE_NORMAL) < 34) {
      setInteractionPrompt(`${drivingCourses.courses.length} MARS COURSE${drivingCourses.courses.length === 1 ? '' : 'S'} · FOLLOW COLORED SKY BEACONS · E EXIT`);
    }
    else if (arcDistanceForWorld('mars', playerNormal, START_NORMAL) < 8.5) {
      setInteractionPrompt('SHUTTLE ARRIVES IN 10 SECONDS · WATCH TOP-RIGHT COUNTDOWN · E EXIT');
    }
    else setInteractionPrompt(Math.abs(driveSpeed) < (activeProfile?.exitSpeed || 1.2) && grounded
      ? `E · EXIT ${activeVehicle?.label || 'VEHICLE'}`
      : `STOP TO EXIT ${activeVehicle?.label || 'VEHICLE'}`);
    return;
  }
  if (travelMode === 'boating') {
    setInteractionPrompt(Math.abs(oasisBoatSpeed) <= 0.8
      ? 'WASD · DRIVE OASIS SKIFF  /  E · DIVE OUT  /  F · LOOK BACK'
      : 'CRUISE THE NEBULA OASIS · SLOW DOWN TO EXIT');
    return;
  }
  if (travelMode === 'boarded') {
    if (shuttleTransit) {
      const eta = Math.max(0, Math.ceil(shuttleTransit.duration - shuttleTransit.elapsed));
      setInteractionPrompt(`SPACE BUS TO ${shuttleTransit.to.toUpperCase()} · ${eta} SEC`);
    } else {
      setInteractionPrompt(`E · DISEMBARK ${shuttleLocation.toUpperCase()} · LEAVES ${Math.max(1, Math.ceil(shuttleDockTimer))} SEC`);
    }
    return;
  }
  if (travelMode === 'hyperbike') {
    if (hyperBikeTransit) {
      const eta = Math.max(0, Math.ceil(hyperBikeTransit.duration - hyperBikeTransit.elapsed));
      setInteractionPrompt(`VOLT BIKE HYPERSPEED TO ${hyperBikeTransit.to.toUpperCase()} · ${eta} SEC`);
    } else {
      setInteractionPrompt(`E · DISEMBARK ${hyperBikeLocation.toUpperCase()}`);
    }
    return;
  }
  if (ufoInteriorActive) {
    setInteractionPrompt(hoveredProjectScreen
      ? `CLICK · OPEN ${hoveredProjectScreen.project.title.toUpperCase()} LIVE`
      : 'WASD · WALK INSIDE  /  CLICK ANY PROJECT SCREEN  /  WALK OUT THE HATCH');
    return;
  }
  if (isNearAlienMountainHome(footNormal)) {
    setInteractionPrompt(isInsideAlienMountainHome(footNormal)
      ? 'ALIEN HOME · EXPLORE THE KITCHEN, BEDROOM, AND BATHROOM · H HOME'
      : 'FOLLOW THE STONE STEP · WALK THROUGH THE OPEN MOUNTAIN-HOME DOOR');
    return;
  }
  if (currentWorld === 'mars' && isNearUfoEntry(footNormal)) {
    setInteractionPrompt("WALK UP THE RAMP · ENTER THE OPEN PROJECT ARCHIVE HATCH");
    return;
  }
  if (isNearSurfaceMineTrain(footNormal)) {
    setInteractionPrompt('E · BOARD NIGHTFALL MINE TRAIN TO THE UNDERMARS');
    return;
  }
  if (isNearOasisBoat(footNormal)) {
    setInteractionPrompt('E · DRIVE OASIS SKIFF');
    return;
  }
  if (alienSwimming) {
    setInteractionPrompt('WASD · SWIM  /  FIND THE GLOWING OASIS SKIFF  /  F · LOOK BACK');
    return;
  }
  if (isNearHyperBike(footNormal)) {
    const destination = hyperBikeLocation === 'moon' ? 'ZEPHYRA' : 'MOON';
    setInteractionPrompt(`E · RIDE VOLT BIKE TO ${destination}`);
    return;
  }
  if (currentWorld === 'zephyra') {
    setInteractionPrompt('WASD · EXPLORE ZEPHYRA  /  FIND VOLT BIKE TO RETURN');
    return;
  }
  const padNormal = currentWorld === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
  const nearPad = arcDistanceForWorld(currentWorld, footNormal, padNormal) < SHUTTLE_BOARD_RADIUS;
  if (currentWorld === 'moon' && isNearMoonFriend(footNormal)) {
    setInteractionPrompt(`E · SAY HELLO TO LUMI · ${moonFriendMood}`);
  } else if (currentWorld === 'moon' && isNearMoonCommand(footNormal)) {
    setInteractionPrompt(`E · ${moonCommandSystemsActive ? 'SET LUNA COMMAND STANDBY' : 'ACTIVATE LUNA COMMAND'}`);
  } else if (!shuttleTransit && shuttleLocation === currentWorld && nearPad) {
    setInteractionPrompt(`E · BOARD SPACE BUS · LEAVES ${Math.max(1, Math.ceil(shuttleDockTimer))} SEC`);
  } else if (nearPad) {
    setInteractionPrompt(`SPACE BUS RETURNS · ${Math.max(1, Math.ceil(shuttleEtaToWorld(currentWorld)))} SEC`);
  } else if (currentWorld === 'mars' && arcDistanceForWorld('mars', footNormal, START_NORMAL) < 8.5) {
    setInteractionPrompt('SHUTTLE ARRIVES IN 10 SECONDS · WATCH TOP-RIGHT COUNTDOWN');
  } else {
    const nearbyVehicle = currentWorld === 'mars' ? findNearestBoardableVehicle(footNormal) : null;
    setInteractionPrompt(nearbyVehicle
      ? `E · DRIVE ${nearbyVehicle.runtime.label} · ${nearbyVehicle.runtime.profile.locomotion.toUpperCase()}`
      : currentWorld === 'mars' && arcDistanceForWorld('mars', footNormal, GARAGE_NORMAL) < 28
        ? 'ARES MOTOR CAVERN · CHOOSE A VEHICLE · FOLLOW COURSE BEACONS'
        : 'WASD · WALK  /  E · USE');
  }
}

/* ---------- camera state ---------- */

const camLookTarget = alien.position.clone();
const desiredCamPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const interiorCameraSide = new THREE.Vector3();
const caveCameraLocal = new THREE.Vector3();
const caveCameraTangent = new THREE.Vector3();
const caveCameraRight = new THREE.Vector3();
const mineTrainCameraPosition = new THREE.Vector3();
const mineTrainCameraForward = new THREE.Vector3();
const mineTrainCameraUp = new THREE.Vector3();
camera.position.copy(alien.position).addScaledVector(playerNormal, 18).addScaledVector(playerHeading, -16);
camera.up.copy(playerNormal);

/* ---------- wheel dust ---------- */

const wheelDustCount = isTouchDevice ? 70 : 130;
const wheelDustPositions = new Float32Array(wheelDustCount * 3);
const wheelDustVelocity = new Float32Array(wheelDustCount * 3);
const wheelDustLife = new Float32Array(wheelDustCount);
const wheelDustGeometry = new THREE.BufferGeometry();
wheelDustGeometry.setAttribute('position', new THREE.BufferAttribute(wheelDustPositions, 3));
const wheelDust = new THREE.Points(
  wheelDustGeometry,
  new THREE.PointsMaterial({ map: dustTexture, color: 0xe89459, size: 1.25, transparent: true, opacity: 0.48, depthWrite: false })
);
scene.add(wheelDust);
let nextDustParticle = 0;
let dustSpawnAccumulator = 0;
const wheelDustRight = new THREE.Vector3();
const wheelDustGroundPoint = new THREE.Vector3();
const wheelDustSpawnPoint = new THREE.Vector3();

function spawnWheelDust(dt, speed) {
  dustSpawnAccumulator += dt * Math.min(36, 5 + Math.abs(speed) * 2.4);
  const forward = playerHeading;
  wheelDustRight.copy(playerHeading).cross(playerNormal).normalize();
  wheelDustGroundPoint.copy(playerNormal)
    .multiplyScalar(PLANET_RADIUS + getSurfaceHeight(playerNormal) + 0.35);
  while (dustSpawnAccumulator >= 1) {
    dustSpawnAccumulator -= 1;
    const index = nextDustParticle++ % wheelDustCount;
    const side = Math.random() < 0.5 ? -1 : 1;
    wheelDustSpawnPoint.copy(wheelDustGroundPoint)
      .addScaledVector(forward, -1.5)
      .addScaledVector(wheelDustRight, side * 1.22 + (Math.random() - 0.5) * 0.45);
    wheelDustPositions[index * 3] = wheelDustSpawnPoint.x;
    wheelDustPositions[index * 3 + 1] = wheelDustSpawnPoint.y;
    wheelDustPositions[index * 3 + 2] = wheelDustSpawnPoint.z;
    wheelDustVelocity[index * 3] = -forward.x * (0.9 + Math.random() * 1.8) + (Math.random() - 0.5) * 0.7;
    wheelDustVelocity[index * 3 + 1] = -forward.y * (0.9 + Math.random() * 1.8) + playerNormal.y * (0.7 + Math.random() * 1.3);
    wheelDustVelocity[index * 3 + 2] = -forward.z * (0.9 + Math.random() * 1.8) + (Math.random() - 0.5) * 0.7;
    wheelDustVelocity[index * 3] += playerNormal.x * (0.7 + Math.random() * 1.3);
    wheelDustVelocity[index * 3 + 2] += playerNormal.z * (0.7 + Math.random() * 1.3);
    wheelDustLife[index] = 0.7 + Math.random() * 0.9;
  }
}

function updateWheelDust(dt) {
  for (let i = 0; i < wheelDustCount; i++) {
    if (wheelDustLife[i] <= 0) continue;
    wheelDustLife[i] -= dt;
    wheelDustPositions[i * 3] += wheelDustVelocity[i * 3] * dt;
    wheelDustPositions[i * 3 + 1] += wheelDustVelocity[i * 3 + 1] * dt;
    wheelDustPositions[i * 3 + 2] += wheelDustVelocity[i * 3 + 2] * dt;
    wheelDustVelocity[i * 3] *= 0.985;
    wheelDustVelocity[i * 3 + 2] *= 0.985;
    if (wheelDustLife[i] <= 0) {
      wheelDustPositions[i * 3] = 0;
      wheelDustPositions[i * 3 + 1] = 0;
      wheelDustPositions[i * 3 + 2] = 0;
    }
  }
  wheelDustGeometry.attributes.position.needsUpdate = true;
}

/* ---------- persistent lunar bootprints & ballistic regolith ---------- */

function makeMoonFootprintTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(64, 145, 25, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(38, 52, 52, 90);
  ctx.beginPath();
  ctx.ellipse(64, 54, 27, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  [39, 64, 89].forEach((x, index) => {
    ctx.beginPath();
    ctx.ellipse(x, 25 + Math.abs(index - 1) * 4, 12, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 0.62;
  for (let y = 67; y < 143; y += 19) {
    ctx.fillRect(42, y, 18, 6);
    ctx.fillRect(68, y + 6, 18, 6);
  }
  ctx.globalCompositeOperation = 'source-over';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const moonFootprintLimit = isTouchDevice ? 90 : 180;
const moonFootprintGeometry = new THREE.PlaneGeometry(0.46, 0.78);
moonFootprintGeometry.rotateX(-Math.PI / 2);
const moonFootprints = new THREE.InstancedMesh(
  moonFootprintGeometry,
  new THREE.MeshBasicMaterial({
    map: makeMoonFootprintTexture(),
    color: 0x222128,
    transparent: true,
    opacity: 0.52,
    alphaTest: 0.06,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }),
  moonFootprintLimit
);
moonFootprints.name = 'Persistent lunar bootprint trail';
moonFootprints.count = 0;
scene.add(moonFootprints);
const moonFootprintDummy = new THREE.Object3D();
const moonFootprintRight = new THREE.Vector3();
const moonFootprintNormal = new THREE.Vector3();
const moonFootprintHeading = new THREE.Vector3();
const moonFootprintBack = new THREE.Vector3();
const moonFootprintMatrix = new THREE.Matrix4();
let moonFootprintWriteIndex = 0;
let moonFootprintTravel = 0;
let moonFootprintSide = -1;

const moonFootDustCount = isTouchDevice ? 42 : 82;
const moonFootDustPositions = new Float32Array(moonFootDustCount * 3);
const moonFootDustVelocities = Array.from({ length: moonFootDustCount }, () => new THREE.Vector3());
const moonFootDustLife = new Float32Array(moonFootDustCount);
const moonFootDustGeometry = new THREE.BufferGeometry();
moonFootDustGeometry.setAttribute('position', new THREE.BufferAttribute(moonFootDustPositions, 3));
const moonFootDust = new THREE.Points(
  moonFootDustGeometry,
  new THREE.PointsMaterial({
    color: 0xc8c2bd,
    size: 0.17,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  })
);
moonFootDust.name = 'Ballistic lunar regolith grains';
scene.add(moonFootDust);
let moonFootDustWriteIndex = 0;
const moonFootDustGravity = new THREE.Vector3();
const moonFootDustSurfaceNormal = new THREE.Vector3();

function spawnMoonFootprint(normal, heading, side) {
  moonFootprintRight.copy(heading).cross(normal).normalize();
  moonFootprintNormal.copy(stepWorldNormal(normal, moonFootprintRight, side * 0.18, MOON_RADIUS));
  moonFootprintHeading.copy(heading)
    .addScaledVector(moonFootprintNormal, -heading.dot(moonFootprintNormal))
    .normalize();
  moonFootprintRight.copy(moonFootprintHeading).cross(moonFootprintNormal).normalize();
  moonFootprintBack.copy(moonFootprintHeading).multiplyScalar(-1);
  moonFootprintMatrix.makeBasis(moonFootprintRight, moonFootprintNormal, moonFootprintBack);
  moonFootprintDummy.position.copy(MOON_CENTER).addScaledVector(moonFootprintNormal, MOON_RADIUS + getMoonHeight(moonFootprintNormal) + 0.026);
  moonFootprintDummy.quaternion.setFromRotationMatrix(moonFootprintMatrix);
  moonFootprintDummy.rotateY(side * 0.055);
  moonFootprintDummy.scale.set(0.92 + Math.random() * 0.12, 1, 0.94 + Math.random() * 0.1);
  moonFootprintDummy.updateMatrix();
  const index = moonFootprintWriteIndex++ % moonFootprintLimit;
  moonFootprints.setMatrixAt(index, moonFootprintDummy.matrix);
  moonFootprints.count = Math.min(moonFootprintLimit, Math.max(moonFootprints.count, index + 1));
  moonFootprints.instanceMatrix.needsUpdate = true;

  for (let grain = 0; grain < 4; grain++) {
    const dustIndex = moonFootDustWriteIndex++ % moonFootDustCount;
    const position = moonFootprintDummy.position.clone()
      .addScaledVector(moonFootprintRight, (Math.random() - 0.5) * 0.32)
      .addScaledVector(moonFootprintHeading, (Math.random() - 0.5) * 0.24);
    moonFootDustPositions[dustIndex * 3] = position.x;
    moonFootDustPositions[dustIndex * 3 + 1] = position.y;
    moonFootDustPositions[dustIndex * 3 + 2] = position.z;
    moonFootDustVelocities[dustIndex].copy(moonFootprintNormal).multiplyScalar(0.22 + Math.random() * 0.5)
      .addScaledVector(moonFootprintHeading, -0.12 - Math.random() * 0.28)
      .addScaledVector(moonFootprintRight, (Math.random() - 0.5) * 0.34);
    moonFootDustLife[dustIndex] = 0.42 + Math.random() * 0.46;
  }
  moonFootDustGeometry.attributes.position.needsUpdate = true;
}

function updateMoonFootDust(dt) {
  for (let index = 0; index < moonFootDustCount; index++) {
    if (moonFootDustLife[index] <= 0) continue;
    const offset = index * 3;
    moonFootDustGravity.set(
      moonFootDustPositions[offset],
      moonFootDustPositions[offset + 1],
      moonFootDustPositions[offset + 2]
    );
    moonFootDustGravity.sub(MOON_CENTER).normalize().multiplyScalar(-1.62 * dt);
    moonFootDustVelocities[index].add(moonFootDustGravity);
    moonFootDustPositions[offset] += moonFootDustVelocities[index].x * dt;
    moonFootDustPositions[offset + 1] += moonFootDustVelocities[index].y * dt;
    moonFootDustPositions[offset + 2] += moonFootDustVelocities[index].z * dt;
    moonFootDustLife[index] -= dt;
    moonFootDustSurfaceNormal.set(
      moonFootDustPositions[offset] - MOON_CENTER.x,
      moonFootDustPositions[offset + 1] - MOON_CENTER.y,
      moonFootDustPositions[offset + 2] - MOON_CENTER.z
    );
    const radialDistance = moonFootDustSurfaceNormal.length();
    moonFootDustSurfaceNormal.normalize();
    const surfaceRadius = MOON_RADIUS + getMoonHeight(moonFootDustSurfaceNormal);
    if (moonFootDustLife[index] <= 0 || radialDistance <= surfaceRadius + 0.015) {
      moonFootDustLife[index] = 0;
      moonFootDustPositions[offset] = 0;
      moonFootDustPositions[offset + 1] = 0;
      moonFootDustPositions[offset + 2] = 0;
    }
  }
  moonFootDustGeometry.attributes.position.needsUpdate = true;
}

function configureLunarShadows(root, { cast = true, receive = true } = {}) {
  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const opaqueLitSurface = materials.some((material) => (
      material?.isMeshStandardMaterial
      && (!material.transparent || material.opacity >= 0.82)
    ));
    if (!opaqueLitSurface) return;
    if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
    const radius = child.geometry.boundingSphere?.radius ?? 0;
    child.receiveShadow = receive;
    child.castShadow = cast && radius >= 0.26 && !child.name.toLowerCase().includes('floor');
  });
}

// The deformed Moon already receives directional shading. Casting the entire
// high-resolution globe into the local shadow map duplicates tens of thousands
// of terrain triangles and contributes no useful nearby contact shadow.
moonSurface.castShadow = false;
moonSurface.receiveShadow = true;
configureLunarShadows(moonRegolithGeology.group, { cast: false });
configureLunarShadows(moonColdTrapRuntime.group, { cast: false });
configureLunarShadows(moonRayedCraterRuntime.group, { cast: false });
configureLunarShadows(moonLandingPad.group, { cast: false });
configureLunarShadows(moonBikeLandingPad.group, { cast: false });
configureLunarShadows(moonCommandRuntime.group);
configureLunarShadows(moonFriendRuntime.root, { receive: false });
configureLunarShadows(moonShuttle, { receive: false });
configureLunarShadows(hyperBike, { receive: false });
configureLunarShadows(alienDriver.alien, { receive: false });

const moonLightingFocus = MOON_PAD_POSITION.clone();
const moonLightDesiredFocus = new THREE.Vector3();

function lunarTransitPresence(transit) {
  if (!transit) return 0;
  const progress = THREE.MathUtils.clamp(transit.elapsed / transit.duration, 0, 1);
  return transit.from === 'moon'
    ? 1 - THREE.MathUtils.smoothstep(progress, 0.06, 0.42)
    : transit.to === 'moon'
      ? THREE.MathUtils.smoothstep(progress, 0.58, 0.94)
      : 0;
}

function updateLunarLighting(dt, time) {
  let targetBlend = 0;
  if (travelMode === 'walking') targetBlend = currentWorld === 'moon' ? 1 : 0;
  else if (travelMode === 'boarded') targetBlend = shuttleTransit ? lunarTransitPresence(shuttleTransit) : shuttleLocation === 'moon' ? 1 : 0;
  else if (travelMode === 'hyperbike') targetBlend = hyperBikeTransit ? lunarTransitPresence(hyperBikeTransit) : hyperBikeLocation === 'moon' ? 1 : 0;

  if (targetBlend > 0.01) ensureEarthriseTextures();

  moonLightingBlend = THREE.MathUtils.damp(moonLightingBlend, targetBlend, 3.2, dt);
  moonSunLight.intensity = moonLightingBlend * 2.65;
  moonSunLight.visible = moonLightingBlend > 0.004;
  moonBounceLight.intensity = moonLightingBlend * 0.2;
  moonEarthLight.intensity = moonLightingBlend * 0.14;
  moonSurface.material.emissiveIntensity = THREE.MathUtils.lerp(0.22, 0.025, moonLightingBlend);

  const earthVisibility = THREE.MathUtils.smoothstep(moonLightingBlend, 0.015, 0.48);
  earthriseRuntime.group.visible = earthVisibility > 0.004;
  earthriseRuntime.surfaceMaterial.opacity = earthVisibility;
  earthriseRuntime.cloudMaterial.opacity = earthVisibility * 0.72;
  earthriseRuntime.atmosphereMaterial.uniforms.uOpacity.value = earthVisibility;
  earthriseRuntime.spinRoot.rotation.y = 0.62 + time * 0.012;
  earthriseRuntime.clouds.rotation.y = time * 0.006;

  if (!moonSunLight.visible) return;
  if (travelMode === 'walking' && currentWorld === 'moon') moonLightDesiredFocus.copy(footRoot.position);
  else if (travelMode === 'boarded' && !shuttleTransit && shuttleLocation === 'moon') moonLightDesiredFocus.copy(moonShuttle.position);
  else if (travelMode === 'hyperbike' && !hyperBikeTransit && hyperBikeLocation === 'moon') moonLightDesiredFocus.copy(hyperBike.position);
  else moonLightDesiredFocus.copy(MOON_PAD_POSITION);

  moonLightingFocus.lerp(moonLightDesiredFocus, 1 - Math.exp(-dt * 4.5));
  moonSunTarget.position.copy(moonLightingFocus);
  moonSunLight.position.copy(moonLightingFocus).addScaledVector(moonSolarDirection, 72);
  moonEarthLightTarget.position.copy(moonLightingFocus);
  moonEarthLight.position.copy(earthriseRuntime.group.position);
}

// Compose the planet, weather, and cave lighting once per render frame. Weather
// simulation is intentionally throttled for performance; applying its light
// multipliers inside that slower update made the scene alternate between clear
// and storm exposure on consecutive frames.
function applyGlobalLighting() {
  const marsSurfaceActive = (
    (travelMode === 'driving' && caveTravelZone === 'surface')
    || (travelMode === 'walking' && currentWorld === 'mars')
    || travelMode === 'boating'
  );
  const dustBlend = marsSurfaceActive ? marsDustStormBlend * (1 - caveDarkness) : 0;

  let hemisphereIntensity = THREE.MathUtils.lerp(0.85, 0.1, moonLightingBlend);
  let sunIntensity = THREE.MathUtils.lerp(1.8, 0.08, moonLightingBlend);
  let ambientIntensity = THREE.MathUtils.lerp(0.16, 0.025, moonLightingBlend);
  let exposure = THREE.MathUtils.lerp(1.12, 0.98, moonLightingBlend);

  sunIntensity *= THREE.MathUtils.lerp(1, 0.38, dustBlend);
  hemisphereIntensity *= THREE.MathUtils.lerp(1, 0.58, dustBlend);
  ambientIntensity *= THREE.MathUtils.lerp(1, 0.72, dustBlend);
  exposure *= THREE.MathUtils.lerp(1, 0.78, dustBlend);

  sunLight.intensity = THREE.MathUtils.lerp(sunIntensity, 0.025, caveDarkness);
  hemisphereLight.intensity = THREE.MathUtils.lerp(hemisphereIntensity, 0.018, caveDarkness);
  ambientLight.intensity = THREE.MathUtils.lerp(ambientIntensity, 0.026, caveDarkness);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(exposure, 0.58, caveDarkness);
}

/* ---------- animation loop ---------- */

const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const backVec = new THREE.Vector3();
const travelAxis = new THREE.Vector3();
const candidateVehicleNormal = new THREE.Vector3();
const candidateVehicleHeading = new THREE.Vector3();
const vehicleMotionDirection = new THREE.Vector3();
const terrainSampleNormal = new THREE.Vector3();
const terrainSampleAxis = new THREE.Vector3();
const orientationMatrix = new THREE.Matrix4();
const targetRoverQuaternion = new THREE.Quaternion();
const marsGravity = -3.73;
let driveSpeed = 0;
let verticalVelocity = 0;
let jumpHeight = 0;
let grounded = true;
let suspensionPhase = 0;
let terrainSampleAccumulator = Infinity;
let cachedFrontHeight = 0;
let cachedRearHeight = 0;
let cachedRightHeight = 0;
let cachedLeftHeight = 0;

const speedValueEl = document.getElementById('speed-value');
const elevationValueEl = document.getElementById('elevation-value');

const clock = new THREE.Clock();
let environmentUpdateInterval = 1 / qualitySettings.ambientUpdateHz;
let environmentUpdateAccumulator = environmentUpdateInterval;
const hudUpdateInterval = isTouchDevice ? 1 / 10 : 1 / 12;
let hudUpdateAccumulator = hudUpdateInterval;

qualityManager.subscribe(({ settings }) => {
  environmentUpdateInterval = 1 / settings.ambientUpdateHz;
}, { emitCurrent: false });

// Keep each explorable world's expensive foreground content resident only while
// the camera is near that world. The inexpensive planet shells stay visible in
// space, so interplanetary views and transit silhouettes are unchanged.
const worldDetailObjects = {
  mars: [
    marsRockField,
    ...marsTrailMeshes,
    ...marsSignposts,
    airborneDust,
    aeolianSaltation.points,
    marsDustFront.group,
    ...dustDevils.map((devil) => devil.points),
    marsEscarpmentRuntime.group,
    marsEscarpmentRuntime.landmarkLabel,
    marsYardangRuntime.group,
    marsYardangRuntime.landmarkLabel,
    marsImpactBasinRuntime.group,
    marsImpactBasinRuntime.landmarkLabel,
    ...Object.values(hubRuntime).map((runtime) => runtime.group),
    marsLandingPad.group,
    rockGarage.root,
    drivingCourses.root,
    oasisLake.root,
    ...vehicleRuntimes.map((runtime) => runtime.root),
    wheelDust,
  ],
  moon: [
    moonRegolithGeology.group,
    moonColdTrapRuntime.group,
    moonRayedCraterRuntime.group,
    moonLandingPad.group,
    moonBikeLandingPad.group,
    moonCommandPath,
    moonCommandRuntime.group,
    moonFriendRuntime.root,
    moonFootprints,
    moonFootDust,
  ],
  zephyra: [
    zephyraBikeLandingPad.group,
    zephyraStormRuntime.group,
    zephyraCanyonRuntime.group,
    zephyraFluxRuntime.group,
    zephyraAuroraRuntime.group,
    zephyraGroveRuntime.group,
  ],
};
const marsHubGroups = new Set(Object.values(hubRuntime).map((runtime) => runtime.group));
const xenobiologyInteriorCullObjects = worldDetailObjects.mars.filter((object) => !marsHubGroups.has(object));
const xenobiologyInteriorVisibility = new Map();
let xenobiologyInteriorCullActive = false;
const worldDetailResidency = { mars: null, moon: null, zephyra: null };
const worldDetailThresholds = {
  mars: { show: 125, hide: 180 },
  moon: { show: 72, hide: 100 },
  zephyra: { show: 85, hide: 115 },
};
const marsHubDetailStreaming = {
  outpost: { show: 100, hide: 118, resident: null },
  cavern: { show: 60, hide: 78, resident: null },
  planetarium: { show: 78, hide: 96, resident: null },
  crash: { show: 60, hide: 78, resident: null },
  home: { show: 72, hide: 90, resident: null },
};
const worldDetailEntries = Object.keys(worldDetailResidency);
const marsHubDetailEntries = Object.entries(marsHubDetailStreaming).map(([key, stream]) => ({
  key,
  stream,
  runtime: hubRuntime[key],
  hub: HUBS.find((candidate) => candidate.key === key),
}));
const detailStreamingUpdateInterval = 1 / 8;
let detailStreamingUpdateAccumulator = detailStreamingUpdateInterval;

function resetInactiveWorldState(world) {
  if (world === 'mars') {
    marsDustStormBlend = 0;
    marsDustStormWasNear = false;
    if (scene.fog === marsDustFog) scene.fog = null;
    scene.background.copy(clearSpaceColor);
    sunLight.color.copy(clearSunColor);
    hemisphereLight.color.copy(clearHemisphereSky);
    hemisphereLight.groundColor.copy(clearHemisphereGround);
  } else if (world === 'moon') {
    moonCommandInterior = 0;
    moonColdTrapProximity = 0;
    moonRayedCraterProximity = 0;
  } else {
    zephyraStormProximity = 0;
    zephyraCanyonProximity = 0;
    zephyraFluxProximity = 0;
    zephyraAuroraProximity = 0;
    zephyraGroveProximity = 0;
  }
}

function updateWorldDetailStreaming() {
  const surfaceDistances = {
    mars: Math.max(0, camera.position.length() - PLANET_RADIUS),
    moon: Math.max(0, camera.position.distanceTo(MOON_CENTER) - MOON_RADIUS),
    zephyra: Math.max(0, camera.position.distanceTo(ZEPHYRA_CENTER) - ZEPHYRA_RADIUS),
  };
  worldDetailEntries.forEach((world) => {
    const threshold = worldDetailThresholds[world];
    const wasResident = worldDetailResidency[world];
    const shouldBeResident = worldDetailStreamingDisabled || (wasResident === null
      ? surfaceDistances[world] < threshold.show
      : surfaceDistances[world] < (wasResident ? threshold.hide : threshold.show));
    if (shouldBeResident === wasResident) return;
    worldDetailResidency[world] = shouldBeResident;
    worldDetailObjects[world].forEach((object) => { object.visible = shouldBeResident; });
    if (!shouldBeResident) resetInactiveWorldState(world);
  });
}

function activeMarsSurfaceNormal() {
  if (travelMode === 'driving' && caveTravelZone === 'surface') return playerNormal;
  if (travelMode === 'boating') return oasisLake.boat.normal;
  if (travelMode === 'walking' && currentWorld === 'mars') return footNormal;
  return null;
}

function updateMarsHubDetailStreaming() {
  const activeNormal = activeMarsSurfaceNormal();
  for (const { key, stream, runtime, hub } of marsHubDetailEntries) {
    if (!runtime?.group || !hub) continue;
    const distance = activeNormal ? geodesicDistance(activeNormal, hub.normal) : Infinity;
    const threshold = (stream.resident ? stream.hide : stream.show) * qualitySettings.lodDistanceScale;
    const shouldBeResident = Boolean(
      worldDetailResidency.mars
      && (worldDetailStreamingDisabled || distance < threshold)
    );
    if (shouldBeResident === stream.resident) continue;
    stream.resident = shouldBeResident;
    runtime.group.visible = shouldBeResident;
    if (key === 'home' && shouldBeResident && !runtime.loaded) ensureAlienMountainHome();
  }
}

function updateDetailStreaming(dt) {
  detailStreamingUpdateAccumulator += dt;
  if (detailStreamingUpdateAccumulator < detailStreamingUpdateInterval) return;
  detailStreamingUpdateAccumulator %= detailStreamingUpdateInterval;
  updateWorldDetailStreaming();
  updateMarsHubDetailStreaming();
}

// The xenobiology globe is transparent, but the distant Mars surface detail is
// too small to contribute to its interior views. Temporarily hiding it removes
// hundreds of draw calls without changing the nearby habitat or planet shell.
function updateXenobiologyInteriorCulling(shouldCull) {
  if (shouldCull === xenobiologyInteriorCullActive) return;
  xenobiologyInteriorCullActive = shouldCull;
  if (shouldCull) {
    xenobiologyInteriorVisibility.clear();
    xenobiologyInteriorCullObjects.forEach((object) => {
      xenobiologyInteriorVisibility.set(object, object.visible);
      object.visible = false;
    });
    return;
  }
  xenobiologyInteriorCullObjects.forEach((object) => {
    object.visible = Boolean(worldDetailResidency.mars && xenobiologyInteriorVisibility.get(object));
  });
  xenobiologyInteriorVisibility.clear();
}

const performanceQuery = startupQuery;
const performanceDebugEnabled = performanceQuery.has('perf');
const performanceDrawProfileEnabled = performanceDebugEnabled && performanceQuery.has('draw-profile');
const worldDetailStreamingDisabled = performanceDebugEnabled && performanceQuery.has('no-stream');
const performanceDebugEl = performanceDebugEnabled ? document.createElement('pre') : null;
let performanceDebugTime = 0;
let performanceDebugFrames = 0;
let performanceWorstFrameMs = 0;
let performanceLongFrames = 0;
const performanceDrawCalls = new Map();
const performanceDrawStarts = new WeakMap();
const xenobiologyQualityMaterialSet = new Set(
  hubRuntime.planetarium.qualitySensitiveMaterials.map((entry) => entry.material)
);
const globalQualitySensitiveMaterials = collectQualitySensitiveMaterials(scene, xenobiologyQualityMaterialSet);
const globalQualityLocalLights = [];
scene.traverse((object) => {
  if (object.isPointLight || object.isSpotLight) globalQualityLocalLights.push(object);
});
function applyGlobalMaterialQuality(settings) {
  const useHighQuality = settings.materialQuality === 'high';
  applyQualitySensitiveMaterials(globalQualitySensitiveMaterials, useHighQuality);
  // Local lights multiply shader variants whenever streamed groups appear.
  // Medium/Low rely on emissive art plus the stable global lighting rig.
  globalQualityLocalLights.forEach((light) => { light.visible = useHighQuality; });
}
applyGlobalMaterialQuality(qualitySettings);
qualityManager.subscribe(({ settings }) => applyGlobalMaterialQuality(settings), { emitCurrent: false });
if (performanceDebugEnabled) {
  window.__ALIEN_GAME_DEBUG__ = { camera, renderer, scene };
}
if (performanceDrawProfileEnabled) {
  const xenobiologyHall = hubRuntime.planetarium.habitatHall;
  scene.traverse((object) => {
    if (!object.isMesh && !object.isLine && !object.isPoints && !object.isSprite) return;
    const beforeRender = object.onBeforeRender;
    const afterRender = object.onAfterRender;
    object.onBeforeRender = function profileBeforeRender(...args) {
      performanceDrawStarts.set(this, renderer.info.render.calls);
      beforeRender.apply(this, args);
    };
    object.onAfterRender = function profileAfterRender(...args) {
      afterRender.apply(this, args);
      const drawCalls = renderer.info.render.calls - (performanceDrawStarts.get(this) || 0);
      let category = this;
      while (category.parent && category.parent !== scene && category.parent !== xenobiologyHall) {
        category = category.parent;
      }
      const name = category.name || category.type;
      performanceDrawCalls.set(name, (performanceDrawCalls.get(name) || 0) + drawCalls);
    };
  });
}
if (performanceDebugEl) {
  performanceDebugEl.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:50;margin:0;padding:9px 11px;color:#bfffe9;background:rgba(2,8,12,.82);border:1px solid rgba(120,255,225,.4);font:600 11px/1.4 monospace;pointer-events:none';
  document.body.appendChild(performanceDebugEl);
}

function updatePerformanceDebug(dt) {
  if (!performanceDebugEl) return;
  performanceDebugTime += dt;
  performanceDebugFrames += 1;
  performanceWorstFrameMs = Math.max(performanceWorstFrameMs, dt * 1000);
  if (dt > 1 / 30) performanceLongFrames += 1;
  if (performanceDebugTime < 0.5) return;
  const snapshot = {
    fps: performanceDebugFrames / performanceDebugTime,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    pixelRatio: currentRenderPixelRatio,
    qualityMode: qualityManager.mode,
    qualityTier: qualityManager.tier,
    worstFrameMs: performanceWorstFrameMs,
    longFrames: performanceLongFrames,
    residency: { ...worldDetailResidency },
    xenobiologyCullActive: xenobiologyInteriorCullActive,
    xenobiologyCullVisible: xenobiologyInteriorCullObjects.filter((object) => object.visible).length,
    xenobiologyTransmission: hubRuntime.planetarium.qualitySensitiveMaterials
      .filter((entry) => entry.material.transmission > 0).length,
    drawProfile: [...performanceDrawCalls.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5),
  };
  window.__ALIEN_GAME_PERF__ = snapshot;
  performanceDebugEl.textContent = [
    `FPS ${snapshot.fps.toFixed(0)} · DPR ${snapshot.pixelRatio.toFixed(2)}`,
    `WORST ${snapshot.worstFrameMs.toFixed(1)} MS · LONG ${snapshot.longFrames}`,
    `QUALITY ${snapshot.qualityMode.toUpperCase()} · ${snapshot.qualityTier.toUpperCase()}`,
    `CALLS ${snapshot.calls} · TRIS ${snapshot.triangles.toLocaleString()}`,
    `GPU GEO ${snapshot.geometries} · TEX ${snapshot.textures}`,
    `DETAIL M:${snapshot.residency.mars ? 'ON' : 'OFF'} L:${snapshot.residency.moon ? 'ON' : 'OFF'} Z:${snapshot.residency.zephyra ? 'ON' : 'OFF'}`,
    `XENO CULL:${snapshot.xenobiologyCullActive ? 'ON' : 'OFF'} VISIBLE:${snapshot.xenobiologyCullVisible} TX:${snapshot.xenobiologyTransmission}`,
    ...(snapshot.drawProfile.length
      ? [`TOP ${snapshot.drawProfile.map(([name, calls]) => `${name}:${calls}`).join(' · ')}`]
      : []),
    worldDetailStreamingDisabled ? 'STREAMING BYPASS · BENCHMARK' : 'STREAMING ACTIVE',
  ].join('\n');
  performanceDrawCalls.clear();
  performanceDebugTime = 0;
  performanceDebugFrames = 0;
  performanceWorstFrameMs = 0;
  performanceLongFrames = 0;
}

function updateAdaptiveResolution(rawDt) {
  if (!loadingComplete || document.hidden) return;
  qualityManager.recordFrame(rawDt);
}

setLoadingStage(88, 'SYNCHRONIZING ALIEN LIFE SIGNS');

function stepSurfaceNormalInto(out, normal, direction, distance) {
  terrainSampleAxis.crossVectors(normal, direction).normalize();
  return out.copy(normal).applyAxisAngle(terrainSampleAxis, distance / PLANET_RADIUS).normalize();
}

function isActiveVehiclePathBlocked(candidateNormal) {
  const collisionRadius = activeProfile?.collisionRadius || 1.45;
  for (const obstacle of obstacles) {
    const angularRadius = (obstacle.radius + collisionRadius) / PLANET_RADIUS;
    if (candidateNormal.dot(obstacle.normal) > Math.cos(angularRadius)) return true;
  }
  for (const runtime of vehicleRuntimes) {
    if (!runtime.parked || runtime === activeVehicle) continue;
    const angularRadius = (runtime.profile.collisionRadius + collisionRadius + 0.4) / PLANET_RADIUS;
    if (candidateNormal.dot(runtime.parkedNormal) > Math.cos(angularRadius)) return true;
  }
  return false;
}

function updateDrivingCourseGameplay(dt, time) {
  if (caveTravelZone !== 'surface' || !activeVehicle || !activeProfile) {
    drivingCoursePrompt = '';
    activeDrivingCourse = null;
    return;
  }
  const result = drivingCourses.update({
    normal: playerNormal,
    speed: driveSpeed,
    grounded,
    time,
    dt,
  });
  drivingCoursePrompt = result.prompt || '';
  activeDrivingCourse = result.activeCourse || null;
  if (result.boost) {
    const direction = driveSpeed < 0 ? -1 : 1;
    const speedLimit = direction > 0 ? activeProfile.maxForwardSpeed * 1.28 : activeProfile.maxReverseSpeed * 1.12;
    driveSpeed = THREE.MathUtils.clamp(driveSpeed + direction * result.boost, -speedLimit, speedLimit);
  }
  if (result.jumpImpulse && grounded) {
    grounded = false;
    jumpHeight = Math.max(jumpHeight, 0.04);
    verticalVelocity = Math.max(verticalVelocity, result.jumpImpulse);
    roverThrusterFuel = activeProfile.lift.fuel;
  }
  if (result.event) showBanner(result.event);
}

// Focused live-test entry point. It is inert during normal play, but lets the
// performance overlay and browser QA boot directly into one chosen physics rig.
const vehicleQaId = performanceQuery.get('vehicle-qa');
const signQaHub = HUBS.find((hub) => hub.key === performanceQuery.get('sign-qa'));
if (signQaHub) {
  const signQaTrailDistance = geodesicDistance(START_NORMAL, signQaHub.normal);
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(slerpNormals(START_NORMAL, signQaHub.normal, 3.3 / signQaTrailDistance));
  footHeading.copy(signQaHub.normal)
    .addScaledVector(footNormal, -signQaHub.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (performanceQuery.has('garage-roof-qa')) {
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(GARAGE_NORMAL, GARAGE_OUTWARD_HEADING, 34, PLANET_RADIUS));
  footHeading.copy(GARAGE_NORMAL)
    .addScaledVector(footNormal, -GARAGE_NORMAL.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (performanceQuery.has('shuttle-countdown-qa')) {
  const padApproach = START_NORMAL.clone()
    .addScaledVector(MARS_PORT.normal, -START_NORMAL.dot(MARS_PORT.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(MARS_PORT.normal, padApproach, 7, PLANET_RADIUS));
  footHeading.copy(MARS_PORT.normal)
    .addScaledVector(footNormal, -MARS_PORT.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (performanceQuery.has('ufo-shop-qa')) {
  const shopHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const shopApproach = START_NORMAL.clone()
    .addScaledVector(shopHub.normal, -START_NORMAL.dot(shopHub.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(shopHub.normal, shopApproach, 60, PLANET_RADIUS));
  footHeading.copy(shopHub.normal)
    .addScaledVector(footNormal, -shopHub.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
}
if (performanceQuery.has('ufo-ramp-qa')) {
  const shopHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const rampApproach = START_NORMAL.clone()
    .addScaledVector(shopHub.normal, -START_NORMAL.dot(shopHub.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(shopHub.normal, rampApproach, 38, PLANET_RADIUS));
  footHeading.copy(shopHub.normal)
    .addScaledVector(footNormal, -shopHub.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
  keys.w = true;
}
if (performanceQuery.has('ufo-hatch-qa')) {
  const shopHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const hatchApproach = START_NORMAL.clone()
    .addScaledVector(shopHub.normal, -START_NORMAL.dot(shopHub.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  ufoInteriorActive = false;
  hubRuntime.outpost.saucer.visible = true;
  footNormal.copy(stepWorldNormal(shopHub.normal, hatchApproach, 15.8, PLANET_RADIUS));
  footHeading.copy(shopHub.normal)
    .addScaledVector(footNormal, -shopHub.normal.dot(footNormal))
    .normalize();
  const hatchDeckLift = Math.max(projectRampDeckLift(footNormal), projectArchiveFloorLift(footNormal));
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, hatchDeckLift + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  footSpeed = 0;
  keys.w = false;
  keys.arrowup = false;
  lookingAtCamera = false;
}
if (
  performanceQuery.has('planetarium-qa')
  || performanceQuery.has('xenobiology-qa')
  || performanceQuery.has('xenobiology-interior-qa')
  || performanceQuery.has('aquarium-qa')
) {
  const planetariumHub = HUBS.find((hub) => hub.key === 'planetarium');
  const planetariumApproach = START_NORMAL.clone()
    .addScaledVector(planetariumHub.normal, -START_NORMAL.dot(planetariumHub.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  const museumApproachDistance = performanceQuery.has('aquarium-qa')
    ? -4.8
    : performanceQuery.has('xenobiology-interior-qa') ? 4.2 : 34;
  footNormal.copy(stepWorldNormal(planetariumHub.normal, planetariumApproach, museumApproachDistance, PLANET_RADIUS));
  const museumFocusNormal = performanceQuery.has('aquarium-qa')
    ? stepWorldNormal(planetariumHub.normal, planetariumApproach, -19.6, PLANET_RADIUS)
    : planetariumHub.normal;
  footHeading.copy(museumFocusNormal)
    .addScaledVector(footNormal, -museumFocusNormal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, xenobiologyMuseumFloorLift(footNormal) + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (
  performanceQuery.has('oasis-lake-qa')
  || performanceQuery.has('oasis-swim-qa')
  || performanceQuery.has('oasis-boat-qa')
  || performanceQuery.has('oasis-distant-qa')
) {
  currentWorld = 'mars';
  travelMode = 'walking';
  const oasisQaFocus = performanceQuery.has('oasis-swim-qa')
    ? oasisLake.boat.normal
    : MARS_OASIS_NORMAL;
  footNormal.copy(
    performanceQuery.has('oasis-distant-qa')
      ? oasisNormalAt(0, 104)
      : performanceQuery.has('oasis-swim-qa')
      ? oasisNormalAt(0, 8)
      : performanceQuery.has('oasis-boat-qa') ? oasisLake.boat.normal : oasisTrailNormal
  );
  footHeading.copy(oasisQaFocus)
    .addScaledVector(footNormal, -oasisQaFocus.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
  if (performanceQuery.has('oasis-boat-qa')) {
    boardOasisBoat();
    if (performanceQuery.has('qa-drive')) keys.w = true;
  }
  if (performanceQuery.has('qa-swim')) keys.w = true;
}
if (performanceQuery.has('ufo-archive-qa') || performanceQuery.has('ufo-cabin-static-qa')) {
  const shopHub = HUBS.find((hub) => hub.key === PORTFOLIO_HUB_KEY);
  const shopApproach = START_NORMAL.clone()
    .addScaledVector(shopHub.normal, -START_NORMAL.dot(shopHub.normal))
    .normalize();
  currentWorld = 'mars';
  travelMode = 'walking';
  ufoInteriorActive = true;
  hubRuntime.outpost.saucer.visible = false;
  hubRuntime.outpost.archiveLabel.visible = false;
  hubRuntime.outpost.entryFrame.visible = false;
  footNormal.copy(stepWorldNormal(shopHub.normal, shopApproach, 6.4, PLANET_RADIUS));
  footHeading.copy(shopHub.normal)
    .addScaledVector(footNormal, -shopHub.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, projectArchiveFloorLift(footNormal) + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  footSpeed = 0;
  keys.w = false;
  keys.arrowup = false;
  lookingAtCamera = false;
  loadUfoProjectScreens();
}
if (performanceQuery.has('walk-audio-qa')) keys.w = true;
if (performanceQuery.has('foot-thrust-qa')) {
  keys[' '] = true;
  jumpQueued = true;
}
if (performanceQuery.has('alien-house-qa')) {
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(ALIEN_MOUNTAIN_HOME.normal, ALIEN_HOME_APPROACH_HEADING, 17.5, PLANET_RADIUS));
  footHeading.copy(ALIEN_MOUNTAIN_HOME.normal)
    .addScaledVector(footNormal, -ALIEN_MOUNTAIN_HOME.normal.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, alienMountainHomeFloorLift(footNormal) + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
  if (performanceQuery.has('qa-walk')) keys.w = true;
}
if (performanceQuery.has('rock-realism-qa')) {
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(
    MARS_IMPACT_BASIN_NORMAL,
    MARS_IMPACT_BASIN_TANGENT,
    MARS_IMPACT_BASIN_RADIUS * 2.12,
    PLANET_RADIUS
  ));
  footHeading.copy(MARS_IMPACT_BASIN_NORMAL)
    .addScaledVector(footNormal, -MARS_IMPACT_BASIN_NORMAL.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (performanceQuery.has('moon-rocks-qa')) {
  currentWorld = 'moon';
  travelMode = 'walking';
  const moonQaHeading = tangentHeadingForNormal(MOON_RAY_CRATER_NORMAL);
  footNormal.copy(stepWorldNormal(MOON_RAY_CRATER_NORMAL, moonQaHeading, 10.8, MOON_RADIUS));
  footHeading.copy(MOON_RAY_CRATER_NORMAL)
    .addScaledVector(footNormal, -MOON_RAY_CRATER_NORMAL.dot(footNormal))
    .normalize();
  footRoot.position.copy(surfacePositionForWorld('moon', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
}
if (performanceQuery.has('mine-train-qa')) {
  currentWorld = 'mars';
  travelMode = 'walking';
  footNormal.copy(stepWorldNormal(NIGHTFALL_CAVE.normal, CAVE_INWARD_HEADING, -7.2, PLANET_RADIUS));
  footHeading.copy(CAVE_INWARD_HEADING);
  footRoot.position.copy(surfacePositionForWorld('mars', footNormal, 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
  footRoot.visible = true;
  lookingAtCamera = false;
  if (performanceQuery.has('qa-ride')) {
    boardNightfallMineTrain(false);
    if (performanceQuery.has('qa-train-end')) {
      caveRouteDistance = CAVE_ROUTE_LENGTH - 1.2;
      sampleCaveRoute(caveRouteDistance);
      hubRuntime.nightfall.mineTrain.update({ distance: caveRouteDistance, direction: 1, speed: 0, dt: 0, time: 0 });
    }
    keys.w = true;
  }
}
if (vehicleQaId) {
  const qaVehicle = vehicleRuntimes.find((runtime) => runtime.id === vehicleQaId);
  if (qaVehicle) {
    boardVehicle(qaVehicle);
    if (performanceQuery.has('cave-entry-qa')) {
      playerNormal.copy(stepWorldNormal(NIGHTFALL_CAVE.normal, CAVE_INWARD_HEADING, -7.2, PLANET_RADIUS));
      playerHeading.copy(CAVE_INWARD_HEADING);
      alien.position.copy(surfaceWorldPosition(playerNormal));
      alien.quaternion.copy(surfaceVehicleQuaternion(playerNormal, playerHeading));
      garageDepartureCamera = false;
      lookingAtCamera = false;
    }
    const courseQaId = performanceQuery.get('course-qa');
    const courseQa = courseQaId ? drivingCourses.courses.find((course) => course.id === courseQaId) : null;
    if (courseQa) {
      const courseZone = performanceQuery.get('course-zone');
      const start = courseZone === 'boost'
        ? courseQa.boostZones[0]
        : courseZone === 'ramp' ? courseQa.rampZones[0] : courseQa.checkpoints[0];
      playerNormal.copy(start.normal);
      playerHeading.copy(start.tangent)
        .addScaledVector(playerNormal, -start.tangent.dot(playerNormal))
        .normalize();
      alien.position.copy(surfaceWorldPosition(playerNormal));
      alien.quaternion.copy(surfaceVehicleQuaternion(playerNormal, playerHeading));
      garageDepartureCamera = false;
      lookingAtCamera = false;
    }
    if (performanceQuery.has('qa-drive')) keys.w = true;
    if (performanceQuery.has('qa-thrust')) {
      keys[' '] = true;
      jumpQueued = true;
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  if (document.hidden) return;
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  updateAdaptiveResolution(rawDt);
  updateDetailStreaming(dt);

  const throttleInput = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
  const steeringInput = (keys['a'] || keys['arrowleft'] ? 1 : 0) - (keys['d'] || keys['arrowright'] ? 1 : 0);
  const thrusterHeld = Boolean(keys[' '] || keys.space || keys.spacebar);
  handleInteraction();
  updateShuttleFlight(dt, t);
  updateHyperBikeTravel(dt, t);

  if (travelMode === 'mine-train') {
    jumpQueued = false;
    updateThrusterAudio(false, false, 0);
    updateNightfallMineTrain(dt, t, throttleInput);
  } else if (travelMode === 'cave-walking') {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    updateRoverAudio(0, 0);
    updateCaveWalking(dt, t, throttleInput, steeringInput);
  } else if (travelMode === 'driving' && activeVehicle && activeProfile) {
    const caveSpeedLimit = caveTravelZone === 'surface'
      ? activeProfile.maxForwardSpeed
      : Math.min(CAVE_TUNNEL_MAX_SPEED, activeProfile.caveMaxSpeed);
    const targetSpeed = throttleInput > 0
      ? caveSpeedLimit
      : throttleInput < 0 ? -Math.min(activeProfile.maxReverseSpeed, caveSpeedLimit * 0.72) : 0;
    const acceleration = throttleInput === 0
      ? activeProfile.coastDrag
      : driveSpeed * throttleInput < 0 ? activeProfile.braking : activeProfile.acceleration;
    driveSpeed = THREE.MathUtils.damp(driveSpeed, targetSpeed, acceleration, dt);
    if (Math.abs(driveSpeed) < 0.015) driveSpeed = 0;
    updateRoverAudio(driveSpeed, throttleInput);

    const steerStrength = THREE.MathUtils.clamp(
      Math.abs(driveSpeed) / activeProfile.fullSteerSpeed,
      activeProfile.stationarySteering,
      1
    );
    const reverseSteer = driveSpeed < -0.1 ? -1 : 1;

    if (caveTravelZone === 'surface') {
      playerHeading.applyAxisAngle(
        playerNormal,
        steeringInput * reverseSteer * activeProfile.turnRate * steerStrength * dt
      ).normalize();
      forwardVec.copy(playerHeading);
      rightVec.copy(playerHeading).cross(playerNormal).normalize();
      if (activeProfile.locomotion === 'hover-drift') {
        const lateralTarget = -steeringInput * Math.abs(driveSpeed) * 0.24;
        vehicleLateralSpeed = THREE.MathUtils.damp(vehicleLateralSpeed, lateralTarget, steeringInput ? 2.2 : 1.35, dt);
      } else vehicleLateralSpeed = THREE.MathUtils.damp(vehicleLateralSpeed, 0, 8, dt);
      vehicleMotionDirection.copy(forwardVec).multiplyScalar(driveSpeed);
      vehicleMotionDirection.addScaledVector(rightVec, vehicleLateralSpeed);
      const surfaceSpeed = vehicleMotionDirection.length();
      if (surfaceSpeed > 0.0001) vehicleMotionDirection.multiplyScalar(1 / surfaceSpeed);
      else vehicleMotionDirection.copy(forwardVec);
      const motionDistance = surfaceSpeed * dt;
      travelAxis.crossVectors(playerNormal, vehicleMotionDirection).normalize();
      candidateVehicleNormal.copy(playerNormal).applyAxisAngle(travelAxis, motionDistance / PLANET_RADIUS).normalize();
      candidateVehicleHeading.copy(playerHeading).applyAxisAngle(travelAxis, motionDistance / PLANET_RADIUS).normalize();
      const blocked = isActiveVehiclePathBlocked(candidateVehicleNormal);
      if (!blocked) {
        playerNormal.copy(candidateVehicleNormal);
        playerHeading.copy(candidateVehicleHeading)
          .addScaledVector(playerNormal, -candidateVehicleHeading.dot(playerNormal))
          .normalize();
      } else {
        driveSpeed *= -activeProfile.collisionBounce;
        vehicleLateralSpeed *= -0.18;
      }
      if (garageDepartureCamera && arcDistanceForWorld('mars', playerNormal, GARAGE_NORMAL) > 15.5) {
        garageDepartureCamera = false;
        lookingAtCamera = false;
      }
    } else {
      updateCaveNavigation(dt, steeringInput);
    }

    updateDrivingCourseGameplay(dt, t);

    if (jumpQueued && grounded) {
      verticalVelocity = activeProfile.lift.initialRise;
      grounded = false;
      roverThrusterFuel = activeProfile.lift.fuel;
      roverLiftSpool = Math.max(roverLiftSpool, 0.18);
      showBanner(`${activeVehicle.label} THRUSTERS SPOOLING · RELEASE TO DROP`);
    }
    jumpQueued = false;
    const roverThrusterRequested = !grounded && thrusterHeld && roverThrusterFuel > 0;
    roverLiftSpool = THREE.MathUtils.clamp(
      roverLiftSpool + (roverThrusterRequested ? activeProfile.lift.spoolUp : -activeProfile.lift.spoolDown) * dt,
      0,
      1
    );
    const roverThrusterActive = roverThrusterRequested && roverLiftSpool > 0.015;
    const roverThrusterPulse = roverThrusterActive
      ? (Math.sin(t * 29.5) > -0.12 ? 1 : 0.14) * (Math.sin(t * 67) > 0.25 ? 1 : 0.74)
      : 0;
    if (roverThrusterWasActive && !roverThrusterRequested && !grounded) {
      verticalVelocity = Math.min(verticalVelocity, activeProfile.lift.dropSpeed);
      if (jumpHeight > 0.9) showBanner('THRUST CUT · HARD DROP');
    }
    roverThrusterWasActive = roverThrusterRequested;
    if (activeVehicle.thrusterVisual) activeVehicle.thrusterVisual.visible = roverLiftSpool > 0.025;
    if (roverThrusterActive) {
      roverThrusterFuel = Math.max(0, roverThrusterFuel - dt);
      const hoverError = THREE.MathUtils.clamp(
        (activeProfile.lift.targetHeight - jumpHeight) / activeProfile.lift.targetHeight,
        -0.65,
        1
      );
      const liftCommand = THREE.MathUtils.clamp(0.18 + hoverError * 0.72 - verticalVelocity * 0.07, 0, 1);
      const groundEffect = 1 + Math.max(0, 1 - jumpHeight / 5) * 0.28;
      const fanTurbulence = Math.sin(t * 41) * 0.25 + Math.sin(t * 73) * 0.14;
      const pulseEfficiency = 0.78 + roverThrusterPulse * 0.22;
      const liftAcceleration = activeProfile.lift.acceleration * liftCommand * groundEffect * roverLiftSpool * pulseEfficiency + fanTurbulence;
      verticalVelocity = Math.min(activeProfile.lift.maxRise, verticalVelocity + liftAcceleration * dt);
      if (jumpHeight < 6 && caveTravelZone === 'surface') spawnWheelDust(dt * 1.8, 8 + roverThrusterPulse * 6);
    }
    updateThrusterAudio(roverLiftSpool > 0.015, true, roverThrusterPulse * roverLiftSpool);
    if (!grounded) {
      verticalVelocity += marsGravity * dt;
      jumpHeight += verticalVelocity * dt;
      if (jumpHeight <= 0) {
        jumpHeight = 0;
        verticalVelocity = 0;
        grounded = true;
        roverThrusterWasActive = false;
        roverLiftSpool = 0;
        if (activeVehicle.thrusterVisual) activeVehicle.thrusterVisual.visible = false;
        activeVehicle.chassis.position.y = activeVehicle.chassisBaseY || 0;
      }
    } else {
      roverThrusterFuel = Math.min(activeProfile.lift.fuel, roverThrusterFuel + dt * 1.7);
    }

    terrainSampleAccumulator += dt;
    const terrainSampleInterval = 1 / activeProfile.terrainHz;
    if (caveTravelZone !== 'surface') {
      cachedFrontHeight = cachedRearHeight = cachedRightHeight = cachedLeftHeight = 0;
    } else if (terrainSampleAccumulator >= terrainSampleInterval) {
      terrainSampleAccumulator %= terrainSampleInterval;
      cachedFrontHeight = getSurfaceHeight(stepSurfaceNormalInto(
        terrainSampleNormal,
        playerNormal,
        playerHeading,
        activeProfile.halfWheelbase
      ));
      cachedRearHeight = getSurfaceHeight(stepSurfaceNormalInto(
        terrainSampleNormal,
        playerNormal,
        playerHeading,
        -activeProfile.halfWheelbase
      ));
      cachedRightHeight = getSurfaceHeight(stepSurfaceNormalInto(
        terrainSampleNormal,
        playerNormal,
        rightVec,
        activeProfile.halfTrack
      ));
      cachedLeftHeight = getSurfaceHeight(stepSurfaceNormalInto(
        terrainSampleNormal,
        playerNormal,
        rightVec,
        -activeProfile.halfTrack
      ));
    }
    const targetPitch = grounded
      ? Math.atan2(cachedFrontHeight - cachedRearHeight, activeProfile.halfWheelbase * 2)
      : -verticalVelocity * 0.018 + (roverThrusterActive ? Math.sin(t * 57) * 0.012 : 0);
    const targetRoll = grounded
      ? Math.atan2(cachedRightHeight - cachedLeftHeight, activeProfile.halfTrack * 2)
        - steeringInput * driveSpeed * (activeProfile.locomotion === 'hover-drift' ? 0.008 : 0.0045)
      : roverThrusterActive ? Math.sin(t * 48) * 0.034 + Math.sin(t * 21) * 0.012 : 0;
    activeVehicle.chassis.rotation.x = THREE.MathUtils.damp(activeVehicle.chassis.rotation.x, targetPitch, 7, dt);
    activeVehicle.chassis.rotation.z = THREE.MathUtils.damp(activeVehicle.chassis.rotation.z, targetRoll, 7, dt);

    suspensionPhase += Math.abs(driveSpeed) * dt * 1.8;
    const roadBuzz = grounded ? Math.sin(suspensionPhase) * Math.min(0.055, Math.abs(driveSpeed) * 0.004) : 0;
    const fanBuzz = roverLiftSpool > 0.015
      ? (Math.sin(t * 55) * 0.025 + Math.sin(t * 91) * 0.012) * roverLiftSpool
      : 0;
    const chassisBaseY = activeVehicle.chassisBaseY || 0;
    activeVehicle.chassis.position.y = THREE.MathUtils.damp(
      activeVehicle.chassis.position.y,
      chassisBaseY + roadBuzz + fanBuzz,
      grounded ? 9 : 8,
      dt
    );

    if (caveTravelZone === 'surface') {
      rightVec.copy(playerHeading).cross(playerNormal).normalize();
      backVec.copy(playerHeading).multiplyScalar(-1);
      orientationMatrix.makeBasis(rightVec, playerNormal, backVec);
      targetRoverQuaternion.setFromRotationMatrix(orientationMatrix);
      alien.quaternion.slerp(targetRoverQuaternion, 1 - Math.exp(-dt * 12));
      alien.position.copy(playerNormal).multiplyScalar(PLANET_RADIUS + getSurfaceHeight(playerNormal) + jumpHeight);
    } else placeCaveRover(dt);

    activeVehicleTravelDistance += driveSpeed * dt;
    activeVehicle.motionDistance = activeVehicleTravelDistance;
    vehicleVisualAccumulator += dt;
    const visualInterval = activeVehicle.id === 'dustcrawler' ? 1 / (isTouchDevice ? 20 : 30) : 0;
    if (vehicleVisualAccumulator >= visualInterval) {
      vehicleVisualAccumulator = visualInterval ? vehicleVisualAccumulator % visualInterval : 0;
      activeVehicle.updateMotion?.({
        distance: activeVehicleTravelDistance,
        steering: steeringInput,
        speed: driveSpeed,
        thrust: roverLiftSpool * (0.45 + roverThrusterPulse * 0.55),
        time: t,
      });
    }
    arms.forEach((arm, index) => {
      arm.upper.rotation.x = 1.12 + Math.sin(t * 2.2 + index) * Math.min(0.08, Math.abs(driveSpeed) * 0.006);
      arm.fore.rotation.x = 0.34 + steeringInput * (index === 0 ? -0.2 : 0.2);
    });
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.018;
    alienDriver.alien.rotation.z = Math.sin(t * 0.72) * 0.018 - steeringInput * 0.018;
    if (caveTravelZone === 'surface' && grounded && Math.abs(driveSpeed) > 1.4) {
      spawnWheelDust(dt * activeProfile.dustScale, driveSpeed);
    }
  } else if (travelMode === 'boating') {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    jumpQueued = false;
    updateThrusterAudio(false, false, 0);
    alienDriver.thrusterFlames.visible = false;
    updateOasisBoat(dt, t, throttleInput, steeringInput);
  } else if (travelMode === 'walking') {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    updateRoverAudio(0, 0);
    updateOnFoot(dt, t, throttleInput, steeringInput);
  } else {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    updateRoverAudio(0, 0);
    jumpQueued = false;
    updateThrusterAudio(false, false, 0);
    if (activeVehicle?.thrusterVisual) activeVehicle.thrusterVisual.visible = false;
    alienDriver.thrusterFlames.visible = false;
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.012;
  }

  if (worldDetailResidency.mars) updateWheelDust(dt);
  if (worldDetailResidency.moon) updateMoonFootDust(dt);

  const activeMarsNormal = travelMode === 'driving' && caveTravelZone === 'surface'
    ? playerNormal
    : travelMode === 'boating'
      ? oasisLake.boat.normal
      : travelMode === 'walking' && currentWorld === 'mars' ? footNormal : null;
  const activeMarsAltitude = travelMode === 'driving' ? jumpHeight : travelMode === 'walking' && currentWorld === 'mars' ? footJumpHeight : 0;
  const activeMoonNormal = travelMode === 'walking' && currentWorld === 'moon' ? footNormal : null;
  const activeZephyraNormal = travelMode === 'walking' && currentWorld === 'zephyra' ? footNormal : null;
  const xenobiologyGlobe = hubRuntime.planetarium;
  const xenobiologyDetailDistance = activeMarsNormal
    ? geodesicDistance(activeMarsNormal, xenobiologyTrailHub.normal)
    : Infinity;
  const xenobiologyDetailDistanceLimit = (xenobiologyGlobe.detailGroup.visible ? 68 : 56)
    * qualitySettings.lodDistanceScale;
  const xenobiologyDetailShouldRender = worldDetailStreamingDisabled
    || (marsHubDetailStreaming.planetarium.resident
      && xenobiologyDetailDistance < xenobiologyDetailDistanceLimit);
  if (xenobiologyGlobe.detailGroup.visible !== xenobiologyDetailShouldRender) {
    xenobiologyGlobe.detailGroup.visible = xenobiologyDetailShouldRender;
  }
  const xenobiologyInteriorCullDistance = xenobiologyInteriorCullActive ? 27 : 23;
  updateXenobiologyInteriorCulling(Boolean(
    !worldDetailStreamingDisabled
    && xenobiologyDetailShouldRender
    && xenobiologyDetailDistance < xenobiologyInteriorCullDistance
  ));
  const caveSurfaceDistance = activeMarsNormal ? geodesicDistance(activeMarsNormal, NIGHTFALL_CAVE.normal) : Infinity;
  const caveShouldRender = caveTravelZone !== 'surface' || caveSurfaceDistance < 56;
  if (hubRuntime.nightfall.group.visible !== caveShouldRender) hubRuntime.nightfall.group.visible = caveShouldRender;
  const caveInteriorShouldRender = caveTravelZone !== 'surface';
  if (hubRuntime.nightfall.interior.visible !== caveInteriorShouldRender) {
    hubRuntime.nightfall.interior.visible = caveInteriorShouldRender;
  }
  const caveFacadeShouldRender = caveTravelZone === 'surface'
    || (caveTravelZone === 'tunnel' && caveRouteDistance < 15);
  hubRuntime.nightfall.surfaceFacade.visible = caveFacadeShouldRender;
  hubRuntime.nightfall.portalVoid.visible = caveTravelZone === 'surface';
  updateLunarLighting(dt, t);
  environmentUpdateAccumulator += dt;
  if (environmentUpdateAccumulator >= environmentUpdateInterval) {
    const environmentDt = Math.min(environmentUpdateAccumulator, 0.12);
    environmentUpdateAccumulator %= environmentUpdateInterval;
    if (worldDetailResidency.mars) {
      updateMarsDustFront(environmentDt, t, activeMarsNormal);
      updateMarsSedimentaryEscarpment(environmentDt, t, activeMarsNormal);
      updateMarsYardangField(environmentDt, t, activeMarsNormal);
      updateMarsImpactBasin(environmentDt, t, activeMarsNormal);
      updateOasisLake(environmentDt, t);
    }
    if (worldDetailResidency.moon) {
      updateMoonCommandCenter(environmentDt, t, activeMoonNormal);
      updateMoonColdTrap(environmentDt, t, activeMoonNormal);
      updateMoonRayedCrater(environmentDt, t, activeMoonNormal);
    }
    // Lumi's autonomous decision loop intentionally continues off-world.
    updateMoonFriend(environmentDt, t, activeMoonNormal);
    if (worldDetailResidency.zephyra) {
      updateZephyraStorm(environmentDt, t, activeZephyraNormal);
      updateZephyraIonCanyon(environmentDt, t, activeZephyraNormal);
      updateZephyraFluxWell(environmentDt, t, activeZephyraNormal);
      updateZephyraAuroralSquall(environmentDt, t, activeZephyraNormal);
      updateZephyraPiezoelectricGrove(environmentDt, t, activeZephyraNormal);
    }
    updateNightfallWorld(environmentDt, t);
  }
  updateCaveAtmosphere(dt, activeMarsNormal, activeMarsAltitude);
  applyGlobalLighting();

  if (activeMarsNormal) for (const hub of HUBS) {
    if (!hub.discovered && geodesicDistance(activeMarsNormal, hub.normal) < hub.trigger) {
      discoverHub(hub);
    }
  }

  const downedUfo = hubRuntime.outpost;
  if (worldDetailResidency.mars) {
    if (marsHubDetailStreaming.outpost.resident) {
    downedUfo.rimLights.forEach((light, index) => {
    const flicker = light.damaged
      ? (Math.sin(t * (17 + index)) > 0.58 ? 1 : 0.03)
      : 0.72 + Math.sin(t * 2.4 + light.phase) * 0.28;
    light.material.emissiveIntensity = 0.12 + flicker * 1.85;
    });
    downedUfo.interiorLight.intensity = 2.5 + Math.sin(t * 12.7) * 0.85 + Math.sin(t * 31) * 0.28;
    downedUfo.breachGlow.material.opacity = 0.54 + Math.sin(t * 8.4) * 0.18;
    downedUfo.archiveLight.intensity = 3.3 + Math.sin(t * 2.4) * 0.6;
    downedUfo.glassCanopy.material.emissiveIntensity = 0.32 + Math.sin(t * 0.85) * 0.08;
    downedUfo.canopyCrown.rotation.y += dt * 0.14;
    downedUfo.projectScreens.forEach((screen, index) => {
      const pulse = 0.82 + Math.sin(t * 3.2 + index * 1.3) * 0.18;
      screen.statusLight.scale.setScalar(pulse);
      screen.statusLight.material.opacity = pulse;
    });
    const ufoSmokePositions = downedUfo.smoke.geometry.attributes.position;
    for (let i = 0; i < downedUfo.smokeSpeeds.length; i++) {
      const baseIndex = i * 3;
      ufoSmokePositions.array[baseIndex] += dt * 0.055;
      ufoSmokePositions.array[baseIndex + 1] += dt * downedUfo.smokeSpeeds[i];
      if (ufoSmokePositions.array[baseIndex + 1] - downedUfo.smokeBases[baseIndex + 1] > 4.8) {
        ufoSmokePositions.array[baseIndex] = downedUfo.smokeBases[baseIndex];
        ufoSmokePositions.array[baseIndex + 1] = downedUfo.smokeBases[baseIndex + 1];
        ufoSmokePositions.array[baseIndex + 2] = downedUfo.smokeBases[baseIndex + 2];
      }
    }
    ufoSmokePositions.needsUpdate = true;
    downedUfo.sparks.forEach((spark, index) => {
      const sparkAge = (t * (0.78 + index * 0.035) + spark.phase) % 1;
      const burst = Math.max(0, Math.sin(t * 10.5 + spark.phase));
      spark.mesh.visible = burst > 0.43;
      spark.mesh.position.set(
        4.72 + Math.sin(spark.phase) * spark.radius * sparkAge,
        1.38 + sparkAge * 2.45,
        Math.cos(spark.phase) * spark.radius * sparkAge
      );
      spark.mesh.scale.setScalar(0.45 + burst * 1.35);
    });
    }

    const cavern = hubRuntime.cavern;
    if (marsHubDetailStreaming.cavern.resident) {
    cavern.crystalMaterials.forEach((mat, i) => {
      mat.emissiveIntensity = 0.5 + Math.sin(t * 1.5 + i) * 0.15;
    });
    }

    if (marsHubDetailStreaming.planetarium.resident) {
    if (xenobiologyGlobe.detailGroup.visible) {
    xenobiologyGlobe.creatureRuntimes.forEach((creature, index) => {
      const creaturePulse = t * (creature.type === 'jelly' || creature.type === 'butterfly' ? 1.8 : 2.7) + creature.phase;
      const hopAmount = creature.type === 'bunny' ? Math.max(0, Math.sin(creaturePulse)) * 0.16 : 0;
      creature.group.position.y = creature.baseY
        + Math.sin(creaturePulse) * (creature.type === 'jelly' || creature.type === 'butterfly' ? 0.22 : 0.045)
        + hopAmount;
      creature.group.rotation.y += dt * (
        creature.type === 'snail' ? 0.08
          : creature.type === 'snake' || creature.type === 'tiger' ? 0.13
            : creature.type === 'butterfly' ? 0.11
              : 0.19 + index * 0.015
      );
      if (creature.lowDetail?.proxy.visible) return;
      creature.body.scale.y = creature.bodyBaseScaleY * (1 + Math.sin(creaturePulse * 1.35) * 0.018);
      creature.wings.forEach((wing) => {
        wing.mesh.rotation.z = wing.side * (0.42 + Math.sin(t * 18 + creature.phase) * 0.22);
      });
      creature.segments.forEach((segment) => {
        segment.mesh.position.x = segment.baseX + Math.sin(t * 3.2 + segment.index * 0.86 + creature.phase) * 0.11;
        segment.mesh.position.y = segment.baseY + Math.cos(t * 2.7 + segment.index * 0.68 + creature.phase) * 0.035;
      });
      creature.ears.forEach((ear) => {
        ear.mesh.rotation.z = ear.baseRotation + ear.side * Math.sin(t * 2.4 + creature.phase) * 0.055;
      });
      creature.tailSegments.forEach((segment) => {
        segment.mesh.position.x = segment.baseX + Math.sin(t * 3 + segment.index * 0.54 + creature.phase) * (0.035 + segment.index * 0.012);
        segment.mesh.position.y = segment.baseY + Math.cos(t * 2.5 + segment.index * 0.4 + creature.phase) * 0.025;
      });
    });
    const museumMonkey = xenobiologyGlobe.museumMonkey;
    let monkeyMoving = false;
    if (museumMonkey.pause > 0) {
      museumMonkey.pause = Math.max(0, museumMonkey.pause - dt);
    } else {
      const monkeyTarget = museumMonkey.waypoints[museumMonkey.waypointIndex];
      museumMonkey.toWaypoint.copy(monkeyTarget).sub(museumMonkey.root.position);
      museumMonkey.toWaypoint.y = 0;
      const monkeyDistance = museumMonkey.toWaypoint.length();
      if (monkeyDistance < 0.34) {
        museumMonkey.waypointIndex = (museumMonkey.waypointIndex + 1) % museumMonkey.waypoints.length;
        museumMonkey.pause = 0.8 + Math.abs(Math.sin(t * 0.73 + museumMonkey.phase)) * 2.2;
      } else {
        monkeyMoving = true;
        museumMonkey.toWaypoint.multiplyScalar(1 / monkeyDistance);
        museumMonkey.root.position.addScaledVector(museumMonkey.toWaypoint, museumMonkey.speed * dt);
        const monkeyYaw = Math.atan2(-museumMonkey.toWaypoint.x, -museumMonkey.toWaypoint.z);
        museumMonkey.root.rotation.y = THREE.MathUtils.damp(museumMonkey.root.rotation.y, monkeyYaw, 5.5, dt);
      }
    }
    const monkeyStride = monkeyMoving ? Math.sin(t * 7.2 + museumMonkey.phase) : 0;
    museumMonkey.root.position.y = 0.7 + Math.abs(monkeyStride) * 0.035;
    if (!museumMonkey.lowDetail?.proxy.visible) {
    museumMonkey.arms.forEach((arm) => {
      arm.pivot.rotation.x = THREE.MathUtils.damp(arm.pivot.rotation.x, monkeyStride * arm.side * 0.62, 9, dt);
    });
    museumMonkey.legs.forEach((leg) => {
      leg.pivot.rotation.x = THREE.MathUtils.damp(leg.pivot.rotation.x, monkeyStride * leg.side * -0.58, 10, dt);
    });
    museumMonkey.head.rotation.y = Math.sin(t * 0.82 + museumMonkey.phase) * 0.18;
    museumMonkey.head.rotation.z = Math.sin(t * 1.17 + museumMonkey.phase) * 0.045;
    museumMonkey.torso.rotation.z = monkeyMoving ? -monkeyStride * 0.025 : Math.sin(t * 0.9) * 0.012;
    museumMonkey.tailSegments.forEach((segment) => {
      segment.position.x = segment.baseX
        + Math.sin(t * 2.8 + segment.index * 0.55 + museumMonkey.phase) * (0.04 + segment.index * 0.018);
      segment.position.y = segment.baseY
        + Math.cos(t * 2.25 + segment.index * 0.42 + museumMonkey.phase) * (0.018 + segment.index * 0.006);
      museumMonkey.tailDummy.position.copy(segment.position);
      museumMonkey.tailDummy.scale.setScalar(segment.radius);
      museumMonkey.tailDummy.updateMatrix();
      segment.instanceMesh.setMatrixAt(segment.instanceIndex, museumMonkey.tailDummy.matrix);
    });
    museumMonkey.tailMeshes.forEach((instances) => { instances.instanceMatrix.needsUpdate = true; });
    }

    xenobiologyGlobe.aquariumWallFishRuntimes.forEach((fishRuntime) => {
      const swimPhase = t * fishRuntime.speed + fishRuntime.phase;
      const wallAngle = fishRuntime.baseAngle + Math.sin(swimPhase) * fishRuntime.sweep;
      const swimDirection = Math.cos(swimPhase) >= 0 ? 1 : -1;
      fishRuntime.fish.position.set(
        Math.sin(wallAngle) * fishRuntime.radius,
        fishRuntime.baseY + Math.sin(t * 1.35 + fishRuntime.phase) * 0.34,
        Math.cos(wallAngle) * fishRuntime.radius
      );
      fishRuntime.fish.rotation.y = wallAngle + (swimDirection < 0 ? Math.PI : 0);
      fishRuntime.fish.rotation.z = -swimDirection * Math.cos(swimPhase) * 0.055;
      if (!fishRuntime.lowDetail?.proxy.visible) {
        fishRuntime.tail.rotation.x = Math.sin(t * 7.2 + fishRuntime.phase) * 0.3;
      }
    });
    if (xenobiologyGlobe.aquariumWallBubbles.visible) {
      xenobiologyGlobe.aquariumWallBubbles.rotation.y = Math.sin(t * 0.18) * 0.028;
    }
    xenobiologyGlobe.aquariumWallBubbleMaterial.opacity = 0.63 + Math.sin(t * 1.2) * 0.08;
    xenobiologyGlobe.aquariumWallWaterMaterial.emissiveIntensity = 0.54 + Math.sin(t * 0.56) * 0.07;

    xenobiologyGlobe.fishRuntimes.forEach((fishRuntime) => {
      const swimPhase = t * fishRuntime.speed + fishRuntime.phase;
      const swimDirection = Math.cos(swimPhase) * fishRuntime.speed;
      fishRuntime.fish.position.x = Math.sin(swimPhase) * fishRuntime.range;
      fishRuntime.fish.position.y = fishRuntime.baseY + Math.sin(t * 1.7 + fishRuntime.phase) * 0.28;
      fishRuntime.fish.position.z = fishRuntime.baseZ + Math.cos(swimPhase * 0.7) * 0.34;
      fishRuntime.fish.rotation.y = swimDirection >= 0 ? 0 : Math.PI;
      fishRuntime.fish.rotation.z = Math.sin(t * 2.1 + fishRuntime.phase) * 0.06;
      if (!fishRuntime.lowDetail?.proxy.visible) {
        fishRuntime.tail.rotation.x = Math.sin(t * 7.5 + fishRuntime.phase) * 0.26;
      }
    });
    const aquariumSquid = xenobiologyGlobe.aquariumSquid;
    const squidSwimPhase = t * 0.42 + aquariumSquid.phase;
    aquariumSquid.root.position.x = Math.sin(squidSwimPhase) * 4.6;
    aquariumSquid.root.position.y = aquariumSquid.baseY + Math.sin(t * 0.9 + aquariumSquid.phase) * 0.46;
    aquariumSquid.root.position.z = 0.62 + Math.cos(squidSwimPhase * 1.3) * 0.24;
    aquariumSquid.root.rotation.y = Math.sin(squidSwimPhase * 0.7) * 0.28;
    aquariumSquid.root.rotation.z = Math.sin(t * 0.66 + aquariumSquid.phase) * 0.08;
    if (!aquariumSquid.lowDetail?.proxy.visible) {
    aquariumSquid.mantle.scale.y = 1.5 * (1 + Math.sin(t * 2.2 + aquariumSquid.phase) * 0.075);
    aquariumSquid.fins.forEach((fin, finIndex) => {
      fin.rotation.y = Math.sin(t * 2.6 + finIndex * Math.PI + aquariumSquid.phase) * 0.24;
    });
    aquariumSquid.tentacleSegments.forEach((segment) => {
      const wave = Math.sin(
        t * 3.15
        + segment.tentacleIndex * 0.83
        - segment.segmentIndex * 0.72
        + aquariumSquid.phase
      );
      const tentacleAngle = segment.angle + wave * (0.08 + segment.segmentIndex * 0.022);
      const radius = segment.baseRadius + wave * (0.035 + segment.segmentIndex * 0.018);
      segment.position.x = Math.cos(tentacleAngle) * radius;
      segment.position.z = Math.sin(tentacleAngle) * radius;
      segment.position.y = segment.baseY + Math.cos(t * 2.6 + segment.segmentIndex * 0.62 + segment.tentacleIndex) * 0.075;
      aquariumSquid.tentacleDummy.position.copy(segment.position);
      aquariumSquid.tentacleDummy.scale.setScalar(segment.radius);
      aquariumSquid.tentacleDummy.updateMatrix();
      segment.instanceMesh.setMatrixAt(segment.instanceIndex, aquariumSquid.tentacleDummy.matrix);
    });
    aquariumSquid.tentacleMeshes.forEach((instances) => { instances.instanceMatrix.needsUpdate = true; });
    }
    xenobiologyGlobe.aquariumWater.rotation.y = Math.sin(t * 0.3) * 0.006;
    if (xenobiologyGlobe.aquariumBubbles.visible) {
      xenobiologyGlobe.aquariumBubbles.rotation.y = Math.sin(t * 0.22) * 0.045;
    }
    xenobiologyGlobe.bubbleMaterial.opacity = 0.62 + Math.sin(t * 1.45) * 0.1;
    if (xenobiologyGlobe.bioMotes.visible) xenobiologyGlobe.bioMotes.rotation.y += dt * 0.018;
    xenobiologyGlobe.moteMaterial.opacity = 0.48 + Math.sin(t * 0.9) * 0.09;
    xenobiologyGlobe.cyanLight.intensity = 4.1 + Math.sin(t * 1.2) * 0.5;
    xenobiologyGlobe.violetLight.intensity = 3.5 + Math.cos(t * 1.05) * 0.45;
    }
    xenobiologyGlobe.globeMaterial.emissiveIntensity = 0.34 + Math.sin(t * 0.72) * 0.07;
    }

    const crash = hubRuntime.crash;
    if (marsHubDetailStreaming.crash.resident) {
    crash.light.intensity = 2.2 + Math.sin(t * 13) * 0.4 + (Math.random() - 0.5) * 0.3;
    const crashSignal = Math.sin(t * 4.8) > 0.28 ? 1 : 0.06;
    crash.beaconMaterial.emissiveIntensity = 0.15 + crashSignal * 3.2;
    crash.telemetryMaterial.emissiveIntensity = 0.28 + crashSignal * 1.7 + Math.max(0, Math.sin(t * 17.5)) * 0.35;
    crash.solarCellMaterial.emissiveIntensity = 0.22 + Math.sin(t * 0.72) * 0.08;
    const sp = crash.smoke.geometry.attributes.position;
    for (let i = 0; i < crash.smokeSpeeds.length; i++) {
      const idx = i * 3 + 1;
      sp.array[idx] += dt * crash.smokeSpeeds[i];
      if (sp.array[idx] - crash.smokeBases[idx] > 6) sp.array[idx] = crash.smokeBases[idx];
    }
    sp.needsUpdate = true;
    }

    airborneDust.rotation.y += dt * 0.014;
    airborneDust.rotation.z += dt * 0.003;
    updateAeolianSaltation(t);
    marsLandingPad.glowMaterial.emissiveIntensity = 1.05 + Math.sin(t * 2.2) * 0.32;

    dustDevils.forEach((devil) => {
      const positions = devil.points.geometry.attributes.position;
      devil.seeds.forEach((seed, index) => {
        seed.angle += dt * seed.speed;
        seed.y += dt * (0.55 + seed.speed * 0.2);
        if (seed.y > 9) seed.y = 0;
        const radius = 0.25 + seed.y * 0.09 + seed.radius * 0.3;
        positions.array[index * 3] = Math.cos(seed.angle + t * 0.6 + devil.phase) * radius;
        positions.array[index * 3 + 1] = seed.y;
        positions.array[index * 3 + 2] = Math.sin(seed.angle + t * 0.6 + devil.phase) * radius;
      });
      positions.needsUpdate = true;
    });
  }
  if (worldDetailResidency.moon) {
    moonLandingPad.glowMaterial.emissiveIntensity = 0.9 + Math.sin(t * 1.7 + 1.3) * 0.26;
    moonBikeLandingPad.glowMaterial.emissiveIntensity = 1.15 + Math.sin(t * 3.1) * 0.38;
  }
  if (worldDetailResidency.zephyra) {
    zephyraBikeLandingPad.glowMaterial.emissiveIntensity = 1.1 + Math.sin(t * 2.8 + 1.2) * 0.34;
  }

  sunMaterial.uniforms.uTime.value = t;
  distortedSun.lookAt(camera.position);
  updateShootingStar(t);

  let desiredCameraUp;
  if (travelMode === 'mine-train') {
    const trainRoot = hubRuntime.nightfall.mineTrain.train;
    trainRoot.updateWorldMatrix(true, false);
    trainRoot.getWorldPosition(mineTrainCameraPosition);
    mineTrainCameraForward.set(0, 0, -1).transformDirection(trainRoot.matrixWorld).normalize();
    mineTrainCameraUp.set(0, 1, 0).transformDirection(trainRoot.matrixWorld).normalize();
    const cameraTrail = lookingAtCamera ? 8.5 : -10.8;
    desiredCamPos.copy(mineTrainCameraPosition)
      .addScaledVector(mineTrainCameraUp, 5.2)
      .addScaledVector(mineTrainCameraForward, cameraTrail);
    desiredTarget.copy(mineTrainCameraPosition)
      .addScaledVector(mineTrainCameraUp, 1.65)
      .addScaledVector(mineTrainCameraForward, lookingAtCamera ? -1.2 : 4.2);
    desiredCameraUp = mineTrainCameraUp;
  } else if (travelMode === 'cave-walking') {
    desiredCamPos.copy(footRoot.position)
      .addScaledVector(caveFootWorldUp, lookingAtCamera ? 4.4 : 5.2)
      .addScaledVector(caveFootWorldForward, lookingAtCamera ? 6.8 : -8.4);
    desiredTarget.copy(footRoot.position)
      .addScaledVector(caveFootWorldUp, 1.85)
      .addScaledVector(caveFootWorldForward, lookingAtCamera ? -0.4 : 3.2);
    desiredCameraUp = caveFootWorldUp;
  } else if (travelMode === 'driving') {
    if (caveTravelZone === 'tunnel') {
      const descentCameraOffset = THREE.MathUtils.lerp(
        4.8,
        11.5,
        THREE.MathUtils.smoothstep(caveRouteDistance, 4, 24)
      );
      const cameraOffset = lookingAtCamera ? -6.5 : descentCameraOffset;
      const unclampedCameraDistance = caveRouteDistance - caveRouteFacing * cameraOffset;
      const cameraDistance = THREE.MathUtils.clamp(unclampedCameraDistance, 0, CAVE_ROUTE_LENGTH);
      const cameraRatio = cameraDistance / CAVE_ROUTE_LENGTH;
      caveCameraLocal.copy(CAVE_ROUTE_CURVE.getPointAt(cameraRatio));
      caveCameraTangent.copy(CAVE_ROUTE_CURVE.getTangentAt(cameraRatio)).normalize();
      caveCameraRight.crossVectors(caveCameraTangent, UP).normalize();
      // Extrapolate behind the mouth instead of pinning the camera directly
      // over it, so the rover stays framed throughout the downhill handoff.
      if (unclampedCameraDistance < 0) caveCameraLocal.addScaledVector(caveCameraTangent, unclampedCameraDistance);
      else if (unclampedCameraDistance > CAVE_ROUTE_LENGTH) {
        caveCameraLocal.addScaledVector(caveCameraTangent, unclampedCameraDistance - CAVE_ROUTE_LENGTH);
      }
      caveCameraLocal.addScaledVector(caveCameraRight, caveLateral).addScaledVector(UP, lookingAtCamera ? 3.8 : 4.9);
      desiredCamPos.copy(caveCameraLocal);
      hubRuntime.nightfall.group.localToWorld(desiredCamPos);
      desiredTarget.copy(alien.position).addScaledVector(caveWorldUp, 1.8).addScaledVector(caveWorldForward, lookingAtCamera ? -2.4 : 3.4);
      desiredCameraUp = caveWorldUp;
    } else if (caveTravelZone === 'chamber') {
      const cameraHeight = lookingAtCamera ? 8.2 : 10.8;
      const cameraTrail = lookingAtCamera ? 10 : -14;
      desiredCamPos.copy(alien.position).addScaledVector(caveWorldUp, cameraHeight).addScaledVector(caveWorldForward, cameraTrail);
      if (!lookingAtCamera) desiredCamPos.addScaledVector(caveWorldRight, 3.2);
      desiredTarget.copy(alien.position).addScaledVector(caveWorldUp, 2.1).addScaledVector(caveWorldForward, 6);
      desiredCameraUp = caveWorldUp;
    } else {
      const cameraHeight = garageDepartureCamera
        ? 5.4
        : lookingAtCamera ? Math.max(13, activeProfile.cameraHeight - 5) : activeProfile.cameraHeight;
      const cameraTrail = garageDepartureCamera
        ? 12.5
        : lookingAtCamera ? Math.abs(activeProfile.cameraTrail) * 0.72 : activeProfile.cameraTrail;
      desiredCamPos.copy(alien.position).addScaledVector(playerNormal, cameraHeight).addScaledVector(playerHeading, cameraTrail);
      desiredTarget.copy(alien.position).addScaledVector(playerNormal, 2.2).addScaledVector(playerHeading, lookingAtCamera ? 0 : 3.2);
      desiredCameraUp = playerNormal;
    }
  } else if (travelMode === 'boating') {
    const boat = oasisLake.boat;
    const cameraHeight = lookingAtCamera ? 7.2 : 10.8;
    const cameraTrail = lookingAtCamera ? 11.5 : -14.5;
    desiredCamPos.copy(boat.root.position)
      .addScaledVector(boat.normal, cameraHeight)
      .addScaledVector(boat.heading, cameraTrail);
    desiredTarget.copy(boat.root.position)
      .addScaledVector(boat.normal, 1.65)
      .addScaledVector(boat.heading, lookingAtCamera ? -1.4 : 4.2);
    desiredCameraUp = boat.normal;
  } else if (travelMode === 'walking') {
    if (ufoInteriorActive) {
      desiredCamPos.copy(footRoot.position)
        .addScaledVector(footNormal, lookingAtCamera ? 4.15 : 4.8)
        .addScaledVector(footHeading, lookingAtCamera ? 6.2 : -7.8);
      desiredTarget.copy(footRoot.position)
        .addScaledVector(footNormal, 1.8)
        .addScaledVector(footHeading, lookingAtCamera ? -0.4 : 3.2);
      desiredCameraUp = footNormal;
    } else {
      const interiorCameraBlend = Math.max(caveDarkness, moonCommandInterior, alienHomeInterior);
      const garageCameraDistance = currentWorld === 'mars'
        ? arcDistanceForWorld('mars', footNormal, GARAGE_NORMAL)
        : Infinity;
      const garageCameraBlend = 1 - THREE.MathUtils.smoothstep(garageCameraDistance, 9, 22);
      let cameraHeight = THREE.MathUtils.lerp(lookingAtCamera ? 8.5 : 10.5, lookingAtCamera ? 4.3 : 4.6, interiorCameraBlend);
      let cameraTrail = THREE.MathUtils.lerp(lookingAtCamera ? 8 : -11, lookingAtCamera ? 6.2 : -7.5, interiorCameraBlend);
      cameraHeight = THREE.MathUtils.lerp(cameraHeight, lookingAtCamera ? 4.7 : 4.65, moonCommandInterior);
      cameraTrail = THREE.MathUtils.lerp(cameraTrail, lookingAtCamera ? 4.2 : -2.8, moonCommandInterior);
      cameraHeight = THREE.MathUtils.lerp(cameraHeight, lookingAtCamera ? 4.15 : 4.3, alienHomeInterior);
      cameraTrail = THREE.MathUtils.lerp(cameraTrail, lookingAtCamera ? 5.4 : -5.6, alienHomeInterior);
      // Duck the walking camera under the motor-cavern ceiling before it can
      // intersect the roof. The gradual blend prevents a visible camera pop.
      cameraHeight = THREE.MathUtils.lerp(cameraHeight, lookingAtCamera ? 4.15 : 4.25, garageCameraBlend);
      cameraTrail = THREE.MathUtils.lerp(cameraTrail, lookingAtCamera ? 5.2 : -5.8, garageCameraBlend);
      let commandTargetHeight = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(2.2, 2.5, moonCommandInterior),
        2.05,
        garageCameraBlend
      );
      let commandTargetLead = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lookingAtCamera ? 0 : 2.2, lookingAtCamera ? 0 : 2.8, moonCommandInterior),
        lookingAtCamera ? 0 : 1.8,
        garageCameraBlend
      );
      commandTargetHeight = THREE.MathUtils.lerp(commandTargetHeight, 1.9, alienHomeInterior);
      commandTargetLead = THREE.MathUtils.lerp(commandTargetLead, lookingAtCamera ? 0 : 2.2, alienHomeInterior);
      desiredCamPos.copy(footRoot.position)
        .addScaledVector(footNormal, cameraHeight)
        .addScaledVector(footHeading, cameraTrail);
      if (!lookingAtCamera && moonCommandInterior > 0.01) {
        interiorCameraSide.copy(footHeading).cross(footNormal).normalize();
        desiredCamPos.addScaledVector(interiorCameraSide, moonCommandInterior * 2.35);
      }
      desiredTarget.copy(footRoot.position).addScaledVector(footNormal, commandTargetHeight).addScaledVector(footHeading, commandTargetLead);
      desiredCameraUp = footNormal;
    }
  } else if (travelMode === 'hyperbike') {
    if (hyperBikeTransit) {
      desiredCamPos.copy(hyperBike.position)
        .addScaledVector(hyperBikeFlightDirection, -19)
        .addScaledVector(hyperBikeFlightUp, 8.5);
      desiredTarget.copy(hyperBike.position).addScaledVector(hyperBikeFlightDirection, 5.5);
      desiredCameraUp = hyperBikeFlightUp;
    } else {
      const dockNormal = hyperBikeDockNormal(hyperBikeLocation);
      const dockHeading = hyperBikeLocation === 'zephyra' ? ZEPHYRA_BIKE_HEADING : MOON_BIKE_HEADING;
      desiredCamPos.copy(hyperBike.position).addScaledVector(dockNormal, 7.5).addScaledVector(dockHeading, -12);
      desiredTarget.copy(hyperBike.position).addScaledVector(dockNormal, 2.1);
      desiredCameraUp = dockNormal;
    }
  } else {
    if (shuttleTransit) {
      desiredCamPos.copy(moonShuttle.position).addScaledVector(shuttleFlightDirection, -28).addScaledVector(UP, 32);
      desiredTarget.copy(moonShuttle.position).addScaledVector(shuttleFlightDirection, 2.5);
      desiredCameraUp = UP;
    } else {
      const dockNormal = shuttleLocation === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
      const dockHeading = tangentHeadingForNormal(dockNormal);
      desiredCamPos.copy(moonShuttle.position).addScaledVector(dockNormal, 14).addScaledVector(dockHeading, -18);
      desiredTarget.copy(moonShuttle.position).addScaledVector(dockNormal, 3.2);
      desiredCameraUp = dockNormal;
    }
  }
  camera.position.lerp(desiredCamPos, 1 - Math.exp(-dt * (travelMode === 'boarded' || travelMode === 'hyperbike' ? 3.4 : 5.2)));
  camera.up.lerp(desiredCameraUp, 1 - Math.exp(-dt * 7)).normalize();
  camLookTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 8));
  camera.lookAt(camLookTarget);

  hudUpdateAccumulator += dt;
  if (hudUpdateAccumulator >= hudUpdateInterval) {
    hudUpdateAccumulator %= hudUpdateInterval;
    const displayedSpeed = travelMode === 'driving'
      ? Math.abs(driveSpeed) * 3.6
      : travelMode === 'mine-train'
        ? Math.abs(mineTrainSpeed) * 3.6
      : travelMode === 'cave-walking'
        ? Math.abs(caveFootSpeed) * 3.6
      : travelMode === 'boating'
        ? Math.abs(oasisBoatSpeed) * 3.6
        : travelMode === 'walking'
          ? Math.abs(footSpeed) * 3.6
          : travelMode === 'hyperbike' ? hyperBikeDisplaySpeed : shuttleDisplaySpeed;
    speedValueEl.textContent = Math.round(displayedSpeed).toString().padStart(2, '0');
    let elevation = 0;
    if (travelMode === 'mine-train') elevation = caveLocalPosition.y;
    else if (travelMode === 'cave-walking') elevation = caveFootLocalPosition.y;
    else if (travelMode === 'driving') elevation = caveTravelZone === 'surface'
      ? getSurfaceHeight(playerNormal) + jumpHeight
      : caveLocalPosition.y + jumpHeight;
    else if (travelMode === 'boating') elevation = getSurfaceHeight(oasisLake.boat.normal) + 0.48;
    else if (travelMode === 'walking') {
      const surfaceHeight = currentWorld === 'mars'
        ? getSurfaceHeight(footNormal)
        : currentWorld === 'zephyra'
          ? getZephyraHeight(footNormal)
          : getMoonHeight(footNormal);
      elevation = surfaceHeight + footJumpHeight;
    }
    elevationValueEl.textContent = `${elevation >= 0 ? '+' : ''}${elevation.toFixed(1)}`;

  if (travelMode === 'mine-train') {
    locationLabelEl.textContent = caveRouteDistance >= CAVE_ROUTE_LENGTH - 0.7
      ? 'VASTWATER TERMINUS · NIGHTFALL MINE TRAIN'
      : `NIGHTFALL MINE TRAIN · ${Math.round(caveRouteDistance)} / ${Math.round(CAVE_ROUTE_LENGTH)} M`;
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = 'W descend · S climb · E disembark at stations · F look back · H home';
  } else if (travelMode === 'cave-walking') {
    locationLabelEl.textContent = 'THE VASTWATER · UNDERMARS BIOSPHERE';
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = 'WASD / ARROWS explore · E board train at platform · F look back · H home';
  } else if (travelMode === 'hyperbike' && hyperBikeTransit) {
    locationLabelEl.textContent = `HYPERSPEED CORRIDOR · ${hyperBikeTransit.to.toUpperCase()}`;
    gravityValueEl.textContent = '0.00 G';
    controlsHintEl.textContent = 'VOLT BIKE AUTOPILOT · E trip status · H home';
  } else if (travelMode === 'boarded' && shuttleTransit) {
    locationLabelEl.textContent = 'ARES–LUNA TRANSIT';
    gravityValueEl.textContent = '0.00 G';
    controlsHintEl.textContent = 'SPACE BUS AUTOPILOT · E trip status · H home';
  } else if (travelMode === 'boating') {
    locationLabelEl.textContent = 'NEBULA OASIS · SKIFF';
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = 'WASD / ARROWS steer skiff · E dive out · F look back · H home';
  } else if (travelMode === 'driving' && caveTravelZone !== 'surface') {
    locationLabelEl.textContent = caveTravelZone === 'chamber'
      ? 'THE VASTWATER · UNDERMARS BIOSPHERE'
      : `NIGHTFALL DESCENT · ${Math.round(caveRouteDistance)} / ${Math.round(CAVE_ROUTE_LENGTH)} M`;
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = caveTravelZone === 'chamber'
      ? 'WASD / ARROWS explore · R warp vehicle · H home on foot · F look back'
      : 'W/S descend or reverse · R warp vehicle · H home on foot · F look back';
  } else if (ufoInteriorActive) {
    locationLabelEl.textContent = "CAITLIN'S PROJECT ARCHIVE · UFO INTERIOR";
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = 'WASD / ARROWS explore cabin · CLICK a project screen · H home';
  } else {
    const locationWorld = travelMode === 'boarded' ? shuttleLocation : travelMode === 'hyperbike' ? hyperBikeLocation : currentWorld;
    locationLabelEl.textContent = locationWorld === 'moon'
      ? moonCommandInterior > 0.35
        ? 'LUNA COMMAND CENTER · MOON'
        : moonRayedCraterProximity > 0.55 && moonRayedCraterProximity >= moonColdTrapProximity
          ? 'TYCHO MINOR · MOON'
          : moonColdTrapProximity > 0.55 ? 'PSR-01 COLD TRAP · MOON' : 'MOON SURFACE · LUNA 01'
      : locationWorld === 'zephyra'
        ? zephyraGroveProximity > 0.55 && zephyraGroveProximity >= zephyraAuroraProximity && zephyraGroveProximity >= zephyraFluxProximity && zephyraGroveProximity >= zephyraCanyonProximity && zephyraGroveProximity >= zephyraStormProximity
          ? 'PRISM GROVE · ZEPHYRA'
          : zephyraAuroraProximity > 0.55 && zephyraAuroraProximity >= zephyraGroveProximity && zephyraAuroraProximity >= zephyraFluxProximity && zephyraAuroraProximity >= zephyraCanyonProximity && zephyraAuroraProximity >= zephyraStormProximity
          ? 'ION VEIL · ZEPHYRA'
          : zephyraFluxProximity > 0.55 && zephyraFluxProximity >= zephyraGroveProximity && zephyraFluxProximity >= zephyraCanyonProximity && zephyraFluxProximity >= zephyraStormProximity
          ? 'FLUX WELL · ZEPHYRA'
          : zephyraCanyonProximity > 0.55 && zephyraCanyonProximity >= zephyraGroveProximity && zephyraCanyonProximity >= zephyraStormProximity
          ? 'ION GLASS CANYON · ZEPHYRA'
          : zephyraStormProximity > 0.55 ? 'RESONANCE SPIRES · ZEPHYRA' : 'ZEPHYRA SURFACE · ELECTRIC HORIZON'
        : alienHomeInterior > 0.45
          ? "ALIEN'S THARSIS HOME · MARS"
        : alienSwimming
          ? 'NEBULA OASIS · SWIMMING'
          : activeDrivingCourse
          ? `${activeDrivingCourse.name} · MARS MOTORSPORT`
          : travelMode === 'walking' && currentWorld === 'mars' && arcDistanceForWorld('mars', footNormal, GARAGE_NORMAL) < 26
          ? 'ARES MOTOR CAVERN · VEHICLE GARAGE'
          : marsImpactBasinProximity > 0.55 && marsImpactBasinProximity >= marsYardangProximity && marsImpactBasinProximity >= marsEscarpmentProximity
          ? 'DAEDALIA IMPACT BASIN · MARS'
          : marsYardangProximity > 0.55 && marsYardangProximity >= marsImpactBasinProximity && marsYardangProximity >= marsEscarpmentProximity
            ? 'MEDUSAE YARDANGS · MARS'
            : marsEscarpmentProximity > 0.55 && marsEscarpmentProximity >= marsImpactBasinProximity
            ? 'ARABIA TERRACE · MARS'
            : marsDustStormBlend > 0.55 && caveDarkness < 0.35
              ? 'MARS DUST FRONT · LOW VISIBILITY'
              : 'MARS SURFACE · SOL 01';
    gravityValueEl.textContent = locationWorld === 'moon'
      ? '0.16 G'
      : locationWorld === 'zephyra'
        ? `${THREE.MathUtils.lerp(0.52, 0.13, zephyraFluxProximity).toFixed(2)} G`
        : '0.38 G';
    controlsHintEl.textContent = travelMode === 'driving'
      ? `WASD / ARROWS drive ${activeVehicle?.label || 'vehicle'} · HOLD SPACE thrusters · E exit · F look back · H home`
      : travelMode === 'boating'
        ? 'WASD / ARROWS steer skiff · E dive out · F look back · H home'
      : travelMode === 'walking'
        ? alienSwimming
          ? 'WASD / ARROWS swim · E board skiff · F look back · H home'
          : moonCommandInterior > 0.35
          ? 'WASD / ARROWS explore command · E operate consoles · F look back · H home'
          : 'WASD / ARROWS walk · HOLD SPACE jetpack climb · E enter / board · F look back · H home'
        : travelMode === 'hyperbike' ? 'E disembark Volt bike · H home' : 'E disembark space bus · H home';
  }

  if (shuttleTransit) {
    const eta = Math.max(0, Math.ceil(shuttleTransit.duration - shuttleTransit.elapsed));
    shuttleStatusTextEl.textContent = `${shuttleTransit.from.toUpperCase()} → ${shuttleTransit.to.toUpperCase()} · ARRIVES`;
    shuttleCountdownValueEl.textContent = String(eta).padStart(2, '0');
    const routeProgress = THREE.MathUtils.clamp(shuttleTransit.elapsed / shuttleTransit.duration, 0, 1);
    const marsToMoonProgress = shuttleTransit.from === 'mars' ? routeProgress : 1 - routeProgress;
    shuttleRouteBusEl.style.left = `${marsToMoonProgress * 100}%`;
    shuttleStatusEl.classList.remove('urgent');
  } else {
    const remaining = Math.max(1, Math.ceil(shuttleDockTimer));
    shuttleStatusTextEl.textContent = `${shuttleLocation.toUpperCase()} PAD · DEPARTS`;
    shuttleCountdownValueEl.textContent = String(remaining).padStart(2, '0');
    shuttleRouteBusEl.style.left = shuttleLocation === 'mars' ? '0%' : '100%';
    shuttleStatusEl.classList.toggle('urgent', remaining <= 3);
  }

    updateTravelPrompt();
  }

  renderer.render(scene, camera);
  updatePerformanceDebug(rawDt);
  if (!loadingComplete) {
    renderedStartupFrames += 1;
    setLoadingStage(92 + renderedStartupFrames * 2, renderedStartupFrames < 3 ? 'STABILIZING FIRST TRANSMISSION' : 'EXPEDITION READY');
    if (renderedStartupFrames >= 3) finishLoadingScreen();
  }
}
animate();
