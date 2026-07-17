import * as THREE from 'three';
import './style.css';

/* ---------- renderer / scene / camera ---------- */

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add('touch-device');

const scene = new THREE.Scene();
const clearSpaceColor = new THREE.Color(0x02030a);
scene.background = clearSpaceColor.clone();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1600);

const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
  { key: 'outpost', name: "Caitlin's Projects", x: 144, z: -144, color: 0x6fb8ff, trigger: 13 },
  { key: 'cavern', name: 'Contact Info', x: -144, z: -144, color: 0xb266ff, trigger: 13 },
  { key: 'ruins', name: 'Ancient Ruins', x: 144, z: 144, color: 0xe0a35a, trigger: 13 },
  { key: 'crash', name: 'Crash Site', x: -144, z: 144, color: 0xff6a4a, trigger: 13 },
  { key: 'nightfall', name: 'Nightfall Cave', x: -52, z: -42, color: 0xd66b48, trigger: 19 },
];

const SPEAKER_STATIONS = [
  { key: 'ion', name: 'MARS CHILL-HOP', x: -12, z: -10, color: 0x72e6ff },
  { key: 'redshift', name: 'MARS CHILL-HOP', x: 144, z: -96, color: 0xff806d },
  { key: 'dust', name: 'MARS CHILL-HOP', x: -156, z: 70, color: 0xc28cff },
  { key: 'bloom', name: 'MARS CHILL-HOP', x: 48, z: 164, color: 0x78ffc1 },
  { key: 'echo', name: 'MARS CHILL-HOP', x: 164, z: 56, color: 0xffd36f },
];

const MARS_PORT = { x: 12, z: -20, name: 'ARES–LUNA TRANSFER' };
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
const CAVE_INNER_RADIUS = 6.4;
NIGHTFALL_CAVE.heading = START_NORMAL.clone()
  .addScaledVector(NIGHTFALL_CAVE.normal, -START_NORMAL.dot(NIGHTFALL_CAVE.normal))
  .normalize();
NIGHTFALL_CAVE.right = NIGHTFALL_CAVE.heading.clone().cross(NIGHTFALL_CAVE.normal).normalize();
const CAVE_INWARD_HEADING = NIGHTFALL_CAVE.heading.clone().multiplyScalar(-1);
const CAVE_ROUTE_POINTS = [
  new THREE.Vector3(0, 0.1, 3),
  new THREE.Vector3(0, -0.3, -8),
  new THREE.Vector3(4.8, -4.8, -25),
  new THREE.Vector3(-5.5, -11.5, -47),
  new THREE.Vector3(6.2, -19.5, -72),
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
SPEAKER_STATIONS.forEach((station) => {
  station.normal = normalFromSurfaceCoords(station.x, station.z);
  station.hearingRadius = 44;
});
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
  ...HUBS.map((hub) => ({ normal: hub.normal, r0: 8, r1: 13 })),
  ...[-12, 12].map((distance) => ({
    normal: stepWorldNormal(NIGHTFALL_CAVE.normal, NIGHTFALL_CAVE.heading, distance, PLANET_RADIUS),
    r0: 7,
    r1: 10,
  })),
  ...SPEAKER_STATIONS.map((station) => ({ normal: station.normal, r0: 2.2, r1: 4.2 })),
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

  const textures = buildEarthTextureSet();
  const spinRoot = new THREE.Group();
  spinRoot.rotation.z = THREE.MathUtils.degToRad(23.4);
  group.add(spinRoot);

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    map: textures.surfaceTexture,
    emissive: 0xffb36a,
    emissiveMap: textures.cityTexture,
    emissiveIntensity: 0.86,
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    opacity: 0,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(6.35, isTouchDevice ? 40 : 64, isTouchDevice ? 24 : 40), surfaceMaterial);
  spinRoot.add(surface);

  const cloudMaterial = new THREE.MeshStandardMaterial({
    map: textures.cloudTexture,
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
  return { group, spinRoot, surface, surfaceMaterial, clouds, cloudMaterial, atmosphere, atmosphereMaterial };
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
// shadow map can resolve boots, rocks, the shuttle, and habitat silhouettes.
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
moonSunLight.shadow.mapSize.set(isTouchDevice ? 512 : 1536, isTouchDevice ? 512 : 1536);
moonSunLight.shadow.camera.near = 0.5;
moonSunLight.shadow.camera.far = 105;
moonSunLight.shadow.camera.left = -24;
moonSunLight.shadow.camera.right = 24;
moonSunLight.shadow.camera.top = 24;
moonSunLight.shadow.camera.bottom = -24;
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
  sunLight.intensity *= THREE.MathUtils.lerp(1, 0.38, atmosphereBlend);
  hemisphereLight.intensity *= THREE.MathUtils.lerp(1, 0.58, atmosphereBlend);
  ambientLight.intensity *= THREE.MathUtils.lerp(1, 0.72, atmosphereBlend);
  renderer.toneMappingExposure *= THREE.MathUtils.lerp(1, 0.78, atmosphereBlend);

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
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x4d221a, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const align = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  let placed = 0;
  while (placed < count) {
    const normal = randomUnitVector();
    if (geodesicDistance(normal, START_NORMAL) < 12) continue;
    if (HUBS.some((hub) => geodesicDistance(normal, hub.normal) < 11)) continue;
    if (geodesicDistance(normal, NIGHTFALL_CAVE.normal) < 25) continue;
    if (SPEAKER_STATIONS.some((station) => geodesicDistance(normal, station.normal) < 4.2)) continue;
    if (geodesicDistance(normal, MARS_PORT.normal) < 8) continue;
    const scale = 0.28 + Math.pow(Math.random(), 2) * 1.75;
    dummy.position.copy(surfaceWorldPosition(normal, scale * 0.3));
    align.setFromUnitVectors(UP, normal);
    yaw.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
    dummy.quaternion.copy(align).multiply(yaw);
    dummy.scale.set(scale * (0.72 + Math.random() * 0.55), scale * (0.55 + Math.random() * 0.55), scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    if (scale > 1.18) obstacles.push({ normal: normal.clone(), radius: scale * 0.82 });
    placed++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}
buildRocks();

/* ---------- Arabia Terra sedimentary escarpment ---------- */

let marsEscarpmentDiscovered = false;
let marsEscarpmentProximity = 0;

function buildMarsSedimentaryEscarpment() {
  const group = new THREE.Group();
  group.name = 'Mars · Arabia Terra sedimentary escarpment';
  scene.add(group);

  const layerMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9653e,
    roughness: 0.98,
    metalness: 0,
    flatShading: true,
  });
  const segmentCount = isTouchDevice ? 7 : 10;
  const layerCount = isTouchDevice ? 4 : 6;
  const layers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
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
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x6d3528, roughness: 1, flatShading: true }),
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
    layerColor.setHSL(0.025 + random() * 0.025, 0.42 + random() * 0.18, 0.2 + random() * 0.16);
    talus.setColorAt(index, layerColor);
  }
  talus.instanceMatrix.needsUpdate = true;
  if (talus.instanceColor) talus.instanceColor.needsUpdate = true;
  group.add(talus);

  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x4d2924, roughness: 0.94, flatShading: true });
  const capstones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), capMaterial, segmentCount);
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
  const outcropGeometry = new THREE.DodecahedronGeometry(1, 0);
  const outcropPositions = outcropGeometry.attributes.position;
  for (let index = 0; index < outcropPositions.count; index++) {
    const x = outcropPositions.getX(index);
    const y = outcropPositions.getY(index);
    const z = outcropPositions.getZ(index);
    const weathering = 0.84 + hash3(x * 7 + 3, y * 9 - 4, z * 8 + 11) * 0.26;
    outcropPositions.setXYZ(index, x * weathering, y * (0.78 + weathering * 0.18), z * weathering);
  }
  outcropPositions.needsUpdate = true;
  outcropGeometry.computeVertexNormals();
  const outcropMaterial = new THREE.MeshStandardMaterial({ color: 0x8d432e, roughness: 1, flatShading: true });
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
      outcrops.setColorAt(instance, instanceColor.setHSL(0.035 + ridgeIndex * 0.006, 0.4, 0.22 + segment * 0.012));
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

  const brecciaMaterial = new THREE.MeshStandardMaterial({
    color: 0x6c3529,
    roughness: 0.98,
    metalness: 0.02,
    flatShading: true,
  });
  const rimCount = isTouchDevice ? 42 : 76;
  const rimBlocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), brecciaMaterial, rimCount);
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
    rimBlocks.setColorAt(index, instanceColor.setHSL(0.025 + random() * 0.025, 0.38 + random() * 0.18, 0.2 + random() * 0.16));
  }
  rimBlocks.instanceMatrix.needsUpdate = true;
  if (rimBlocks.instanceColor) rimBlocks.instanceColor.needsUpdate = true;
  group.add(rimBlocks);

  const ledgeMaterial = new THREE.MeshStandardMaterial({
    color: 0x8f4b36,
    roughness: 1,
    flatShading: true,
  });
  const ledgeCount = isTouchDevice ? 36 : 60;
  const terraceLedges = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, ledgeCount);
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
    terraceLedges.setColorAt(index, instanceColor.setHSL(0.03, 0.42 + random() * 0.12, 0.24 + band * 0.1 + random() * 0.06));
  }
  terraceLedges.instanceMatrix.needsUpdate = true;
  if (terraceLedges.instanceColor) terraceLedges.instanceColor.needsUpdate = true;
  group.add(terraceLedges);

  const ejectaMaterial = new THREE.MeshStandardMaterial({
    color: 0x9c5439,
    roughness: 0.96,
    flatShading: true,
  });
  const ejectaCount = isTouchDevice ? 52 : 92;
  const ejectaBlocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), ejectaMaterial, ejectaCount);
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
    ejectaBlocks.setColorAt(index, instanceColor.setHSL(0.027 + random() * 0.018, 0.42 + random() * 0.16, 0.23 + random() * 0.15));
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

