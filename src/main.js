import * as THREE from 'three';
import './style.css';

/* ---------- renderer / scene / camera ---------- */

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add('touch-device');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800);

const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('app').appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- tiny Mars coordinate system ---------- */

const PLANET_RADIUS = 68;
const MOON_RADIUS = 18;
const MOON_CENTER = new THREE.Vector3(54, -48, -285);
const MOON_PAD_NORMAL = MOON_CENTER.clone().negate().normalize();
const UP = new THREE.Vector3(0, 1, 0);
const START_NORMAL = new THREE.Vector3(0, 1, 0);
const playerNormal = START_NORMAL.clone();
const playerHeading = new THREE.Vector3(0, 0, -1);

const HUBS = [
  { key: 'outpost', name: "Caitlin's Projects", x: 46, z: -46, color: 0x6fb8ff, trigger: 13 },
  { key: 'cavern', name: 'Contact Info', x: -46, z: -46, color: 0xb266ff, trigger: 13 },
  { key: 'ruins', name: 'Ancient Ruins', x: 46, z: 46, color: 0xe0a35a, trigger: 13 },
  { key: 'crash', name: 'Crash Site', x: -46, z: 46, color: 0xff6a4a, trigger: 13 },
];

const SPEAKER_STATIONS = [
  { key: 'ion', name: 'ION CHIME', x: -15, z: -24, color: 0x72e6ff, notes: [110, 164.81, 220], wave: 'sine', filter: 720, sweep: 260, lfo: 0.11, delay: 0.44 },
  { key: 'redshift', name: 'RED SHIFT', x: 27, z: -19, color: 0xff806d, notes: [82.41, 123.47, 185], wave: 'sawtooth', filter: 380, sweep: 130, lfo: 0.07, delay: 0.63 },
  { key: 'dust', name: 'DUST CHOIR', x: -31, z: 18, color: 0xc28cff, notes: [98, 146.83, 196], wave: 'triangle', filter: 560, sweep: 220, lfo: 0.09, delay: 0.52 },
  { key: 'bloom', name: 'VOID BLOOM', x: 19, z: 36, color: 0x78ffc1, notes: [73.42, 110, 164.81], wave: 'sine', filter: 840, sweep: 310, lfo: 0.13, delay: 0.36 },
  { key: 'echo', name: 'ORBITAL ECHO', x: 39, z: 10, color: 0xffd36f, notes: [130.81, 196, 261.63], wave: 'triangle', filter: 1050, sweep: 360, lfo: 0.16, delay: 0.71 },
];

const MARS_PORT = { x: 6, z: -10, name: 'ARES–LUNA TRANSFER' };
const SHUTTLE_BOARD_RADIUS = 11;
const SHUTTLE_DOCK_DURATION = 10;
const SHUTTLE_TRAVEL_DURATION = 11.5;

