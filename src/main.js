import * as THREE from 'three';
import './style.css';

/* ---------- renderer / scene / camera ---------- */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

scene.fog = new THREE.FogExp2(0xd08a5b, 0.0032);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- hub layout & terrain shaping ---------- */

const MAP_SIZE = 220;
const MAP_HALF = MAP_SIZE / 2 - 6;

const HUBS = [
  { key: 'outpost', name: 'Research Outpost', x: 75, z: -75, color: 0x6fb8ff, trigger: 15 },
  { key: 'cavern', name: 'Crystal Cavern', x: -75, z: -75, color: 0xb266ff, trigger: 15 },
  { key: 'ruins', name: 'Ancient Ruins', x: 75, z: 75, color: 0xe0a35a, trigger: 15 },
  { key: 'crash', name: 'Crash Site', x: -75, z: 75, color: 0xff6a4a, trigger: 15 },
];

const FLATTEN_ZONES = [{ x: 0, z: 0, r0: 12, r1: 24 }, ...HUBS.map((h) => ({ x: h.x, z: h.z, r0: 13, r1: 24 }))];

function rawHeight(x, z) {
  return (
    (Math.sin(x * 0.045) + Math.cos(z * 0.05)) * 0.8 +
    Math.sin((x + z) * 0.02) * 1.0 +
    Math.sin(x * 0.11) * 0.25
  );
}

function getTerrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const zone of FLATTEN_ZONES) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d < zone.r1) {
      const t = d <= zone.r0 ? 0 : (d - zone.r0) / (zone.r1 - zone.r0);
      const factor = t * t * (3 - 2 * t);
      h *= factor;
    }
  }
  return h;
}

/* ---------- sky ---------- */

function buildSky() {
  const skyGeo = new THREE.SphereGeometry(400, 24, 16);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x4b3a55);
  const bottom = new THREE.Color(0xe8a06b);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 400 + 0.15, 0, 1);
    tmp.copy(bottom).lerp(top, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const starCount = 700;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * 0.45 * Math.PI;
    const r = 380;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) + 20;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, transparent: true, opacity: 0.75, fog: false });
  scene.add(new THREE.Points(starGeo, starMat));

  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = sunCanvas.height = 128;
  const sctx = sunCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,244,214,1)');
  grad.addColorStop(0.4, 'rgba(255,214,150,0.8)');
  grad.addColorStop(1, 'rgba(255,180,120,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  const sunMat = new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false });
  const sun = new THREE.Sprite(sunMat);
  sun.scale.set(90, 90, 1);
  sun.position.set(140, 110, -220);
  scene.add(sun);
}
buildSky();

/* ---------- lighting ---------- */

scene.add(new THREE.HemisphereLight(0xe8b48a, 0x5a3a2a, 0.9));
const sunLight = new THREE.DirectionalLight(0xffe3c2, 1.4);
sunLight.position.set(140, 110, -220);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

/* ---------- terrain mesh ---------- */