function buildTrailRibbon(hub, halfWidth, lateralOffset, lift, color, opacity = 1) {
  const distance = geodesicDistance(START_NORMAL, hub.normal);
  const steps = Math.max(24, Math.ceil(distance / 0.72));
  const vertices = [];
  const colors = [];
  const indices = [];
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const trailColor = new THREE.Color(color);
  const variedColor = new THREE.Color();
  for (let index = 0; index <= steps; index++) {
    const routeRatio = THREE.MathUtils.lerp(0.025, 0.975, index / steps);
    const normal = slerpNormals(START_NORMAL, hub.normal, routeRatio);
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
  return mesh;
}

function buildDirtPath(hub) {
  buildTrailRibbon(hub, 1.55, 0, 0.11, 0x7f3824, 0.96);
  buildTrailRibbon(hub, 0.15, -0.72, 0.145, 0x3f211c, 0.78);
  buildTrailRibbon(hub, 0.15, 0.72, 0.145, 0x3f211c, 0.78);
}
HUBS.forEach(buildDirtPath);

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

function buildSignposts() {
  const contactHub = HUBS.find((hub) => hub.key === 'cavern');
  const nightfallHub = HUBS.find((hub) => hub.key === 'nightfall');
  const sharedTarget = slerpNormals(nightfallHub.normal, contactHub.normal, 0.35);
  const signposts = HUBS
    .filter((hub) => hub.key !== 'cavern' && hub.key !== 'nightfall')
    .map((hub) => ({ hub, target: hub.normal, label: hub.name, color: hub.color }));
  signposts.push({
    hub: nightfallHub,
    target: sharedTarget,
    label: "CAITLIN'S CONTACT INFO",
    color: 0xc37dff,
    wide: true,
  });
  signposts.forEach(({ hub, target, label: signLabel, color, wide }) => {
    const group = new THREE.Group();
    const normal = slerpNormals(START_NORMAL, target, 7 / geodesicDistance(START_NORMAL, target));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.8 }));
    pole.position.y = 1.1;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(wide ? 1.42 : 0.85, 0.5), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    flag.position.set(0.42, 1.85, 0);
    group.add(flag);
    const label = makeLabelSprite(signLabel, '#fff3e6');
    label.position.set(0, 2.75, 0);
    if (wide) label.scale.set(8.5, 1.05, 1);
    group.add(label);
    placeSurfaceGroup(group, normal);
  });
}
buildSignposts();

/* ---------- hub builders ---------- */

function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts });
}

function buildResearchOutpost(hub) {
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);

  const hull = stdMat(0x68747a, { metalness: 0.82, roughness: 0.38, flatShading: true });
  const scorchedHull = stdMat(0x292c2c, { metalness: 0.62, roughness: 0.72, flatShading: true });
  const exposedInterior = stdMat(0x080b0d, { metalness: 0.28, roughness: 0.82 });
  const cockpitGlass = new THREE.MeshPhysicalMaterial({
    color: 0x173846,
    emissive: 0x0a3948,
    emissiveIntensity: 0.52,
    transparent: true,
    opacity: 0.68,
    transmission: 0.18,
    roughness: 0.16,
    metalness: 0.18,
    depthWrite: false,
  });

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(7.8, 64),
    new THREE.MeshBasicMaterial({ color: 0x180705, transparent: true, opacity: 0.62, depthWrite: false })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.scale.set(1.45, 0.72, 1);
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
  saucer.rotation.set(-0.11, -0.42, 0.19);
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

  const cockpitBase = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.88, 0.52, 32), scorchedHull);
  cockpitBase.position.y = 2.03;
  saucer.add(cockpitBase);
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(2.32, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    cockpitGlass
  );
  cockpit.position.y = 2.23;
  cockpit.scale.y = 0.78;
  saucer.add(cockpit);

  const cockpitFrameMaterial = stdMat(0x20292e, { metalness: 0.86, roughness: 0.28 });
  [-0.82, 0.24, 1.08].forEach((rotation, index) => {
    const crackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.2 - index * 0.25, 0.055), cockpitFrameMaterial);
    crackFrame.position.set(Math.sin(rotation) * 1.42, 3.28, Math.cos(rotation) * 1.42);
    crackFrame.rotation.set(0.48, rotation, -0.22 + index * 0.19);
    saucer.add(crackFrame);
  });

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
  breach.position.set(4.25, 1.24, 1.3);
  breach.scale.set(0.58, 1.02, 1.25);
  saucer.add(breach);
  const breachGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 18),
    new THREE.MeshBasicMaterial({ color: 0x58dfff, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  breachGlow.position.set(4.9, 1.24, 1.3);
  breachGlow.rotation.y = Math.PI / 2;
  saucer.add(breachGlow);

  for (let i = 0; i < 7; i++) {
    const tornPlate = new THREE.Mesh(new THREE.ConeGeometry(0.45 + (i % 3) * 0.15, 1.45 + (i % 2) * 0.5, 3), scorchedHull);
    tornPlate.position.set(4.35 + Math.sin(i * 2.4) * 0.9, 1.18 + Math.cos(i * 1.7) * 0.72, 1.3 + Math.sin(i * 3.1) * 0.9);
    tornPlate.rotation.set(i * 0.53, i * 0.81, i * 0.37);
    saucer.add(tornPlate);
  }

  const recoveryRamp = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.16, 1.7), scorchedHull);
  recoveryRamp.position.set(6.4, 0.42, 1.3);
  recoveryRamp.rotation.z = -0.17;
  saucer.add(recoveryRamp);

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
  interiorLight.position.set(5.25, 1.5, 1.3);
  saucer.add(interiorLight);

  const smokeCount = 34;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeBases = new Float32Array(smokeCount * 3);
  const smokeSpeeds = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) {
    const x = 4.3 + (Math.random() - 0.5) * 1.5;
    const y = 1.8 + Math.random() * 4.8;
    const z = 1.3 + (Math.random() - 0.5) * 1.5;
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

  addCollider(hub.x, hub.z, 6.8);
  return { group, saucer, rimLights, interiorLight, smoke, smokeBases, smokeSpeeds, sparks, breachGlow };
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

function buildAncientRuins(hub) {
  const baseY = getTerrainHeight(hub.x, hub.z);
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);

  const pillarCount = 7;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2;
    const dx = Math.cos(a) * 8.5;
    const dz = Math.sin(a) * 8.5;
    const fallen = Math.random() < 0.35;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.75, 4.5, 10),
      stdMat(0xcc9966, { roughness: 0.9 })
    );
    if (fallen) {
      pillar.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      pillar.position.set(dx, 0.6, dz);
    } else {
      pillar.position.set(dx, 2.25, dz);
      addCollider(hub.x + dx, hub.z + dz, 0.9);
    }
    group.add(pillar);
  }

  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 1.4), stdMat(0xb5875a, { roughness: 0.85 }));
  pedestal.position.y = 1.3;
  group.add(pedestal);
  addCollider(hub.x, hub.z, 1.3);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.35), stdMat(0xffbb66, { emissive: 0xffbb66, emissiveIntensity: 1 }));
  glow.position.y = 2.9;
  group.add(glow);

  const light = new THREE.PointLight(0xffaa55, 2, 30);
  light.position.y = 4;
  group.add(light);

  return { group };
}

function buildCrashSite(hub) {
  const baseY = getTerrainHeight(hub.x, hub.z);
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);

  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.6, 7, 4, 12),
    stdMat(0x555b60, { metalness: 0.6, roughness: 0.5 })
  );
  hull.rotation.z = Math.PI / 2.3;
  hull.rotation.y = 0.4;
  hull.position.set(0, 1.2, 0);
  group.add(hull);
  addCollider(hub.x, hub.z, 5);

  const scorch = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 8), stdMat(0x2a2320, { roughness: 1 }));
  scorch.position.set(-2.5, 1.6, 1.5);
  scorch.scale.set(1, 0.6, 1);
  group.add(scorch);

  for (let i = 0; i < 6; i++) {
    const dx = (Math.random() - 0.5) * 12;
    const dz = (Math.random() - 0.5) * 12;
    const debris = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.6, 0), stdMat(0x4a4d50, { metalness: 0.5, roughness: 0.6, flatShading: true }));
    debris.position.set(dx, getTerrainHeight(hub.x + dx, hub.z + dz) - baseY + 0.3, dz);
    debris.rotation.set(Math.random(), Math.random(), Math.random());
    group.add(debris);
    if (i < 2) addCollider(hub.x + dx, hub.z + dz, 0.7);
  }

  const light = new THREE.PointLight(0xff5533, 2.5, 26);
  light.position.set(-2, 2.5, 1);
  group.add(light);

  const smokeCount = 40;
  const positions = new Float32Array(smokeCount * 3);
  const bases = new Float32Array(smokeCount * 3);
  const speeds = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) {
    const x = -2.5 + (Math.random() - 0.5) * 2.5;
    const z = 1.5 + (Math.random() - 0.5) * 2.5;
    const y = 2 + Math.random() * 4;
    positions[i * 3] = bases[i * 3] = x;
    positions[i * 3 + 1] = bases[i * 3 + 1] = y;
    positions[i * 3 + 2] = bases[i * 3 + 2] = z;
    speeds[i] = 0.6 + Math.random() * 0.8;
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const smokeMat = new THREE.PointsMaterial({ color: 0x998877, size: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  group.add(smoke);

  return { group, light, smoke, smokeBases: bases, smokeSpeeds: speeds };
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
  root.name = 'Morrow · autonomous cave bear';
  const fur = new THREE.MeshStandardMaterial({ color: 0x30201b, roughness: 0.98, flatShading: true });
  const darkFur = new THREE.MeshStandardMaterial({ color: 0x140e0c, roughness: 1, flatShading: true });
  const muzzleMaterial = new THREE.MeshStandardMaterial({ color: 0x6d4a37, roughness: 0.94, flatShading: true });
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd58a, toneMapped: false });
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
  return { root, body, head, legs };
}