function normalFromSurfaceCoords(x, z) {
  const distance = Math.hypot(x, z);
  if (distance < 0.0001) return START_NORMAL.clone();
  const angle = distance / PLANET_RADIUS;
  const tangent = new THREE.Vector3(x / distance, 0, z / distance);
  return START_NORMAL.clone().multiplyScalar(Math.cos(angle)).add(tangent.multiplyScalar(Math.sin(angle))).normalize();
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
SPEAKER_STATIONS.forEach((station) => {
  station.normal = normalFromSurfaceCoords(station.x, station.z);
  station.hearingRadius = 13.5;
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

const CRATERS = [
  { normal: normalFromSurfaceCoords(10, -17), radius: 0.19, depth: 2.8, rim: 1.25 },
  { normal: normalFromSurfaceCoords(-17, 8), radius: 0.24, depth: 3.4, rim: 1.5 },
  { normal: normalFromSurfaceCoords(8, 17), radius: 0.12, depth: 1.9, rim: 0.8 },
  { normal: new THREE.Vector3(0.72, -0.54, 0.43).normalize(), radius: 0.22, depth: 3.2, rim: 1.35 },
  { normal: new THREE.Vector3(-0.58, -0.35, -0.74).normalize(), radius: 0.28, depth: 3.8, rim: 1.6 },
  { normal: new THREE.Vector3(0.2, -0.91, -0.36).normalize(), radius: 0.16, depth: 2.5, rim: 1.0 },
];

function baseSurfaceHeight(normal) {
  let height = fbm3(normal.x * 2.15 + 3, normal.y * 2.15 - 7, normal.z * 2.15 + 11) * 2.75;
  height += fbm3(normal.x * 6.2 - 9, normal.y * 6.2 + 4, normal.z * 6.2) * 0.68;
  const ridgeNoise = 1 - Math.abs(noise3(normal.x * 5.1, normal.y * 5.1, normal.z * 5.1));
  height += Math.pow(ridgeNoise, 5) * 1.25;
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
let shootingStar;
let shootingStarTrailMaterial;
let shootingStarGlowMaterial;
const shootingStarStart = new THREE.Vector3(-48, -11, -203);
const shootingStarEnd = new THREE.Vector3(48, -34, -184);

function randomUnitVector() {
  const y = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function buildDistantMoon() {
  distantMoon = new THREE.Group();
  distantMoon.position.copy(MOON_CENTER);

  const moon = new THREE.Mesh(
    new THREE.IcosahedronGeometry(MOON_RADIUS, 5),
    new THREE.MeshStandardMaterial({
      color: 0xbfb5ad,
      roughness: 1,
      metalness: 0,
      emissive: 0x241f25,
      emissiveIntensity: 0.22,
      flatShading: false,
    })
  );
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
  const trail = new THREE.Mesh(new THREE.ConeGeometry(1.6, 44, 10, 1, true), shootingStarTrailMaterial);
  trail.position.y = -22;
  shootingStar.add(trail);

  shootingStarGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5fdff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), shootingStarGlowMaterial);
  shootingStar.add(head);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), shootingStarGlowMaterial.clone());
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
    const star = randomUnitVector().multiplyScalar(260 + Math.random() * 130);
    starPositions[i * 3] = star.x;
    starPositions[i * 3 + 1] = star.y;
    starPositions[i * 3 + 2] = star.z;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xf7ecdc, size: 0.65, transparent: true, opacity: 0.92, fog: false })));

  const nebulaCount = isTouchDevice ? 240 : 520;
  const nebulaPositions = new Float32Array(nebulaCount * 3);
  for (let i = 0; i < nebulaCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 315 + (Math.random() - 0.5) * 45;
    nebulaPositions[i * 3] = Math.cos(angle) * radius;
    nebulaPositions[i * 3 + 1] = (Math.random() - 0.5) * 38 + Math.sin(angle * 2) * 16;
    nebulaPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const nebulaGeometry = new THREE.BufferGeometry();
  nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(nebulaPositions, 3));
  const nebula = new THREE.Points(nebulaGeometry, new THREE.PointsMaterial({ color: 0x7b6eb5, size: 2.2, transparent: true, opacity: 0.24, depthWrite: false, fog: false }));
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
  distortedSun = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), sunMaterial);
  distortedSun.position.set(135, 85, -235);
  scene.add(distortedSun);

  buildDistantMoon();
  buildShootingStar();
}
buildSpace();

scene.add(new THREE.HemisphereLight(0xf2a879, 0x120910, 0.85));
const sunLight = new THREE.DirectionalLight(0xffc68f, 1.8);
sunLight.position.set(135, 85, -235);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x9b5970, 0.16));

/* ---------- spherical Mars mesh ---------- */