function buildTerrain() {
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(0x8a4326);
  const light = new THREE.Color(0xc97a4a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getTerrainHeight(x, z);
    pos.setY(i, y);
    const speckle = (Math.sin(x * 0.7) * Math.cos(z * 0.9) + 1) * 0.5;
    tmp.copy(dark).lerp(light, speckle * 0.6 + (y + 3) / 8);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
}
buildTerrain();

/* ---------- collision registry ---------- */

const obstacles = []; // { x, z, radius }
function addCollider(x, z, radius) {
  obstacles.push({ x, z, radius });
}

/* ---------- rocks ---------- */

function pointSegDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = THREE.MathUtils.clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

function buildRocks() {
  const count = 55;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b3a28, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < 3000) {
    tries++;
    const x = (Math.random() * 2 - 1) * MAP_HALF;
    const z = (Math.random() * 2 - 1) * MAP_HALF;
    if (Math.hypot(x, z) < 18) continue;
    if (HUBS.some((h) => Math.hypot(x - h.x, z - h.z) < 20)) continue;
    if (HUBS.some((h) => pointSegDist(x, z, 0, 0, h.x, h.z) < 5)) continue;

    const scale = 0.6 + Math.random() * 1.4;
    const y = getTerrainHeight(x, z);
    dummy.position.set(x, y + scale * 0.4, z);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    addCollider(x, z, scale * 0.9);
    placed++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}
buildRocks();

/* ---------- path markers ---------- */

function buildPathMarkers(hub) {
  const dist = Math.hypot(hub.x, hub.z);
  const steps = Math.floor(dist / 4);
  const geo = new THREE.CylinderGeometry(0.9, 0.9, 0.08, 12);
  const mat = new THREE.MeshStandardMaterial({ color: hub.color, emissive: hub.color, emissiveIntensity: 0.55, roughness: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, steps);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = hub.x * t;
    const z = hub.z * t;
    dummy.position.set(x, getTerrainHeight(x, z) + 0.05, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}
HUBS.forEach(buildPathMarkers);

/* ---------- signpost at spawn ---------- */

function makeLabelSprite(text, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = colorHex;
  ctx.fillText(text, 160, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(7, 1.75, 1);
  return sprite;
}

function buildSignposts() {
  HUBS.forEach((hub) => {
    const angle = Math.atan2(hub.x, hub.z) + Math.PI;
    const px = Math.sin(angle) * 9;
    const pz = Math.cos(angle) * 9;
    const baseY = getTerrainHeight(px, pz);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.8 })
    );
    pole.position.set(px, baseY + 1.5, pz);
    scene.add(pole);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.65),
      new THREE.MeshStandardMaterial({ color: hub.color, emissive: hub.color, emissiveIntensity: 0.4, side: THREE.DoubleSide })
    );
    flag.position.set(px + 0.55, baseY + 2.7, pz);
    flag.lookAt(0, baseY + 2.7, 0);
    scene.add(flag);

    const label = makeLabelSprite(hub.name, '#fff3e6');
    label.position.set(px, baseY + 3.6, pz);
    scene.add(label);
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
  group.position.set(hub.x, baseY, hub.z);
  scene.add(group);

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
  group.position.set(hub.x, baseY, hub.z);
  scene.add(group);

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
  group.position.set(hub.x, baseY, hub.z);
  scene.add(group);

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
  group.position.set(hub.x, baseY, hub.z);
  scene.add(group);

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

/* ---------- alien character ---------- */

function buildAlien() {
  const alien = new THREE.Group();
  const skinColor = 0x62d9a6;

  const hipY = 0.95;
  const legs = [];
  [-0.22, 0.22].forEach((x) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(x, hipY, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.95, 8), stdMat(0x3fae82));
    leg.position.y = -0.475;
    legGroup.add(leg);
    alien.add(legGroup);
    legs.push(legGroup);
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.7, 4, 12), stdMat(skinColor, { roughness: 0.55 }));
  body.position.y = 1.8;
  alien.add(body);

  const shoulderY = 1.75;
  const arms = [];
  [-0.62, 0.62].forEach((x, i) => {
    const armGroup = new THREE.Group();
    armGroup.position.set(x, shoulderY, 0);
    armGroup.rotation.z = i === 0 ? 0.2 : -0.2;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.75, 8), stdMat(0x3fae82));
    arm.position.y = -0.375;
    armGroup.add(arm);
    alien.add(armGroup);
    arms.push(armGroup);
  });

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), stdMat(0x3fae82));
  neck.position.y = 2.9;
  alien.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 20), stdMat(0x86e9c2, { roughness: 0.45 }));
  head.position.y = 3.85;
  head.scale.set(1.05, 1.2, 0.95);
  alien.add(head);

  [-0.42, 0.42].forEach((x, i) => {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 24, 20),
      stdMat(0x060606, { emissive: 0x123a3a, emissiveIntensity: 0.2, roughness: 0.12, metalness: 0.2 })
    );
    eye.scale.set(1.3, 0.75, 0.5);
    eye.rotation.y = i === 0 ? 0.35 : -0.35;
    eye.position.set(x, 3.82, -0.6);
    alien.add(eye);
  });

  alien.position.set(0, getTerrainHeight(0, 0), 0);
  scene.add(alien);
  return { alien, legs, arms };
}