function buildNightfallCave(hub) {
  const group = new THREE.Group();
  group.name = 'Nightfall Descent · Undermars biosphere';
  group.position.copy(surfaceWorldPosition(hub.normal, -0.18));
  group.quaternion.copy(surfaceVehicleQuaternion(hub.normal, CAVE_INWARD_HEADING));
  scene.add(group);

  const shellCurve = new THREE.CatmullRomCurve3(
    CAVE_ROUTE_POINTS.map((point) => point.clone().add(new THREE.Vector3(0, CAVE_INNER_RADIUS - 0.45, 0))),
    false,
    'centripetal',
    0.45
  );
  const tunnel = new THREE.Mesh(
    new THREE.TubeGeometry(shellCurve, isTouchDevice ? 54 : 86, CAVE_INNER_RADIUS, isTouchDevice ? 10 : 14, false),
    new THREE.MeshStandardMaterial({ color: 0x100907, roughness: 1, side: THREE.BackSide })
  );
  group.add(tunnel);

  const road = new THREE.Mesh(
    createCaveRibbonGeometry(CAVE_ROUTE_CURVE, CAVE_INNER_RADIUS * 1.34, isTouchDevice ? 55 : 90, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x24130f, roughness: 0.98, metalness: 0.02, side: THREE.DoubleSide })
  );
  group.add(road);

  const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x5a2d20, emissive: 0x641b0d, emissiveIntensity: 2.4, roughness: 0.95 });
  const entrance = new THREE.Mesh(new THREE.TorusGeometry(CAVE_INNER_RADIUS + 0.35, 0.58, 8, 40), portalMaterial);
  entrance.position.copy(CAVE_ROUTE_POINTS[0]).add(new THREE.Vector3(0, CAVE_INNER_RADIUS - 0.35, 0.5));
  group.add(entrance);
  const entryLabel = makeLabelSprite('NIGHTFALL DESCENT · UNDERMARS', '#ff9f72');
  entryLabel.position.copy(CAVE_ROUTE_POINTS[0]).add(new THREE.Vector3(0, CAVE_INNER_RADIUS * 2 + 1.4, 1));
  entryLabel.scale.set(8.6, 1.28, 1);
  group.add(entryLabel);

  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const tunnelRockMaterial = new THREE.MeshStandardMaterial({ color: 0x3b2019, roughness: 1, flatShading: true });
  const tunnelRockCount = (isTouchDevice ? 26 : 40) * 8;
  const tunnelRocks = new THREE.InstancedMesh(rockGeometry, tunnelRockMaterial, tunnelRockCount);
  const dummy = new THREE.Object3D();
  let tunnelRockIndex = 0;
  const tunnelSegments = isTouchDevice ? 26 : 40;
  for (let segment = 0; segment < tunnelSegments; segment++) {
    const ratio = segment / (tunnelSegments - 1);
    const point = CAVE_ROUTE_CURVE.getPointAt(ratio);
    const tangent = CAVE_ROUTE_CURVE.getTangentAt(ratio).normalize();
    const routeRight = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    for (let stoneIndex = 0; stoneIndex < 8; stoneIndex++) {
      const angle = (stoneIndex / 7) * Math.PI;
      const radius = CAVE_INNER_RADIUS + 0.35 + Math.sin(segment * 2.17 + stoneIndex * 4.3) * 0.42;
      dummy.position.copy(point).addScaledVector(routeRight, Math.cos(angle) * radius).addScaledVector(UP, 0.25 + Math.sin(angle) * radius);
      dummy.rotation.set(angle + segment * 0.13, segment * 0.71 + stoneIndex, stoneIndex * 0.37);
      const variation = 0.88 + ((segment * 17 + stoneIndex * 31) % 9) * 0.08;
      dummy.scale.set(1.3 * variation, 1.05 * variation, 1.55 * variation);
      dummy.updateMatrix();
      tunnelRocks.setMatrixAt(tunnelRockIndex++, dummy.matrix);
    }
  }
  tunnelRocks.instanceMatrix.needsUpdate = true;
  group.add(tunnelRocks);

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
    crystalDummy.position.copy(point).addScaledVector(routeRight, side * (CAVE_INNER_RADIUS - 1.05)).addScaledVector(UP, 1.05 + (index % 4) * 0.36);
    crystalDummy.rotation.set(index * 1.31, index * 2.17, side * 0.4);
    const scale = 0.65 + (index % 5) * 0.13;
    crystalDummy.scale.set(scale * 0.62, scale * 1.8, scale * 0.62);
    crystalDummy.updateMatrix();
    tunnelCrystals.setMatrixAt(index, crystalDummy.matrix);
    if (index % 12 === 3) {
      const light = new THREE.PointLight(index % 24 === 3 ? 0x4be1ff : 0xc87aff, 9, 31, 1.6);
      light.position.copy(crystalDummy.position).addScaledVector(UP, 1.2);
      group.add(light);
      caveAccentLights.push(light);
    }
  }
  tunnelCrystals.instanceMatrix.needsUpdate = true;
  group.add(tunnelCrystals);

  const chamber = new THREE.Group();
  chamber.name = 'The Vastwater · underground river world';
  group.add(chamber);
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

  const cavernSkyLight = new THREE.HemisphereLight(0x5e91ad, 0x160b12, 1.15);
  chamber.add(cavernSkyLight);
  const cavernKeyLight = new THREE.DirectionalLight(0x8bc7d8, 1.15);
  cavernKeyLight.position.set(-34, -10, -160);
  cavernKeyLight.target.position.copy(CAVE_CHAMBER_CENTER);
  chamber.add(cavernKeyLight, cavernKeyLight.target);
  [
    { color: 0x42bddd, position: [-34, -27, -178] },
    { color: 0x9a55e8, position: [3, -19, -226] },
    { color: 0xffa84d, position: [34, -28, -218] },
  ].forEach((fill) => {
    const light = new THREE.PointLight(fill.color, 34, 125, 1.35);
    light.position.set(...fill.position);
    chamber.add(light);
    caveAccentLights.push(light);
  });

  const chamberRockCount = isTouchDevice ? 100 : 160;
  const chamberRocks = new THREE.InstancedMesh(rockGeometry, new THREE.MeshStandardMaterial({ color: 0x292128, roughness: 1, flatShading: true }), chamberRockCount);
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
    dummy.rotation.set(index * 0.37, angle, index * 0.91);
    const scale = wallBand ? 2.8 + (index % 6) * 0.8 : 1.4 + (index % 5) * 0.75;
    dummy.scale.set(scale * 1.25, scale, scale * 1.5);
    dummy.updateMatrix();
    chamberRocks.setMatrixAt(index, dummy.matrix);
  }
  chamberRocks.instanceMatrix.needsUpdate = true;
  chamber.add(chamberRocks);

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
  const bearLabel = makeLabelSprite('MORROW · AUTONOMOUS CAVE BEAR', '#ffd39b');
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

  caveAccentLights.forEach((light) => { light.userData.caveBaseIntensity = light.intensity; });
  return {
    group, chamber, caveAccentLights, crystalMaterials, riverMaterial, waterfallMaterial, waterfalls,
    mist, mistSeeds, hive, hiveLight, bees, beeSeeds, bear, bearWaypoints,
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
let caveDarkness = 0;
let caveWasInside = false;
let caveChamberDiscovered = false;
const caveFog = new THREE.FogExp2(0x071014, 0.0075);

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
  alien.position.copy(caveLocalPosition).addScaledVector(caveLocalUp, jumpHeight);
  runtime.group.localToWorld(alien.position);
  orientationMatrix.makeBasis(caveWorldRight, caveWorldUp, caveWorldForward.clone().multiplyScalar(-1));
  targetRoverQuaternion.setFromRotationMatrix(orientationMatrix);
  alien.quaternion.slerp(targetRoverQuaternion, 1 - Math.exp(-dt * 12));
}

function enterNightfallDescent() {
  caveTravelZone = 'tunnel';
  caveRouteDistance = 0.5;
  caveRouteFacing = 1;
  caveLateral = 0;
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
    caveChamberHeading.applyAxisAngle(UP, steeringInput * reverseSteer * turnSpeed * steerStrength * dt).normalize();
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

function updateNightfallWorld(dt, time) {
  const runtime = hubRuntime.nightfall;
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
    const playerDistance = bearRuntime.root.position.distanceTo(caveLocalPosition);
    if (playerDistance < 12) {
      const lookDirection = caveLocalPosition.clone().sub(bearRuntime.root.position);
      bearRuntime.head.rotation.y = THREE.MathUtils.damp(bearRuntime.head.rotation.y, Math.atan2(-lookDirection.x, -lookDirection.z) - bearRuntime.root.rotation.y, 3.5, dt);
    }
  }
  if (caveWaterGain && audioStarted && audioEnabled && audioContext.state === 'running') {
    const caveWaterLevel = caveTravelZone === 'chamber' ? 0.0085 : caveTravelZone === 'tunnel' ? 0.0012 : 0.0001;
    caveWaterGain.gain.setTargetAtTime(caveWaterLevel, audioContext.currentTime, caveTravelZone === 'surface' ? 0.5 : 0.8);
  }
}

function updateCaveAtmosphere(dt, listenerNormal) {
  let targetDarkness = caveTravelZone === 'surface' ? 0 : caveTravelZone === 'tunnel'
    ? THREE.MathUtils.smoothstep(caveRouteDistance, 2, 22)
    : 0.9;
  if (caveTravelZone === 'surface' && listenerNormal) {
    const entranceDistance = geodesicDistance(listenerNormal, NIGHTFALL_CAVE.normal);
    targetDarkness = (1 - THREE.MathUtils.smoothstep(entranceDistance, 0, 5)) * 0.2;
  }
  caveDarkness = THREE.MathUtils.damp(caveDarkness, targetDarkness, 5.5, dt);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.12, 0.58, caveDarkness);
  hemisphereLight.intensity = THREE.MathUtils.lerp(hemisphereLight.intensity, 0.018, caveDarkness);
  sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, 0.025, caveDarkness);
  ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, 0.026, caveDarkness);
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
HUBS.forEach((hub) => {
  hub.discovered = false;
  if (hub.key === 'outpost') hubRuntime[hub.key] = buildResearchOutpost(hub);
  if (hub.key === 'cavern') hubRuntime[hub.key] = buildCrystalCavern(hub);
  if (hub.key === 'ruins') hubRuntime[hub.key] = buildAncientRuins(hub);
  if (hub.key === 'crash') hubRuntime[hub.key] = buildCrashSite(hub);
  if (hub.key === 'nightfall') hubRuntime[hub.key] = buildNightfallCave(hub);
});

/* ---------- proximity speaker stations ---------- */