function buildPlanet() {
  const widthSegments = isTouchDevice ? 76 : 128;
  const heightSegments = isTouchDevice ? 52 : 92;
  const geometry = new THREE.SphereGeometry(PLANET_RADIUS, widthSegments, heightSegments);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const normal = new THREE.Vector3();
  const shadow = new THREE.Color(0x5f2419);
  const dust = new THREE.Color(0xb95431);
  const sunlit = new THREE.Color(0xe28a52);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    normal.fromBufferAttribute(positions, i).normalize();
    const height = getSurfaceHeight(normal);
    const grain = noise3(normal.x * 62, normal.y * 62, normal.z * 62) * 0.5 + 0.5;
    const altitude = THREE.MathUtils.clamp((height + 4) / 9, 0, 1);
    positions.setXYZ(i, normal.x * (PLANET_RADIUS + height), normal.y * (PLANET_RADIUS + height), normal.z * (PLANET_RADIUS + height));
    color.copy(shadow).lerp(dust, 0.42 + grain * 0.28).lerp(sunlit, altitude * 0.38);
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

const dustDevils = [];
function buildDustDevils() {
  [{ x: 19, z: -4 }, { x: -18, z: 15 }].forEach((location, devilIndex) => {
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

/* ---------- curved paths & spawn signs ---------- */

function buildPathMarkers(hub) {
  const distance = geodesicDistance(START_NORMAL, hub.normal);
  const steps = Math.max(4, Math.floor(distance / 3.4));
  const geometry = new THREE.CylinderGeometry(0.58, 0.58, 0.07, 12);
  const material = new THREE.MeshStandardMaterial({ color: hub.color, emissive: hub.color, emissiveIntensity: 0.6, roughness: 0.65 });
  const mesh = new THREE.InstancedMesh(geometry, material, steps);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < steps; i++) {
    const normal = slerpNormals(START_NORMAL, hub.normal, (i + 1) / (steps + 1));
    dummy.position.copy(surfaceWorldPosition(normal, 0.055));
    dummy.quaternion.setFromUnitVectors(UP, normal);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}
HUBS.forEach(buildPathMarkers);

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
  ctx.fillText(text, 180, 40);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(4.8, 1.05, 1);
  return sprite;
}

function buildSignposts() {
  HUBS.forEach((hub) => {
    const group = new THREE.Group();
    const normal = slerpNormals(START_NORMAL, hub.normal, 7 / geodesicDistance(START_NORMAL, hub.normal));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.8 }));
    pole.position.y = 1.1;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), new THREE.MeshStandardMaterial({ color: hub.color, emissive: hub.color, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    flag.position.set(0.42, 1.85, 0);
    group.add(flag);
    const label = makeLabelSprite(hub.name, '#fff3e6');
    label.position.set(0, 2.75, 0);
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
  const baseY = getTerrainHeight(hub.x, hub.z);
  const group = new THREE.Group();
  placeSurfaceGroup(group, hub.normal);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(6, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    stdMat(0x8fa5b8, { metalness: 0.6, roughness: 0.35 })
  );
  group.add(dome);
  addCollider(hub.x, hub.z, 6.3);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 8), stdMat(0xbbbbbb, { metalness: 0.8 }));
  antenna.position.y = 6 + 4;
  group.add(antenna);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35), stdMat(0xff5544, { emissive: 0xff5544, emissiveIntensity: 1 }));
  beacon.position.y = 6 + 8;
  group.add(beacon);

  for (let i = 0; i < 2; i++) {
    const a = Math.PI * 0.5 + i * Math.PI;
    const dx = Math.cos(a) * 9;
    const dz = Math.sin(a) * 9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6), stdMat(0x999999, { metalness: 0.7 }));
    pole.position.set(dx, 0.8, dz);
    group.add(pole);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 16, 1, true), stdMat(0xd8dde2, { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }));
    dish.rotation.x = Math.PI / 2.2;
    dish.position.set(dx, 1.7, dz);
    group.add(dish);
    addCollider(hub.x + dx, hub.z + dz, 1.2);
  }

  const light = new THREE.PointLight(0x66aaff, 2, 34);
  light.position.y = 8;
  group.add(light);

  return { group };
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

const hubRuntime = {};
HUBS.forEach((hub) => {
  hub.discovered = false;
  if (hub.key === 'outpost') hubRuntime[hub.key] = buildResearchOutpost(hub);
  if (hub.key === 'cavern') hubRuntime[hub.key] = buildCrystalCavern(hub);
  if (hub.key === 'ruins') hubRuntime[hub.key] = buildAncientRuins(hub);
  if (hub.key === 'crash') hubRuntime[hub.key] = buildCrashSite(hub);
});

/* ---------- proximity speaker stations ---------- */