const { alien, legs, arms } = buildAlien();

/* ---------- input ---------- */

const keys = {};
let lookingAtCamera = false;
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;
  if (key === 'f' && !e.repeat) lookingAtCamera = !lookingAtCamera;
});
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

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
const PORTFOLIO_REVEAL_RADIUS = 22;

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

/* ---------- camera state ---------- */

const camLookTarget = new THREE.Vector3(0, 3.2, 0);
camera.position.copy(alien.position).add(new THREE.Vector3(0, 4.8, 8.2));

/* ---------- animation loop ---------- */

const forwardVec = new THREE.Vector3();
const moveSpeed = 9;
const turnSpeed = 2.6;
const alienRadius = 0.6;
let walkCycle = 0;

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const movementKeyHeld =
    keys['w'] || keys['a'] || keys['s'] || keys['d'] || keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'];
  if (lookingAtCamera && movementKeyHeld) lookingAtCamera = false;

  if (lookingAtCamera) {
    const dx = camera.position.x - alien.position.x;
    const dz = camera.position.z - alien.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - alien.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    alien.rotation.y += diff * Math.min(1, dt * 6);
  } else {
    if (keys['a'] || keys['arrowleft']) alien.rotation.y += turnSpeed * dt;
    if (keys['d'] || keys['arrowright']) alien.rotation.y -= turnSpeed * dt;
  }

  const forwardInput = lookingAtCamera ? 0 : (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
  let moved = false;

  if (forwardInput !== 0) {
    forwardVec.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), alien.rotation.y);
    const nextX = alien.position.x + forwardVec.x * forwardInput * moveSpeed * dt;
    const nextZ = alien.position.z + forwardVec.z * forwardInput * moveSpeed * dt;

    const blocked = obstacles.some((o) => Math.hypot(nextX - o.x, nextZ - o.z) < o.radius + alienRadius);
    if (!blocked) {
      alien.position.x = THREE.MathUtils.clamp(nextX, -MAP_HALF, MAP_HALF);
      alien.position.z = THREE.MathUtils.clamp(nextZ, -MAP_HALF, MAP_HALF);
      moved = true;
    }
  }
  alien.position.y = getTerrainHeight(alien.position.x, alien.position.z);

  walkCycle += dt * (moved ? 9 : 0);
  const legSwing = Math.sin(walkCycle) * 0.5;
  const targetLeg0 = moved ? legSwing : 0;
  const targetLeg1 = moved ? -legSwing : 0;
  legs[0].rotation.x = THREE.MathUtils.lerp(legs[0].rotation.x, targetLeg0, 0.25);
  legs[1].rotation.x = THREE.MathUtils.lerp(legs[1].rotation.x, targetLeg1, 0.25);
  arms[0].rotation.x = THREE.MathUtils.lerp(arms[0].rotation.x, moved ? -legSwing * 0.7 : 0, 0.25);
  arms[1].rotation.x = THREE.MathUtils.lerp(arms[1].rotation.x, moved ? legSwing * 0.7 : 0, 0.25);

  for (const hub of HUBS) {
    if (!hub.discovered && Math.hypot(alien.position.x - hub.x, alien.position.z - hub.z) < hub.trigger) {
      discoverHub(hub);
    }
  }

  const portfolioHub = HUBS.find((h) => h.key === PORTFOLIO_HUB_KEY);
  const nearPortfolio = Math.hypot(alien.position.x - portfolioHub.x, alien.position.z - portfolioHub.z) < PORTFOLIO_REVEAL_RADIUS;
  portfolioPanelEl.classList.toggle('show', nearPortfolio);

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

  const behindOffset = new THREE.Vector3(0, 4.8, 8.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), alien.rotation.y);
  const desiredCamPos = alien.position.clone().add(behindOffset);
  camera.position.lerp(desiredCamPos, 0.08);
  camLookTarget.lerp(alien.position.clone().add(new THREE.Vector3(0, 3.2, 0)), 0.15);
  camera.lookAt(camLookTarget);

  renderer.render(scene, camera);
}
animate();