function buildSpeakerStation(station, stationIndex) {
  const group = new THREE.Group();
  group.name = `PA-${stationIndex + 1} ${station.name}`;
  const darkMetal = stdMat(0x20251f, { metalness: 0.7, roughness: 0.42 });
  const fieldGreen = stdMat(0x4d5941, { metalness: 0.48, roughness: 0.6 });
  const blackCone = stdMat(0x080b08, { metalness: 0.16, roughness: 0.82, side: THREE.DoubleSide });
  const canvasWebbing = stdMat(0x8f805e, { metalness: 0.04, roughness: 0.94 });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: station.color,
    emissive: station.color,
    emissiveIntensity: 0.75,
    roughness: 0.32,
    metalness: 0.28,
  });

  const footing = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.8, 0.38, 10), darkMetal);
  footing.position.y = 0.19;
  group.add(footing);

  const signalRing = new THREE.Mesh(new THREE.TorusGeometry(1.43, 0.055, 8, 36), accentMaterial);
  signalRing.rotation.x = Math.PI / 2;
  signalRing.position.y = 0.41;
  group.add(signalRing);

  [-1, 1].forEach((side) => {
    [-0.74, 0, 0.74].forEach((z) => {
      const sandbag = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.48), canvasWebbing);
      sandbag.position.set(side * 1.28, 0.5, z);
      sandbag.rotation.y = side * 0.08 + z * 0.08;
      group.add(sandbag);
    });
  });

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 4.55, 8), darkMetal);
  mast.position.y = 2.65;
  group.add(mast);

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.38, 1.25, 0.82), fieldGreen);
  cabinet.position.set(0, 1.22, 0.12);
  group.add(cabinet);

  const cabinetDoor = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.82, 0.045), darkMetal);
  cabinetDoor.position.set(0, 1.24, -0.43);
  group.add(cabinetDoor);

  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.2, 0.2), darkMetal);
  crossbar.position.y = 4.55;
  group.add(crossbar);

  const speakerRims = [];
  [-1.3, 0, 1.3].forEach((x, hornIndex) => {
    const hornMount = new THREE.Group();
    hornMount.position.set(x, 4.72, 0);
    hornMount.rotation.y = (hornIndex - 1) * 0.22;

    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.7, 1.35, 20, 1, true), fieldGreen);
    horn.rotation.x = Math.PI / 2;
    horn.position.z = -0.62;
    hornMount.add(horn);

    const hornInterior = new THREE.Mesh(new THREE.CircleGeometry(0.58, 24), blackCone);
    hornInterior.position.z = -1.305;
    hornMount.add(hornInterior);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.065, 8, 28), accentMaterial);
    rim.position.z = -1.32;
    hornMount.add(rim);
    speakerRims.push(rim);

    const rearDriver = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.42, 14), darkMetal);
    rearDriver.rotation.x = Math.PI / 2;
    rearDriver.position.z = 0.18;
    hornMount.add(rearDriver);
    group.add(hornMount);
  });

  const equalizerBars = [];
  [-0.34, 0, 0.34].forEach((x) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.08), accentMaterial);
    bar.position.set(x, 1.25, -0.48);
    group.add(bar);
    equalizerBars.push(bar);
  });

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 6), darkMetal);
  antenna.position.set(0.68, 5.75, 0.06);
  group.add(antenna);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), accentMaterial);
  beacon.position.set(0.68, 6.56, 0.06);
  group.add(beacon);

  const light = new THREE.PointLight(station.color, 0.6, 13, 2);
  light.position.y = 4.8;
  group.add(light);

  const labelColor = `#${station.color.toString(16).padStart(6, '0')}`;
  const label = makeLabelSprite(`PA-${stationIndex + 1} · ${station.name}`, labelColor);
  label.position.y = 6.95;
  label.scale.set(5.1, 0.95, 1);
  group.add(label);

  placeSurfaceGroup(group, station.normal);
  group.rotateY(stationIndex * 1.37 + 0.35);
  addCollider(station.x, station.z, 1.9);

  station.runtime = {
    group,
    accentMaterial,
    signalRing,
    equalizerBars,
    speakerRims,
    beacon,
    light,
  };
  station.wasInRange = false;
}

SPEAKER_STATIONS.forEach(buildSpeakerStation);

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

  const boulderGeometry = new THREE.IcosahedronGeometry(1, 0);
  const boulderPositions = boulderGeometry.attributes.position;
  for (let index = 0; index < boulderPositions.count; index++) {
    const x = boulderPositions.getX(index);
    const y = boulderPositions.getY(index);
    const z = boulderPositions.getZ(index);
    const irregularity = 0.74 + hash3(x * 8.1 + 4, y * 7.4 - 9, z * 9.3 + 2) * 0.48;
    boulderPositions.setXYZ(index, x * irregularity, y * irregularity, z * irregularity);
  }
  boulderPositions.needsUpdate = true;
  boulderGeometry.computeVertexNormals();

  const boulderCount = isTouchDevice ? 90 : 170;
  const boulders = new THREE.InstancedMesh(
    boulderGeometry,
    new THREE.MeshStandardMaterial({ color: 0x908984, roughness: 0.98, metalness: 0, flatShading: true }),
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

  const ejectaMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8c0b7,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const ejectaCount = isTouchDevice ? 30 : 54;
  const ejecta = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), ejectaMaterial, ejectaCount);
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
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xb8b2aa, roughness: 1, flatShading: true }),
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
  const rayMaterial = new THREE.MeshStandardMaterial({ color: 0xd6d0c7, roughness: 1, flatShading: true });
  const rayFragments = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rayMaterial, rayCount);
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
    new THREE.ConeGeometry(1, 1, 5),
    new THREE.MeshStandardMaterial({ color: 0xd0c9c0, roughness: 0.96, flatShading: true }),
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
    flatShading: true,
  });
  const debris = [];
  let seed = 0xf10a7e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < (isTouchDevice ? 8 : 14); index++) {
    const radius = 1.85 + random() * 3.2;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + random() * 0.38, 0), debrisMaterial);
    rock.scale.set(0.62 + random() * 1.1, 0.72 + random() * 1.5, 0.64 + random() * 1.15);
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

buildMoonCommandPath();
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

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), limbMaterial);
    foot.scale.set(1.1, 0.55, 1.6);
    foot.position.set(0, -shinLen, -0.09);
    shin.add(foot);

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
  const jetpackThrusterLight = new THREE.PointLight(0x59d9ff, 3.2, 8, 2);
  jetpackThrusterLight.position.set(0, 0.82, 0.62);
  thrusterFlames.add(jetpackThrusterLight);
  thrusterFlames.visible = false;
  jetpack.add(thrusterFlames);
  alien.add(jetpack);

  return { alien, legs, arms, body, head, thrusterFlames };
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
  const roverThrusterLight = new THREE.PointLight(0x54d8ff, 5.2, 11, 2);
  roverThrusterLight.position.set(0, -0.55, 0.25);
  roverThrusters.add(roverThrusterLight);
  roverThrusters.visible = false;
  chassis.add(roverThrusters);

  return { rover, chassis, wheelSpinners, frontWheelMounts, driver, roverThrusters };
}

const alienDriver = buildAlien();
const {
  rover: alien,
  chassis: roverChassis,
  wheelSpinners: roverWheels,
  frontWheelMounts,
  roverThrusters,
  driver: { legs, arms },
} = buildMarsRover(alienDriver);

const footRoot = new THREE.Group();
footRoot.name = 'Alien on foot';
footRoot.visible = false;
scene.add(footRoot);

let travelMode = 'driving';
let currentWorld = 'mars';
let footNormal = START_NORMAL.clone();
let footHeading = new THREE.Vector3(0, 0, -1);
let footSpeed = 0;
let footJumpHeight = 0;
let footVerticalVelocity = 0;
let footGrounded = true;
const FOOT_THRUSTER_FUEL_MAX = 3.2;
const ROVER_THRUSTER_FUEL_MAX = 5.5;
const ROVER_HOVER_HEIGHT = 14;
const ROVER_MAX_LIFT_ACCELERATION = 25.5;
const ROVER_LIFT_SPOOL_UP = 5.8;
const ROVER_LIFT_SPOOL_DOWN = 13;
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

function updateAudioIndicator() {
  audioToggleEl.classList.toggle('audio-live', audioStarted && audioEnabled);
  audioToggleEl.setAttribute('aria-pressed', String(audioEnabled));
  audioStateEl.textContent = !audioStarted ? 'TAP TO START' : audioEnabled ? 'ON' : 'OFF';
  audioToggleEl.setAttribute(
    'aria-label',
    !audioStarted ? 'Start Mars soundscape' : audioEnabled ? 'Mute Mars soundscape' : 'Enable Mars soundscape'
  );
}

function createBrownNoiseBuffer(context, seconds = 5) {
  const frameCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let lastSample = 0;
  for (let i = 0; i < frameCount; i++) {
    const white = Math.random() * 2 - 1;
    lastSample = (lastSample + white * 0.025) / 1.025;
    samples[i] = lastSample * 3.2;
  }
  return buffer;
}