function buildSpeakerStation(station, stationIndex) {
  const group = new THREE.Group();
  const darkMetal = stdMat(0x151821, { metalness: 0.72, roughness: 0.34 });
  const blackCone = stdMat(0x07090f, { metalness: 0.18, roughness: 0.74 });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: station.color,
    emissive: station.color,
    emissiveIntensity: 0.75,
    roughness: 0.32,
    metalness: 0.28,
  });

  const footing = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.65, 0.32, 10), darkMetal);
  footing.position.y = 0.16;
  group.add(footing);

  const signalRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.075, 8, 36), accentMaterial);
  signalRing.rotation.x = Math.PI / 2;
  signalRing.position.y = 0.36;
  group.add(signalRing);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.2, 8), darkMetal);
  mast.position.y = 1.92;
  group.add(mast);

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.4, 1), darkMetal);
  cabinet.position.y = 2.05;
  group.add(cabinet);

  const speakerRims = [];
  [-1, 1].forEach((face) => {
    [1.6, 2.45].forEach((height, speakerIndex) => {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(speakerIndex === 0 ? 0.39 : 0.3, 0.055, 8, 24), accentMaterial);
      rim.position.set(0, height, face * 0.525);
      if (face > 0) rim.rotation.y = Math.PI;
      group.add(rim);
      speakerRims.push(rim);

      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(speakerIndex === 0 ? 0.12 : 0.09, speakerIndex === 0 ? 0.32 : 0.24, 0.14, 20),
        blackCone
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, height, face * 0.55);
      group.add(cone);
    });
  });

  const equalizerBars = [];
  [-0.43, 0, 0.43].forEach((x, barIndex) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.12), accentMaterial);
    bar.position.set(x, 3.47, -0.08);
    bar.rotation.y = barIndex % 2 ? Math.PI / 2 : 0;
    group.add(bar);
    equalizerBars.push(bar);
  });

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6), darkMetal);
  antenna.position.y = 4.05;
  group.add(antenna);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), accentMaterial);
  beacon.position.y = 4.72;
  group.add(beacon);

  const light = new THREE.PointLight(station.color, 0.45, 10, 2);
  light.position.y = 3.4;
  group.add(light);

  const labelColor = `#${station.color.toString(16).padStart(6, '0')}`;
  const label = makeLabelSprite(`♫ ${station.name}`, labelColor);
  label.position.y = 5.25;
  label.scale.set(4.4, 0.95, 1);
  group.add(label);

  placeSurfaceGroup(group, station.normal);
  group.rotateY(stationIndex * 1.37 + 0.35);
  addCollider(station.x, station.z, 1.55);

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
const MOON_PAD_POSITION = MOON_CENTER.clone().addScaledVector(MOON_PAD_NORMAL, MOON_RADIUS + 0.08);
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
const ROVER_THRUSTER_FUEL_MAX = 3.0;
let footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
let roverThrusterFuel = ROVER_THRUSTER_FUEL_MAX;
let footThrusterBurstTime = 0;
let roverThrusterBurstTime = 0;
let shuttleLocation = 'mars';
let shuttleTransit = null;
let shuttleDisplaySpeed = 0;
let shuttleDockTimer = SHUTTLE_DOCK_DURATION;

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
let audioEnabled = true;
let audioStarted = false;

function updateAudioIndicator() {
  audioToggleEl.classList.toggle('audio-live', audioStarted && audioEnabled);
  audioToggleEl.setAttribute('aria-pressed', String(audioEnabled));
  audioStateEl.textContent = !audioStarted ? 'START' : audioEnabled ? 'ON' : 'OFF';
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

function buildSpeakerStationAudio(context, output) {
  const now = context.currentTime;
  SPEAKER_STATIONS.forEach((station, stationIndex) => {
    const proximityGain = context.createGain();
    proximityGain.gain.setValueAtTime(0, now);
    proximityGain.connect(output);

    const panner = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    panner.connect(proximityGain);

    const toneFilter = context.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(station.filter, now);
    toneFilter.Q.setValueAtTime(2.1 + stationIndex * 0.18, now);

    const dryGain = context.createGain();
    dryGain.gain.setValueAtTime(0.72, now);
    toneFilter.connect(dryGain).connect(panner);

    const delay = context.createDelay(1.2);
    const feedback = context.createGain();
    const wetGain = context.createGain();
    delay.delayTime.setValueAtTime(station.delay, now);
    feedback.gain.setValueAtTime(0.2 + stationIndex * 0.012, now);
    wetGain.gain.setValueAtTime(0.34, now);
    toneFilter.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wetGain).connect(panner);

    const oscillators = station.notes.map((frequency, noteIndex) => {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = noteIndex === 2 && station.wave === 'sawtooth' ? 'triangle' : station.wave;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.setValueAtTime((noteIndex - 1) * 4 + stationIndex * 1.5, now);
      noteGain.gain.setValueAtTime([0.34, 0.21, 0.13][noteIndex], now);
      oscillator.connect(noteGain).connect(toneFilter);
      oscillator.start(now);
      return oscillator;
    });

    const filterLfo = context.createOscillator();
    const filterLfoGain = context.createGain();
    filterLfo.type = 'sine';
    filterLfo.frequency.setValueAtTime(station.lfo, now);
    filterLfoGain.gain.setValueAtTime(station.sweep, now);
    filterLfo.connect(filterLfoGain).connect(toneFilter.frequency);
    filterLfo.start(now);

    station.audio = {
      proximityGain,
      panner,
      toneFilter,
      oscillators,
    };
  });
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
  ambientBusGain.gain.setValueAtTime(0.035, now);
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

  droneA.start(now);
  droneB.start(now);
  ambienceLfo.start(now);
  noiseSource.start(now);
  engineOscillator.start(now);
  engineSubOscillator.start(now);
  return true;
}