function createWhiteNoiseBuffer(context, seconds = 3) {
  const frameCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

function createChillHopBuffer(context) {
  const bpm = 72;
  const beatDuration = 60 / bpm;
  const duration = beatDuration * 32;
  const frameCount = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  const roots = [110, 98, 82.41, 92.5];
  const melody = [2, 2.244, 2.52, 2.244, 2, 1.887, 1.682, 1.887, 2, 2.52, 2.244, 1.887, 1.682, 1.498, 1.682, 1.887];
  let noiseSeed = 0x325a91;
  let previousNoise = 0;

  for (let i = 0; i < frameCount; i++) {
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
  return buffer;
}

function buildSpeakerStationAudio(context, output) {
  const now = context.currentTime;
  const stationInputs = [];
  SPEAKER_STATIONS.forEach((station) => {
    const proximityGain = context.createGain();
    proximityGain.gain.setValueAtTime(0, now);
    proximityGain.connect(output);
    const panner = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    panner.connect(proximityGain);
    stationInputs.push(panner);
    station.audio = { proximityGain, panner };
  });

  const chillSource = context.createBufferSource();
  chillSource.buffer = createChillHopBuffer(context);
  chillSource.loop = true;
  const chillFilter = context.createBiquadFilter();
  chillFilter.type = 'lowpass';
  chillFilter.frequency.setValueAtTime(2400, now);
  chillFilter.Q.setValueAtTime(0.55, now);
  const chillLevel = context.createGain();
  chillLevel.gain.setValueAtTime(1.05, now);
  chillSource.connect(chillFilter).connect(chillLevel);
  stationInputs.forEach((input) => chillLevel.connect(input));
  chillSource.start(now);
}

function buildAudioSystem() {
  if (audioContext) return true;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    audioEnabled = false;
    audioStateEl.textContent = 'N/A';
    audioToggleEl.disabled = true;
    audioToggleEl.setAttribute('aria-pressed', 'false');
    return false;
  }

  audioContext = new AudioContextClass();
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

  buildSpeakerStationAudio(audioContext, audioMasterGain);

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
  noiseSource.buffer = createBrownNoiseBuffer(audioContext);
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
  thrusterNoiseSource.buffer = createWhiteNoiseBuffer(audioContext);
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
  return true;
}

async function ensureMarsAudio() {
  if (!audioEnabled || !buildAudioSystem()) return;
  try {
    const wasStarted = audioStarted;
    if (audioContext.state !== 'running') await audioContext.resume();
    audioStarted = audioContext.state === 'running';
    const now = audioContext.currentTime;
    audioMasterGain.gain.cancelScheduledValues(now);
    audioMasterGain.gain.setTargetAtTime(0.78, now, 0.22);
    updateAudioIndicator();
    if (audioStarted && !wasStarted) showBanner('PA NETWORK ONLINE · MUSIC ACTIVE');
  } catch (error) {
    console.warn('Mars audio could not start:', error);
  }
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
  const speedRatio = THREE.MathUtils.clamp(Math.abs(speed) / maxForwardSpeed, 0, 1);
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

const stationAudioTangent = new THREE.Vector3();
const stationAudioRight = new THREE.Vector3();

function updateSpeakerStations(time, listenerNormal, listenerHeading) {
  let strongestSignal = 0;
  const hasMarsListener = Boolean(listenerNormal && listenerHeading);
  if (hasMarsListener) stationAudioRight.copy(listenerHeading).cross(listenerNormal).normalize();

  SPEAKER_STATIONS.forEach((station, stationIndex) => {
    const distance = hasMarsListener ? geodesicDistance(listenerNormal, station.normal) : Infinity;
    const proximity = 1 - THREE.MathUtils.smoothstep(distance, 7.5, station.hearingRadius);
    const signal = Math.pow(THREE.MathUtils.clamp(proximity, 0, 1), 1.45);
    strongestSignal = Math.max(strongestSignal, signal);
    station.proximity = proximity;

    const pulse = 0.5 + Math.sin(time * (1.9 + stationIndex * 0.13) + stationIndex * 1.7) * 0.5;
    const visualEnergy = 0.16 + signal * 0.84;
    station.runtime.accentMaterial.emissiveIntensity = 0.38 + pulse * 0.16 + signal * 1.85;
    station.runtime.light.intensity = 0.18 + pulse * 0.18 + signal * 2.7;
    station.runtime.signalRing.scale.setScalar(1 + pulse * 0.018 + signal * 0.055);
    station.runtime.beacon.scale.setScalar(0.86 + pulse * 0.18 + signal * 0.34);
    station.runtime.equalizerBars.forEach((bar, barIndex) => {
      const beat = 0.5 + Math.sin(time * (2.15 + barIndex * 0.34) + stationIndex + barIndex * 1.2) * 0.5;
      bar.scale.y = 0.45 + beat * (0.28 + visualEnergy * 0.9);
    });
    station.runtime.speakerRims.forEach((rim, rimIndex) => {
      const throb = Math.max(0, Math.sin(time * (2.4 + stationIndex * 0.08) + rimIndex * 0.7));
      rim.scale.setScalar(1 + throb * signal * 0.045);
    });

    if (station.audio && audioStarted && audioEnabled && audioContext.state === 'running') {
      const now = audioContext.currentTime;
      const targetGain = signal > 0.0005 ? signal * 0.22 : 0;
      station.audio.proximityGain.gain.setTargetAtTime(targetGain, now, signal > 0 ? 0.16 : 0.28);
      if (hasMarsListener && station.audio.panner.pan) {
        stationAudioTangent.copy(station.normal).addScaledVector(listenerNormal, -station.normal.dot(listenerNormal)).normalize();
        const pan = THREE.MathUtils.clamp(stationAudioTangent.dot(stationAudioRight), -0.82, 0.82);
        station.audio.panner.pan.setTargetAtTime(pan, now, 0.14);
      }
    }

    if (proximity > 0.16 && !station.wasInRange) {
      station.wasInRange = true;
      showBanner(audioStarted ? `PA BROADCAST ACQUIRED · ${station.name}` : 'TAP AUDIO · PA MUSIC IN RANGE');
    } else if (proximity < 0.025) {
      station.wasInRange = false;
    }
  });

  if (ambientBusGain && audioStarted && audioEnabled && audioContext.state === 'running') {
    ambientBusGain.gain.setTargetAtTime(0.052 - strongestSignal * 0.03, audioContext.currentTime, 0.35);
  }
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
let lookingAtCamera = false;
let jumpQueued = false;
let interactionQueued = false;
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;
  if (key === 'f' && !e.repeat) lookingAtCamera = !lookingAtCamera;
  if (key === 'e' && !e.repeat) interactionQueued = true;
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

/* ---------- portfolio panel ---------- */

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
];

const portfolioPanelEl = document.getElementById('portfolio-panel');
const portfolioGridEl = document.getElementById('portfolio-grid');
PROJECTS.forEach((p) => {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.innerHTML = `<h3>${p.title}</h3><p>${p.desc}</p><a href="${p.url}" target="_blank" rel="noopener noreferrer">${p.label}</a>`;
  portfolioGridEl.appendChild(card);
});
const PORTFOLIO_HUB_KEY = 'outpost';
const PORTFOLIO_REVEAL_RADIUS = 13;

const CONTACT_LINKS = [
  { label: 'Email', desc: 'baxc1722@gmail.com', url: 'mailto:baxc1722@gmail.com' },
  { label: 'GitHub', desc: 'github.com/HuskyWusky158', url: 'https://github.com/HuskyWusky158' },
  { label: 'LinkedIn', desc: 'linkedin.com/in/caitlinbax325', url: 'https://www.linkedin.com/in/caitlinbax325/' },
  { label: 'Resume', desc: 'Download PDF', url: 'https://caitlin-portfolio-weld.vercel.app/resume.pdf' },
];

const contactPanelEl = document.getElementById('contact-panel');
const contactGridEl = document.getElementById('contact-grid');
CONTACT_LINKS.forEach((c) => {
  const card = document.createElement('div');
  card.className = 'project-card contact-card';
  card.innerHTML = `<h3>${c.label}</h3><p>${c.desc}</p><a href="${c.url}" target="_blank" rel="noopener noreferrer">Open</a>`;
  contactGridEl.appendChild(card);
});
const CONTACT_HUB_KEY = 'cavern';
const CONTACT_REVEAL_RADIUS = 13;

/* ---------- HUD ---------- */

const hubListEl = document.getElementById('hub-list');
HUBS.forEach((hub) => {
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
  row.classList.add('found');
  row.querySelector('.mark').innerHTML = '&#10003;';
  showBanner(`Discovered: ${hub.name}`);
}

const locationLabelEl = document.getElementById('location-label');
const controlsHintEl = document.getElementById('controls-hint');
const gravityValueEl = document.getElementById('gravity-value');
const interactionPromptEl = document.getElementById('interaction-prompt');
const shuttleStatusEl = document.getElementById('shuttle-status');
const shuttleStatusTextEl = document.getElementById('shuttle-status-text');
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

function exitRover() {
  if (caveTravelZone !== 'surface') {
    showBanner('CAVE ROAD SAFETY · EXIT ROVER ON THE SURFACE');
    return;
  }
  if (Math.abs(driveSpeed) > 1.2 || !grounded) {
    showBanner('STOP ROVER TO EXIT');
    return;
  }
  const exitDirection = playerHeading.clone().cross(playerNormal).normalize();
  const exitNormal = stepWorldNormal(playerNormal, exitDirection, 2.75, PLANET_RADIUS);
  attachAlienOnFoot('mars', exitNormal, playerHeading);
  travelMode = 'walking';
  driveSpeed = 0;
  showBanner('ROVER PARKED · ALIEN ON FOOT');
}

function enterRover() {
  roverChassis.add(alienDriver.alien);
  footRoot.visible = false;
  poseAlienForRover();
  travelMode = 'driving';
  currentWorld = 'mars';
  showBanner('ALIEN BACK IN THE G-ROVER');
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
  } else if (currentWorld === shuttleLocation) {
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
    exitRover();
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

  if (currentWorld === 'mars' && arcDistanceForWorld('mars', footNormal, playerNormal) < 3.8) {
    enterRover();
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

function isPlayerNearLandedShuttle() {
  if (travelMode === 'boarded') return true;
  if (shuttleTransit || shuttleLocation !== currentWorld) return false;
  if (travelMode === 'driving' && shuttleLocation === 'mars') {
    return geodesicDistance(playerNormal, MARS_PORT.normal) < SHUTTLE_STATUS_RADIUS;
  }
  if (travelMode === 'walking') {
    const padNormal = currentWorld === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
    return arcDistanceForWorld(currentWorld, footNormal, padNormal) < SHUTTLE_STATUS_RADIUS;
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
    } else if (currentWorld === shuttleLocation) {
      showBanner(`SPACE BUS LANDED · DEPARTS IN 10 SEC`);
    }
  }
}

function updateOnFoot(dt, time, throttleInput, steeringInput) {
  const radius = currentWorld === 'moon' ? MOON_RADIUS : currentWorld === 'zephyra' ? ZEPHYRA_RADIUS : PLANET_RADIUS;
  const walkTarget = throttleInput * (currentWorld === 'moon' ? 3.8 : currentWorld === 'zephyra' ? 4.4 : 4.8);
  footSpeed = THREE.MathUtils.damp(footSpeed, walkTarget, throttleInput === 0 ? 6 : 8, dt);
  footHeading.applyAxisAngle(footNormal, steeringInput * 2.15 * dt).normalize();

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

  if (jumpQueued && footGrounded) {
    footVerticalVelocity = 1.35;
    footGrounded = false;
    footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
    showBanner('JETPACK FIRING · RELEASE SPACE TO DROP');
  }
  jumpQueued = false;
  const footThrusterHeld = Boolean(keys[' '] || keys.space || keys.spacebar);
  const footThrusterActive = !footGrounded && footThrusterHeld && footThrusterFuel > 0;
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

  footRoot.position.copy(surfacePositionForWorld(currentWorld, footNormal, footJumpHeight + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);
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

  const walkAmount = THREE.MathUtils.clamp(Math.abs(footSpeed) / 4.8, 0, 1);
  const stride = Math.sin(time * (5.6 + walkAmount * 3.2)) * walkAmount;
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
  alienDriver.alien.rotation.z = -steeringInput * 0.06 + Math.sin(time * 2.1) * 0.012
    + (footThrusterActive ? Math.sin(time * 71) * 0.022 : 0);
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.8) * 0.018;
}

function updateTravelPrompt() {
  if (travelMode === 'driving') {
    if (caveTravelZone === 'tunnel') setInteractionPrompt('FOLLOW GLOWSTONE ROAD · REVERSE TO RETURN TO MARS');
    else if (caveTravelZone === 'chamber') setInteractionPrompt(`MORROW: ${hubRuntime.nightfall.bearActivity.toUpperCase()} · FIND THE LIT TUNNEL TO EXIT`);
    else setInteractionPrompt(Math.abs(driveSpeed) < 1.2 && grounded ? 'E · EXIT G-ROVER' : 'STOP TO EXIT G-ROVER');
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
  } else if (currentWorld === 'mars' && arcDistanceForWorld('mars', footNormal, playerNormal) < 3.8) {
    setInteractionPrompt('E · ENTER G-ROVER');
  } else {
    setInteractionPrompt('WASD · WALK  /  E · USE');
  }
}

/* ---------- camera state ---------- */

const camLookTarget = alien.position.clone();
const interiorCameraSide = new THREE.Vector3();
const caveCameraLocal = new THREE.Vector3();
const caveCameraTangent = new THREE.Vector3();
const caveCameraRight = new THREE.Vector3();
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

function spawnWheelDust(dt, speed) {
  dustSpawnAccumulator += dt * Math.min(36, 5 + Math.abs(speed) * 2.4);
  const forward = playerHeading;
  const right = playerHeading.clone().cross(playerNormal).normalize();
  const groundPoint = surfaceWorldPosition(playerNormal, 0.35);
  while (dustSpawnAccumulator >= 1) {
    dustSpawnAccumulator -= 1;
    const index = nextDustParticle++ % wheelDustCount;
    const side = Math.random() < 0.5 ? -1 : 1;
    const position = groundPoint.clone().addScaledVector(forward, -1.5).addScaledVector(right, side * 1.22 + (Math.random() - 0.5) * 0.45);
    wheelDustPositions[index * 3] = position.x;
    wheelDustPositions[index * 3 + 1] = position.y;
    wheelDustPositions[index * 3 + 2] = position.z;
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

moonSurface.castShadow = true;
moonSurface.receiveShadow = true;
configureLunarShadows(moonRegolithGeology.group);
configureLunarShadows(moonColdTrapRuntime.group);
moonColdTrapRuntime.ejecta.castShadow = false;
configureLunarShadows(moonRayedCraterRuntime.group);
moonRayedCraterRuntime.rayFragments.castShadow = false;
configureLunarShadows(moonLandingPad.group);
configureLunarShadows(moonBikeLandingPad.group);
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

  moonLightingBlend = THREE.MathUtils.damp(moonLightingBlend, targetBlend, 3.2, dt);
  moonSunLight.intensity = moonLightingBlend * 2.65;
  moonSunLight.visible = moonLightingBlend > 0.004;
  moonBounceLight.intensity = moonLightingBlend * 0.2;
  moonEarthLight.intensity = moonLightingBlend * 0.14;
  hemisphereLight.intensity = THREE.MathUtils.lerp(0.85, 0.1, moonLightingBlend);
  sunLight.intensity = THREE.MathUtils.lerp(1.8, 0.08, moonLightingBlend);
  ambientLight.intensity = THREE.MathUtils.lerp(0.16, 0.025, moonLightingBlend);
  moonSurface.material.emissiveIntensity = THREE.MathUtils.lerp(0.22, 0.025, moonLightingBlend);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, 0.98, moonLightingBlend);

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

/* ---------- animation loop ---------- */

const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const backVec = new THREE.Vector3();
const travelAxis = new THREE.Vector3();
const orientationMatrix = new THREE.Matrix4();
const targetRoverQuaternion = new THREE.Quaternion();
const maxForwardSpeed = 16;
const maxReverseSpeed = 8;
const turnSpeed = 1.65;
const roverRadius = 1.45;
const marsGravity = -3.73;
let driveSpeed = 0;
let verticalVelocity = 0;
let jumpHeight = 0;
let grounded = true;
let suspensionPhase = 0;

const speedValueEl = document.getElementById('speed-value');
const elevationValueEl = document.getElementById('elevation-value');

const clock = new THREE.Clock();

function steppedSurfaceNormal(normal, direction, distance) {
  const axis = new THREE.Vector3().crossVectors(normal, direction).normalize();
  return normal.clone().applyAxisAngle(axis, distance / PLANET_RADIUS).normalize();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const throttleInput = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
  const steeringInput = (keys['a'] || keys['arrowleft'] ? 1 : 0) - (keys['d'] || keys['arrowright'] ? 1 : 0);
  const thrusterHeld = Boolean(keys[' '] || keys.space || keys.spacebar);
  handleInteraction();
  updateShuttleFlight(dt, t);
  updateHyperBikeTravel(dt, t);

  if (travelMode === 'driving') {
    const caveSpeedLimit = caveTravelZone === 'surface' ? maxForwardSpeed : CAVE_TUNNEL_MAX_SPEED;
    const targetSpeed = throttleInput > 0 ? caveSpeedLimit : throttleInput < 0 ? -Math.min(maxReverseSpeed, caveSpeedLimit * 0.72) : 0;
    const acceleration = throttleInput === 0 ? 3.3 : driveSpeed * throttleInput < 0 ? 11 : 5.8;
    driveSpeed = THREE.MathUtils.damp(driveSpeed, targetSpeed, acceleration, dt);
    if (Math.abs(driveSpeed) < 0.015) driveSpeed = 0;
    updateRoverAudio(driveSpeed, throttleInput);

    const steerStrength = THREE.MathUtils.clamp(Math.abs(driveSpeed) / 3.2, 0.2, 1);
    const reverseSteer = driveSpeed < -0.1 ? -1 : 1;
    frontWheelMounts.forEach((mount) => {
      mount.rotation.y = THREE.MathUtils.damp(mount.rotation.y, steeringInput * 0.42, 10, dt);
    });

    if (
      caveTravelZone === 'surface'
      && driveSpeed > 0.35
      && playerHeading.dot(CAVE_INWARD_HEADING) > 0.28
      && geodesicDistance(playerNormal, NIGHTFALL_CAVE.normal) < 4.6
    ) enterNightfallDescent();

    if (caveTravelZone === 'surface') {
      playerHeading.applyAxisAngle(playerNormal, steeringInput * reverseSteer * turnSpeed * steerStrength * dt).normalize();
      forwardVec.copy(playerHeading);
      rightVec.copy(playerHeading).cross(playerNormal).normalize();
      const arcDistance = driveSpeed * dt;
      travelAxis.crossVectors(playerNormal, playerHeading).normalize();
      const candidateNormal = playerNormal.clone().applyAxisAngle(travelAxis, arcDistance / PLANET_RADIUS).normalize();
      const candidateHeading = playerHeading.clone().applyAxisAngle(travelAxis, arcDistance / PLANET_RADIUS).normalize();
      const blocked = obstacles.some((obstacle) => geodesicDistance(candidateNormal, obstacle.normal) < obstacle.radius + roverRadius);
      if (!blocked) {
        playerNormal.copy(candidateNormal);
        playerHeading.copy(candidateHeading).addScaledVector(playerNormal, -candidateHeading.dot(playerNormal)).normalize();
      } else driveSpeed *= -0.08;
    } else {
      updateCaveNavigation(dt, steeringInput);
    }

    if (jumpQueued && grounded) {
      verticalVelocity = 0.8;
      grounded = false;
      roverThrusterFuel = ROVER_THRUSTER_FUEL_MAX;
      roverLiftSpool = Math.max(roverLiftSpool, 0.18);
      showBanner('G-ROVER LIFT FANS SPOOLING · RELEASE TO DROP');
    }
    jumpQueued = false;
    const roverThrusterRequested = !grounded && thrusterHeld && roverThrusterFuel > 0;
    roverLiftSpool = THREE.MathUtils.clamp(
      roverLiftSpool + (roverThrusterRequested ? ROVER_LIFT_SPOOL_UP : -ROVER_LIFT_SPOOL_DOWN) * dt,
      0,
      1
    );
    const roverThrusterActive = roverThrusterRequested && roverLiftSpool > 0.015;
    const roverThrusterPulse = roverThrusterActive
      ? (Math.sin(t * 29.5) > -0.12 ? 1 : 0.14) * (Math.sin(t * 67) > 0.25 ? 1 : 0.74)
      : 0;
    if (roverThrusterWasActive && !roverThrusterRequested && !grounded) {
      verticalVelocity = Math.min(verticalVelocity, -2.8);
      if (jumpHeight > 0.9) showBanner('THRUST CUT · HARD DROP');
    }
    roverThrusterWasActive = roverThrusterRequested;
    roverThrusters.visible = roverLiftSpool > 0.025;
    if (roverThrusterActive) {
      roverThrusterFuel = Math.max(0, roverThrusterFuel - dt);
      const hoverError = THREE.MathUtils.clamp((ROVER_HOVER_HEIGHT - jumpHeight) / ROVER_HOVER_HEIGHT, -0.65, 1);
      const liftCommand = THREE.MathUtils.clamp(0.18 + hoverError * 0.72 - verticalVelocity * 0.07, 0, 1);
      const groundEffect = 1 + Math.max(0, 1 - jumpHeight / 5) * 0.28;
      const fanTurbulence = Math.sin(t * 41) * 0.25 + Math.sin(t * 73) * 0.14;
      const pulseEfficiency = 0.78 + roverThrusterPulse * 0.22;
      const liftAcceleration = ROVER_MAX_LIFT_ACCELERATION * liftCommand * groundEffect * roverLiftSpool * pulseEfficiency + fanTurbulence;
      verticalVelocity = Math.min(11.5, verticalVelocity + liftAcceleration * dt);
      roverThrusters.scale.y = (0.3 + roverThrusterPulse * 0.82) * (0.45 + roverLiftSpool * 0.55);
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
        roverThrusters.visible = false;
        roverChassis.position.y = 0.16;
      }
    } else {
      roverThrusterFuel = Math.min(ROVER_THRUSTER_FUEL_MAX, roverThrusterFuel + dt * 1.7);
    }

    const frontHeight = caveTravelZone === 'surface' ? getSurfaceHeight(steppedSurfaceNormal(playerNormal, playerHeading, 1.45)) : 0;
    const rearHeight = caveTravelZone === 'surface' ? getSurfaceHeight(steppedSurfaceNormal(playerNormal, playerHeading, -1.45)) : 0;
    const rightHeight = caveTravelZone === 'surface' ? getSurfaceHeight(steppedSurfaceNormal(playerNormal, rightVec, 1.25)) : 0;
    const leftHeight = caveTravelZone === 'surface' ? getSurfaceHeight(steppedSurfaceNormal(playerNormal, rightVec, -1.25)) : 0;
    const targetPitch = grounded ? Math.atan2(frontHeight - rearHeight, 2.9) : -verticalVelocity * 0.018 + (roverThrusterActive ? Math.sin(t * 57) * 0.012 : 0);
    const targetRoll = grounded
      ? Math.atan2(rightHeight - leftHeight, 2.5) - steeringInput * driveSpeed * 0.0045
      : roverThrusterActive ? Math.sin(t * 48) * 0.034 + Math.sin(t * 21) * 0.012 : 0;
    roverChassis.rotation.x = THREE.MathUtils.damp(roverChassis.rotation.x, targetPitch, 7, dt);
    roverChassis.rotation.z = THREE.MathUtils.damp(roverChassis.rotation.z, targetRoll, 7, dt);

    suspensionPhase += Math.abs(driveSpeed) * dt * 1.8;
    const roadBuzz = grounded ? Math.sin(suspensionPhase) * Math.min(0.055, Math.abs(driveSpeed) * 0.004) : 0;
    const fanBuzz = roverLiftSpool > 0.015
      ? (Math.sin(t * 55) * 0.025 + Math.sin(t * 91) * 0.012) * roverLiftSpool
      : 0;
    roverChassis.position.y = THREE.MathUtils.damp(roverChassis.position.y, roadBuzz + fanBuzz, grounded ? 9 : 8, dt);

    if (caveTravelZone === 'surface') {
      rightVec.copy(playerHeading).cross(playerNormal).normalize();
      backVec.copy(playerHeading).multiplyScalar(-1);
      orientationMatrix.makeBasis(rightVec, playerNormal, backVec);
      targetRoverQuaternion.setFromRotationMatrix(orientationMatrix);
      alien.quaternion.slerp(targetRoverQuaternion, 1 - Math.exp(-dt * 12));
      alien.position.copy(playerNormal).multiplyScalar(PLANET_RADIUS + getSurfaceHeight(playerNormal) + jumpHeight);
    } else placeCaveRover(dt);

    roverWheels.forEach((wheel) => {
      wheel.rotation.x -= driveSpeed * dt / 0.79;
    });
    arms.forEach((arm, index) => {
      arm.upper.rotation.x = 1.12 + Math.sin(t * 2.2 + index) * Math.min(0.08, Math.abs(driveSpeed) * 0.006);
      arm.fore.rotation.x = 0.34 + steeringInput * (index === 0 ? -0.2 : 0.2);
    });
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.018;
    alienDriver.alien.rotation.z = Math.sin(t * 0.72) * 0.018 - steeringInput * 0.018;
    if (caveTravelZone === 'surface' && grounded && Math.abs(driveSpeed) > 1.4) spawnWheelDust(dt, driveSpeed);
  } else if (travelMode === 'walking') {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    updateRoverAudio(0, 0);
    frontWheelMounts.forEach((mount) => {
      mount.rotation.y = THREE.MathUtils.damp(mount.rotation.y, 0, 8, dt);
    });
    updateOnFoot(dt, t, throttleInput, steeringInput);
  } else {
    driveSpeed = THREE.MathUtils.damp(driveSpeed, 0, 8, dt);
    updateRoverAudio(0, 0);
    jumpQueued = false;
    updateThrusterAudio(false, false, 0);
    roverThrusters.visible = false;
    alienDriver.thrusterFlames.visible = false;
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.012;
  }

  updateWheelDust(dt);
  updateMoonFootDust(dt);

  const activeMarsNormal = travelMode === 'driving' && caveTravelZone === 'surface' ? playerNormal : travelMode === 'walking' && currentWorld === 'mars' ? footNormal : null;
  const activeMarsHeading = travelMode === 'driving' && caveTravelZone === 'surface' ? playerHeading : travelMode === 'walking' && currentWorld === 'mars' ? footHeading : null;
  const activeMarsAltitude = travelMode === 'driving' ? jumpHeight : travelMode === 'walking' && currentWorld === 'mars' ? footJumpHeight : 0;
  const activeMoonNormal = travelMode === 'walking' && currentWorld === 'moon' ? footNormal : null;
  const activeZephyraNormal = travelMode === 'walking' && currentWorld === 'zephyra' ? footNormal : null;
  updateSpeakerStations(t, activeMarsNormal, activeMarsHeading);
  updateLunarLighting(dt, t);
  updateMarsDustFront(dt, t, activeMarsNormal);
  updateMarsSedimentaryEscarpment(dt, t, activeMarsNormal);
  updateMarsYardangField(dt, t, activeMarsNormal);
  updateMarsImpactBasin(dt, t, activeMarsNormal);
  updateMoonCommandCenter(dt, t, activeMoonNormal);
  updateMoonFriend(dt, t, activeMoonNormal);
  updateMoonColdTrap(dt, t, activeMoonNormal);
  updateMoonRayedCrater(dt, t, activeMoonNormal);
  updateZephyraStorm(dt, t, activeZephyraNormal);
  updateZephyraIonCanyon(dt, t, activeZephyraNormal);
  updateZephyraFluxWell(dt, t, activeZephyraNormal);
  updateZephyraAuroralSquall(dt, t, activeZephyraNormal);
  updateZephyraPiezoelectricGrove(dt, t, activeZephyraNormal);
  updateNightfallWorld(dt, t);
  updateCaveAtmosphere(dt, activeMarsNormal, activeMarsAltitude);

  if (activeMarsNormal) for (const hub of HUBS) {
    if (!hub.discovered && geodesicDistance(activeMarsNormal, hub.normal) < hub.trigger) {
      discoverHub(hub);
    }
  }

  const portfolioHub = HUBS.find((h) => h.key === PORTFOLIO_HUB_KEY);
  const nearPortfolio = activeMarsNormal && geodesicDistance(activeMarsNormal, portfolioHub.normal) < PORTFOLIO_REVEAL_RADIUS;
  portfolioPanelEl.classList.toggle('show', nearPortfolio);

  const contactHub = HUBS.find((h) => h.key === CONTACT_HUB_KEY);
  const nearContact = activeMarsNormal && geodesicDistance(activeMarsNormal, contactHub.normal) < CONTACT_REVEAL_RADIUS;
  contactPanelEl.classList.toggle('show', nearContact);

  const downedUfo = hubRuntime.outpost;
  downedUfo.rimLights.forEach((light, index) => {
    const flicker = light.damaged
      ? (Math.sin(t * (17 + index)) > 0.58 ? 1 : 0.03)
      : 0.72 + Math.sin(t * 2.4 + light.phase) * 0.28;
    light.material.emissiveIntensity = 0.12 + flicker * 1.85;
  });
  downedUfo.interiorLight.intensity = 2.5 + Math.sin(t * 12.7) * 0.85 + Math.sin(t * 31) * 0.28;
  downedUfo.breachGlow.material.opacity = 0.54 + Math.sin(t * 8.4) * 0.18;
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
      1.3 + Math.cos(spark.phase) * spark.radius * sparkAge
    );
    spark.mesh.scale.setScalar(0.45 + burst * 1.35);
  });

  const cavern = hubRuntime.cavern;
  cavern.crystalMaterials.forEach((mat, i) => {
    mat.emissiveIntensity = 0.5 + Math.sin(t * 1.5 + i) * 0.15;
  });

  const crash = hubRuntime.crash;
  crash.light.intensity = 2.2 + Math.sin(t * 13) * 0.4 + (Math.random() - 0.5) * 0.3;
  const sp = crash.smoke.geometry.attributes.position;
  for (let i = 0; i < crash.smokeSpeeds.length; i++) {
    const idx = i * 3 + 1;
    sp.array[idx] += dt * crash.smokeSpeeds[i];
    if (sp.array[idx] - crash.smokeBases[idx] > 6) sp.array[idx] = crash.smokeBases[idx];
  }
  sp.needsUpdate = true;

  airborneDust.rotation.y += dt * 0.014;
  airborneDust.rotation.z += dt * 0.003;
  updateAeolianSaltation(t);
  marsLandingPad.glowMaterial.emissiveIntensity = 1.05 + Math.sin(t * 2.2) * 0.32;
  moonLandingPad.glowMaterial.emissiveIntensity = 0.9 + Math.sin(t * 1.7 + 1.3) * 0.26;
  moonBikeLandingPad.glowMaterial.emissiveIntensity = 1.15 + Math.sin(t * 3.1) * 0.38;
  zephyraBikeLandingPad.glowMaterial.emissiveIntensity = 1.1 + Math.sin(t * 2.8 + 1.2) * 0.34;

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

  sunMaterial.uniforms.uTime.value = t;
  distortedSun.lookAt(camera.position);
  updateShootingStar(t);

  let desiredCamPos;
  let desiredTarget;
  let desiredCameraUp;
  if (travelMode === 'driving') {
    if (caveTravelZone === 'tunnel') {
      const cameraOffset = lookingAtCamera ? -5.5 : 8.2;
      const cameraDistance = THREE.MathUtils.clamp(caveRouteDistance - caveRouteFacing * cameraOffset, 0, CAVE_ROUTE_LENGTH);
      const cameraRatio = cameraDistance / CAVE_ROUTE_LENGTH;
      caveCameraLocal.copy(CAVE_ROUTE_CURVE.getPointAt(cameraRatio));
      caveCameraTangent.copy(CAVE_ROUTE_CURVE.getTangentAt(cameraRatio)).normalize();
      caveCameraRight.crossVectors(caveCameraTangent, UP).normalize();
      caveCameraLocal.addScaledVector(caveCameraRight, caveLateral).addScaledVector(UP, lookingAtCamera ? 3.5 : 4.1);
      desiredCamPos = caveCameraLocal.clone();
      hubRuntime.nightfall.group.localToWorld(desiredCamPos);
      desiredTarget = alien.position.clone().addScaledVector(caveWorldUp, 1.8).addScaledVector(caveWorldForward, lookingAtCamera ? -2.4 : 3.4);
      desiredCameraUp = caveWorldUp;
    } else if (caveTravelZone === 'chamber') {
      const cameraHeight = lookingAtCamera ? 8.2 : 10.8;
      const cameraTrail = lookingAtCamera ? 10 : -14;
      desiredCamPos = alien.position.clone().addScaledVector(caveWorldUp, cameraHeight).addScaledVector(caveWorldForward, cameraTrail);
      if (!lookingAtCamera) desiredCamPos.addScaledVector(caveWorldRight, 3.2);
      desiredTarget = alien.position.clone().addScaledVector(caveWorldUp, 2.1).addScaledVector(caveWorldForward, 6);
      desiredCameraUp = caveWorldUp;
    } else {
      const cameraHeight = lookingAtCamera ? 15 : 20;
      const cameraTrail = lookingAtCamera ? 13 : -18;
      desiredCamPos = alien.position.clone().addScaledVector(playerNormal, cameraHeight).addScaledVector(playerHeading, cameraTrail);
      desiredTarget = alien.position.clone().addScaledVector(playerNormal, 2.2).addScaledVector(playerHeading, lookingAtCamera ? 0 : 3.2);
      desiredCameraUp = playerNormal;
    }
  } else if (travelMode === 'walking') {
    const interiorCameraBlend = Math.max(caveDarkness, moonCommandInterior);
    let cameraHeight = THREE.MathUtils.lerp(lookingAtCamera ? 8.5 : 10.5, lookingAtCamera ? 4.3 : 4.6, interiorCameraBlend);
    let cameraTrail = THREE.MathUtils.lerp(lookingAtCamera ? 8 : -11, lookingAtCamera ? 6.2 : -7.5, interiorCameraBlend);
    cameraHeight = THREE.MathUtils.lerp(cameraHeight, lookingAtCamera ? 4.7 : 4.65, moonCommandInterior);
    cameraTrail = THREE.MathUtils.lerp(cameraTrail, lookingAtCamera ? 4.2 : -2.8, moonCommandInterior);
    const commandTargetHeight = THREE.MathUtils.lerp(2.2, 2.5, moonCommandInterior);
    const commandTargetLead = THREE.MathUtils.lerp(lookingAtCamera ? 0 : 2.2, lookingAtCamera ? 0 : 2.8, moonCommandInterior);
    desiredCamPos = footRoot.position.clone()
      .addScaledVector(footNormal, cameraHeight)
      .addScaledVector(footHeading, cameraTrail);
    if (!lookingAtCamera && moonCommandInterior > 0.01) {
      interiorCameraSide.copy(footHeading).cross(footNormal).normalize();
      desiredCamPos.addScaledVector(interiorCameraSide, moonCommandInterior * 2.35);
    }
    desiredTarget = footRoot.position.clone().addScaledVector(footNormal, commandTargetHeight).addScaledVector(footHeading, commandTargetLead);
    desiredCameraUp = footNormal;
  } else if (travelMode === 'hyperbike') {
    if (hyperBikeTransit) {
      desiredCamPos = hyperBike.position.clone()
        .addScaledVector(hyperBikeFlightDirection, -19)
        .addScaledVector(hyperBikeFlightUp, 8.5);
      desiredTarget = hyperBike.position.clone().addScaledVector(hyperBikeFlightDirection, 5.5);
      desiredCameraUp = hyperBikeFlightUp;
    } else {
      const dockNormal = hyperBikeDockNormal(hyperBikeLocation);
      const dockHeading = hyperBikeLocation === 'zephyra' ? ZEPHYRA_BIKE_HEADING : MOON_BIKE_HEADING;
      desiredCamPos = hyperBike.position.clone().addScaledVector(dockNormal, 7.5).addScaledVector(dockHeading, -12);
      desiredTarget = hyperBike.position.clone().addScaledVector(dockNormal, 2.1);
      desiredCameraUp = dockNormal;
    }
  } else {
    if (shuttleTransit) {
      desiredCamPos = moonShuttle.position.clone().addScaledVector(shuttleFlightDirection, -28).addScaledVector(UP, 32);
      desiredTarget = moonShuttle.position.clone().addScaledVector(shuttleFlightDirection, 2.5);
      desiredCameraUp = UP;
    } else {
      const dockNormal = shuttleLocation === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
      const dockHeading = tangentHeadingForNormal(dockNormal);
      desiredCamPos = moonShuttle.position.clone().addScaledVector(dockNormal, 14).addScaledVector(dockHeading, -18);
      desiredTarget = moonShuttle.position.clone().addScaledVector(dockNormal, 3.2);
      desiredCameraUp = dockNormal;
    }
  }
  camera.position.lerp(desiredCamPos, 1 - Math.exp(-dt * (travelMode === 'boarded' || travelMode === 'hyperbike' ? 3.4 : 5.2)));
  camera.up.lerp(desiredCameraUp, 1 - Math.exp(-dt * 7)).normalize();
  camLookTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 8));
  camera.lookAt(camLookTarget);

  const displayedSpeed = travelMode === 'driving'
    ? Math.abs(driveSpeed) * 3.6
    : travelMode === 'walking'
      ? Math.abs(footSpeed) * 3.6
      : travelMode === 'hyperbike' ? hyperBikeDisplaySpeed : shuttleDisplaySpeed;
  speedValueEl.textContent = Math.round(displayedSpeed).toString().padStart(2, '0');
  let elevation = 0;
  if (travelMode === 'driving') elevation = caveTravelZone === 'surface'
    ? getSurfaceHeight(playerNormal) + jumpHeight
    : caveLocalPosition.y + jumpHeight;
  else if (travelMode === 'walking') {
    const surfaceHeight = currentWorld === 'mars'
      ? getSurfaceHeight(footNormal)
      : currentWorld === 'zephyra'
        ? getZephyraHeight(footNormal)
        : getMoonHeight(footNormal);
    elevation = surfaceHeight + footJumpHeight;
  }
  elevationValueEl.textContent = `${elevation >= 0 ? '+' : ''}${elevation.toFixed(1)}`;

  if (travelMode === 'hyperbike' && hyperBikeTransit) {
    locationLabelEl.textContent = `HYPERSPEED CORRIDOR · ${hyperBikeTransit.to.toUpperCase()}`;
    gravityValueEl.textContent = '0.00 G';
    controlsHintEl.textContent = 'VOLT BIKE AUTOPILOT · E trip status';
  } else if (travelMode === 'boarded' && shuttleTransit) {
    locationLabelEl.textContent = 'ARES–LUNA TRANSIT';
    gravityValueEl.textContent = '0.00 G';
    controlsHintEl.textContent = 'SPACE BUS AUTOPILOT · E trip status';
  } else if (travelMode === 'driving' && caveTravelZone !== 'surface') {
    locationLabelEl.textContent = caveTravelZone === 'chamber'
      ? 'THE VASTWATER · UNDERMARS BIOSPHERE'
      : `NIGHTFALL DESCENT · ${Math.round(caveRouteDistance)} / ${Math.round(CAVE_ROUTE_LENGTH)} M`;
    gravityValueEl.textContent = '0.38 G';
    controlsHintEl.textContent = caveTravelZone === 'chamber'
      ? 'WASD / ARROWS explore · follow glowstone road out · F look back'
      : 'W/S descend or reverse · A/D keep between glowstones · F look back';
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
      ? 'WASD / ARROWS drive · HOLD SPACE hover lift · E exit rover · F look back'
      : travelMode === 'walking'
        ? moonCommandInterior > 0.35
          ? 'WASD / ARROWS explore command · E operate consoles · F look back'
          : 'WASD / ARROWS walk · HOLD SPACE jetpack climb · E enter / board · F look back'
        : travelMode === 'hyperbike' ? 'E disembark Volt bike' : 'E disembark space bus';
  }

  if (shuttleTransit) {
    const eta = Math.max(0, Math.ceil(shuttleTransit.duration - shuttleTransit.elapsed));
    shuttleStatusTextEl.textContent = `SPACE BUS · TO ${shuttleTransit.to.toUpperCase()} ${eta} SEC`;
    const routeProgress = THREE.MathUtils.clamp(shuttleTransit.elapsed / shuttleTransit.duration, 0, 1);
    const marsToMoonProgress = shuttleTransit.from === 'mars' ? routeProgress : 1 - routeProgress;
    shuttleRouteBusEl.style.left = `${marsToMoonProgress * 100}%`;
    shuttleStatusEl.classList.remove('urgent');
  } else {
    const remaining = Math.max(1, Math.ceil(shuttleDockTimer));
    shuttleStatusTextEl.textContent = `SPACE BUS · ${shuttleLocation.toUpperCase()} ${remaining} SEC`;
    shuttleRouteBusEl.style.left = shuttleLocation === 'mars' ? '0%' : '100%';
    shuttleStatusEl.classList.toggle('urgent', remaining <= 3);
  }
  shuttleStatusEl.classList.toggle('nearby', isPlayerNearLandedShuttle());

  updateTravelPrompt();

  renderer.render(scene, camera);
}
animate();