async function ensureMarsAudio() {
  if (!audioEnabled || !buildAudioSystem()) return;
  try {
    if (audioContext.state !== 'running') await audioContext.resume();
    audioStarted = audioContext.state === 'running';
    const now = audioContext.currentTime;
    audioMasterGain.gain.cancelScheduledValues(now);
    audioMasterGain.gain.setTargetAtTime(0.62, now, 0.28);
    updateAudioIndicator();
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

const stationAudioTangent = new THREE.Vector3();
const stationAudioRight = new THREE.Vector3();

function updateSpeakerStations(time, listenerNormal, listenerHeading) {
  let strongestSignal = 0;
  const hasMarsListener = Boolean(listenerNormal && listenerHeading);
  if (hasMarsListener) stationAudioRight.copy(listenerHeading).cross(listenerNormal).normalize();

  SPEAKER_STATIONS.forEach((station, stationIndex) => {
    const distance = hasMarsListener ? geodesicDistance(listenerNormal, station.normal) : Infinity;
    const proximity = 1 - THREE.MathUtils.smoothstep(distance, 3.2, station.hearingRadius);
    const signal = Math.pow(THREE.MathUtils.clamp(proximity, 0, 1), 1.65);
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
      const targetGain = signal > 0.0005 ? signal * 0.082 : 0;
      station.audio.proximityGain.gain.setTargetAtTime(targetGain, now, signal > 0 ? 0.16 : 0.28);
      if (hasMarsListener && station.audio.panner.pan) {
        stationAudioTangent.copy(station.normal).addScaledVector(listenerNormal, -station.normal.dot(listenerNormal)).normalize();
        const pan = THREE.MathUtils.clamp(stationAudioTangent.dot(stationAudioRight), -0.82, 0.82);
        station.audio.panner.pan.setTargetAtTime(pan, now, 0.14);
      }
    }

    if (proximity > 0.16 && !station.wasInRange) {
      station.wasInRange = true;
      showBanner(`LOCAL SIGNAL · ${station.name}`);
    } else if (proximity < 0.025) {
      station.wasInRange = false;
    }
  });

  if (ambientBusGain && audioStarted && audioEnabled && audioContext.state === 'running') {
    ambientBusGain.gain.setTargetAtTime(0.035 - strongestSignal * 0.014, audioContext.currentTime, 0.35);
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
  if (world === 'moon') return MOON_CENTER.clone().addScaledVector(normal, MOON_RADIUS + offset);
  return surfaceWorldPosition(normal, offset);
}

function arcDistanceForWorld(world, a, b) {
  const radius = world === 'moon' ? MOON_RADIUS : PLANET_RADIUS;
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * radius;
}

function orientSurfaceRoot(root, normal, heading) {
  travelBasisRight.copy(heading).cross(normal).normalize();
  travelBasisBack.copy(heading).multiplyScalar(-1);
  travelBasisMatrix.makeBasis(travelBasisRight, normal, travelBasisBack);
  root.quaternion.setFromRotationMatrix(travelBasisMatrix);
}

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

function startScheduledShuttleTrip() {
  const destination = shuttleLocation === 'mars' ? 'moon' : 'mars';
  const start = (shuttleLocation === 'mars' ? MARS_DOCK_POSITION : MOON_DOCK_POSITION).clone();
  const end = (destination === 'mars' ? MARS_DOCK_POSITION : MOON_DOCK_POSITION).clone();
  const control = start.clone().add(end).multiplyScalar(0.5);
  control.y += 116;
  control.x -= 18;
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

  if (travelMode !== 'walking') return;
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
  const radius = currentWorld === 'moon' ? MOON_RADIUS : PLANET_RADIUS;
  const walkTarget = throttleInput * (currentWorld === 'moon' ? 3.8 : 4.8);
  footSpeed = THREE.MathUtils.damp(footSpeed, walkTarget, throttleInput === 0 ? 6 : 8, dt);
  footHeading.applyAxisAngle(footNormal, steeringInput * 2.15 * dt).normalize();

  if (Math.abs(footSpeed) > 0.01) {
    const axis = new THREE.Vector3().crossVectors(footNormal, footHeading).normalize();
    const candidateNormal = footNormal.clone().applyAxisAngle(axis, (footSpeed * dt) / radius).normalize();
    const candidateHeading = footHeading.clone().applyAxisAngle(axis, (footSpeed * dt) / radius);
    footNormal.copy(candidateNormal);
    footHeading.copy(candidateHeading).addScaledVector(footNormal, -candidateHeading.dot(footNormal)).normalize();
  }

  if (jumpQueued && footGrounded) {
    footVerticalVelocity = currentWorld === 'moon' ? 7.4 : 8.4;
    footGrounded = false;
    footThrusterFuel = FOOT_THRUSTER_FUEL_MAX;
    footThrusterBurstTime = 0.86;
    showBanner('HIGH-THRUST JETPACK · HOLD SPACE TO CLIMB');
  }
  jumpQueued = false;
  footThrusterBurstTime = Math.max(0, footThrusterBurstTime - dt);
  const footThrusterHeld = Boolean(keys[' '] || keys.space || keys.spacebar);
  const footThrusterActive = !footGrounded && (footThrusterBurstTime > 0 || footThrusterHeld) && footThrusterFuel > 0;
  alienDriver.thrusterFlames.visible = footThrusterActive;
  if (footThrusterActive) {
    footThrusterFuel = Math.max(0, footThrusterFuel - dt);
    footVerticalVelocity = THREE.MathUtils.damp(footVerticalVelocity, currentWorld === 'moon' ? 4.7 : 5.4, 3.4, dt);
    alienDriver.thrusterFlames.scale.y = 0.78 + Math.sin(time * 28) * 0.18;
  }
  if (!footGrounded) {
    footVerticalVelocity += (footThrusterActive ? -0.12 : currentWorld === 'moon' ? -1.62 : marsGravity) * dt;
    footJumpHeight += footVerticalVelocity * dt;
    if (footJumpHeight <= 0) {
      footJumpHeight = 0;
      footVerticalVelocity = 0;
      footGrounded = true;
      footThrusterBurstTime = 0;
      alienDriver.thrusterFlames.visible = false;
    }
  } else {
    footThrusterFuel = Math.min(FOOT_THRUSTER_FUEL_MAX, footThrusterFuel + dt * 1.8);
  }

  footRoot.position.copy(surfacePositionForWorld(currentWorld, footNormal, footJumpHeight + 0.04));
  orientSurfaceRoot(footRoot, footNormal, footHeading);

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
  alienDriver.alien.rotation.z = -steeringInput * 0.06 + Math.sin(time * 2.1) * 0.012;
  alienDriver.body.scale.y = 1 + Math.sin(time * 1.8) * 0.018;
}

function updateTravelPrompt() {
  if (travelMode === 'driving') {
    setInteractionPrompt(Math.abs(driveSpeed) < 1.2 && grounded ? 'E · EXIT G-ROVER' : 'STOP TO EXIT G-ROVER');
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
  const padNormal = currentWorld === 'moon' ? MOON_PAD_NORMAL : MARS_PORT.normal;
  const nearPad = arcDistanceForWorld(currentWorld, footNormal, padNormal) < SHUTTLE_BOARD_RADIUS;
  if (!shuttleTransit && shuttleLocation === currentWorld && nearPad) {
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

  if (travelMode === 'driving') {
    const targetSpeed = throttleInput > 0 ? maxForwardSpeed : throttleInput < 0 ? -maxReverseSpeed : 0;
    const acceleration = throttleInput === 0 ? 3.3 : driveSpeed * throttleInput < 0 ? 11 : 5.8;
    driveSpeed = THREE.MathUtils.damp(driveSpeed, targetSpeed, acceleration, dt);
    if (Math.abs(driveSpeed) < 0.015) driveSpeed = 0;
    updateRoverAudio(driveSpeed, throttleInput);

    const steerStrength = THREE.MathUtils.clamp(Math.abs(driveSpeed) / 3.2, 0.2, 1);
    const reverseSteer = driveSpeed < -0.1 ? -1 : 1;
    playerHeading.applyAxisAngle(playerNormal, steeringInput * reverseSteer * turnSpeed * steerStrength * dt).normalize();
    frontWheelMounts.forEach((mount) => {
      mount.rotation.y = THREE.MathUtils.damp(mount.rotation.y, steeringInput * 0.42, 10, dt);
    });

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
    } else {
      driveSpeed *= -0.08;
    }

    if (jumpQueued && grounded) {
      verticalVelocity = 9.4;
      grounded = false;
      roverThrusterFuel = ROVER_THRUSTER_FUEL_MAX;
      roverThrusterBurstTime = 0.86;
      showBanner('G-ROVER HIGH THRUST · HOLD SPACE TO CLIMB');
    }
    jumpQueued = false;
    roverThrusterBurstTime = Math.max(0, roverThrusterBurstTime - dt);
    const roverThrusterActive = !grounded && (roverThrusterBurstTime > 0 || thrusterHeld) && roverThrusterFuel > 0;
    roverThrusters.visible = roverThrusterActive;
    if (roverThrusterActive) {
      roverThrusterFuel = Math.max(0, roverThrusterFuel - dt);
      verticalVelocity = THREE.MathUtils.damp(verticalVelocity, 6.2, 3.2, dt);
      roverThrusters.scale.y = 0.8 + Math.sin(t * 31) * 0.16;
    }
    if (!grounded) {
      verticalVelocity += (roverThrusterActive ? -0.14 : marsGravity) * dt;
      jumpHeight += verticalVelocity * dt;
      if (jumpHeight <= 0) {
        jumpHeight = 0;
        verticalVelocity = 0;
        grounded = true;
        roverThrusterBurstTime = 0;
        roverThrusters.visible = false;
        roverChassis.position.y = 0.16;
      }
    } else {
      roverThrusterFuel = Math.min(ROVER_THRUSTER_FUEL_MAX, roverThrusterFuel + dt * 1.7);
    }

    const frontHeight = getSurfaceHeight(steppedSurfaceNormal(playerNormal, playerHeading, 1.45));
    const rearHeight = getSurfaceHeight(steppedSurfaceNormal(playerNormal, playerHeading, -1.45));
    const rightHeight = getSurfaceHeight(steppedSurfaceNormal(playerNormal, rightVec, 1.25));
    const leftHeight = getSurfaceHeight(steppedSurfaceNormal(playerNormal, rightVec, -1.25));
    const targetPitch = grounded ? Math.atan2(frontHeight - rearHeight, 2.9) : -verticalVelocity * 0.018;
    const targetRoll = grounded ? Math.atan2(rightHeight - leftHeight, 2.5) - steeringInput * driveSpeed * 0.0045 : 0;
    roverChassis.rotation.x = THREE.MathUtils.damp(roverChassis.rotation.x, targetPitch, 7, dt);
    roverChassis.rotation.z = THREE.MathUtils.damp(roverChassis.rotation.z, targetRoll, 7, dt);

    suspensionPhase += Math.abs(driveSpeed) * dt * 1.8;
    const roadBuzz = grounded ? Math.sin(suspensionPhase) * Math.min(0.055, Math.abs(driveSpeed) * 0.004) : 0;
    roverChassis.position.y = THREE.MathUtils.damp(roverChassis.position.y, roadBuzz, grounded ? 9 : 3, dt);

    rightVec.copy(playerHeading).cross(playerNormal).normalize();
    backVec.copy(playerHeading).multiplyScalar(-1);
    orientationMatrix.makeBasis(rightVec, playerNormal, backVec);
    targetRoverQuaternion.setFromRotationMatrix(orientationMatrix);
    alien.quaternion.slerp(targetRoverQuaternion, 1 - Math.exp(-dt * 12));
    alien.position.copy(playerNormal).multiplyScalar(PLANET_RADIUS + getSurfaceHeight(playerNormal) + jumpHeight);

    roverWheels.forEach((wheel) => {
      wheel.rotation.x -= driveSpeed * dt / 0.79;
    });
    arms.forEach((arm, index) => {
      arm.upper.rotation.x = 1.12 + Math.sin(t * 2.2 + index) * Math.min(0.08, Math.abs(driveSpeed) * 0.006);
      arm.fore.rotation.x = 0.34 + steeringInput * (index === 0 ? -0.2 : 0.2);
    });
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.018;
    alienDriver.alien.rotation.z = Math.sin(t * 0.72) * 0.018 - steeringInput * 0.018;
    if (grounded && Math.abs(driveSpeed) > 1.4) spawnWheelDust(dt, driveSpeed);
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
    roverThrusters.visible = false;
    alienDriver.thrusterFlames.visible = false;
    alienDriver.body.scale.y = 1 + Math.sin(t * 1.35) * 0.012;
  }

  updateWheelDust(dt);

  const activeMarsNormal = travelMode === 'driving' ? playerNormal : travelMode === 'walking' && currentWorld === 'mars' ? footNormal : null;
  const activeMarsHeading = travelMode === 'driving' ? playerHeading : travelMode === 'walking' && currentWorld === 'mars' ? footHeading : null;
  updateSpeakerStations(t, activeMarsNormal, activeMarsHeading);

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
  marsLandingPad.glowMaterial.emissiveIntensity = 1.05 + Math.sin(t * 2.2) * 0.32;
  moonLandingPad.glowMaterial.emissiveIntensity = 0.9 + Math.sin(t * 1.7 + 1.3) * 0.26;

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
    desiredCamPos = alien.position.clone()
      .addScaledVector(playerNormal, lookingAtCamera ? 15 : 20)
      .addScaledVector(playerHeading, lookingAtCamera ? 13 : -18);
    desiredTarget = alien.position.clone().addScaledVector(playerNormal, 2.2).addScaledVector(playerHeading, lookingAtCamera ? 0 : 3.2);
    desiredCameraUp = playerNormal;
  } else if (travelMode === 'walking') {
    desiredCamPos = footRoot.position.clone()
      .addScaledVector(footNormal, lookingAtCamera ? 8.5 : 10.5)
      .addScaledVector(footHeading, lookingAtCamera ? 8 : -11);
    desiredTarget = footRoot.position.clone().addScaledVector(footNormal, 2.2).addScaledVector(footHeading, lookingAtCamera ? 0 : 2.2);
    desiredCameraUp = footNormal;
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
  camera.position.lerp(desiredCamPos, 1 - Math.exp(-dt * (travelMode === 'boarded' ? 3.4 : 5.2)));
  camera.up.lerp(desiredCameraUp, 1 - Math.exp(-dt * 7)).normalize();
  camLookTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 8));
  camera.lookAt(camLookTarget);

  const displayedSpeed = travelMode === 'driving' ? Math.abs(driveSpeed) * 3.6 : travelMode === 'walking' ? Math.abs(footSpeed) * 3.6 : shuttleDisplaySpeed;
  speedValueEl.textContent = Math.round(displayedSpeed).toString().padStart(2, '0');
  let elevation = 0;
  if (travelMode === 'driving') elevation = getSurfaceHeight(playerNormal) + jumpHeight;
  else if (travelMode === 'walking') elevation = (currentWorld === 'mars' ? getSurfaceHeight(footNormal) : 0) + footJumpHeight;
  elevationValueEl.textContent = `${elevation >= 0 ? '+' : ''}${elevation.toFixed(1)}`;

  if (travelMode === 'boarded' && shuttleTransit) {
    locationLabelEl.textContent = 'ARES–LUNA TRANSIT';
    gravityValueEl.textContent = '0.00 G';
    controlsHintEl.textContent = 'SPACE BUS AUTOPILOT · E trip status';
  } else {
    const locationWorld = travelMode === 'boarded' ? shuttleLocation : currentWorld;
    locationLabelEl.textContent = locationWorld === 'moon' ? 'MOON SURFACE · LUNA 01' : 'MARS SURFACE · SOL 01';
    gravityValueEl.textContent = locationWorld === 'moon' ? '0.16 G' : '0.38 G';
    controlsHintEl.textContent = travelMode === 'driving'
      ? 'WASD / ARROWS drive · HOLD SPACE high-thrust climb · E exit rover · F look back'
      : travelMode === 'walking'
        ? 'WASD / ARROWS walk · HOLD SPACE jetpack climb · E enter / board · F look back'
        : 'E disembark space bus';
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

  updateTravelPrompt();

  renderer.render(scene, camera);
}
animate();
