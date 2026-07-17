import * as THREE from 'three';

let sharedAssets;

function getSharedAssets() {
  if (sharedAssets) return sharedAssets;

  const tireGeometry = new THREE.CylinderGeometry(0.72, 0.72, 0.44, 16);
  tireGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.47, 12);
  hubGeometry.rotateZ(Math.PI / 2);
  const roadWheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.25, 14);
  roadWheelGeometry.rotateZ(Math.PI / 2);

  sharedAssets = {
    geometries: {
      unitBox: new THREE.BoxGeometry(1, 1, 1),
      unitCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      tire: tireGeometry,
      hub: hubGeometry,
      roadWheel: roadWheelGeometry,
      tread: new THREE.BoxGeometry(0.36, 0.16, 0.62),
      smallNozzle: new THREE.CylinderGeometry(0.18, 0.26, 0.5, 10),
      flame: new THREE.ConeGeometry(0.2, 1.25, 9, 1, true),
      hoverPad: new THREE.CylinderGeometry(0.62, 0.72, 0.2, 16),
      lowPolySphere: new THREE.SphereGeometry(1, 18, 10),
    },
    materials: {
      tire: new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.96, metalness: 0.08 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x1e252a, roughness: 0.48, metalness: 0.72 }),
      brightMetal: new THREE.MeshStandardMaterial({ color: 0x8e999d, roughness: 0.34, metalness: 0.82 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x153947,
        emissive: 0x082431,
        emissiveIntensity: 0.38,
        transparent: true,
        opacity: 0.72,
        roughness: 0.18,
        metalness: 0.24,
      }),
      seat: new THREE.MeshStandardMaterial({ color: 0x261c1a, roughness: 0.92 }),
      warmLight: new THREE.MeshBasicMaterial({ color: 0xffe4a3, toneMapped: false }),
      rockhopperBody: new THREE.MeshStandardMaterial({ color: 0xd9542d, roughness: 0.62, metalness: 0.22 }),
      crawlerBody: new THREE.MeshStandardMaterial({ color: 0x7c5c32, roughness: 0.78, metalness: 0.3 }),
      crawlerArmor: new THREE.MeshStandardMaterial({ color: 0x3f4439, roughness: 0.72, metalness: 0.56 }),
      skimmerBody: new THREE.MeshStandardMaterial({
        color: 0x326f80,
        emissive: 0x0a2735,
        emissiveIntensity: 0.35,
        roughness: 0.32,
        metalness: 0.68,
      }),
    },
  };
  return sharedAssets;
}

function addMesh(parent, geometry, material, position, scale, rotation = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function resolveBodyMaterial(base, color) {
  if (color === undefined) return base;
  const material = base.clone();
  material.color.set(color);
  return material;
}

function applyRootOptions(root, options) {
  if (options.name) root.name = options.name;
  if (options.scale !== undefined) root.scale.setScalar(options.scale);
  if (options.position) {
    if (options.position.isVector3) root.position.copy(options.position);
    else root.position.set(...options.position);
  }
  if (options.rotationY !== undefined) root.rotation.y = options.rotationY;
}

function makeFlameMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function buildRockhopper(options = {}) {
  const { geometries, materials } = getSharedAssets();
  const root = new THREE.Group();
  root.name = 'Rockhopper · fast Mars buggy';
  applyRootOptions(root, options);

  const bodyMaterial = resolveBodyMaterial(materials.rockhopperBody, options.color);
  const chassis = new THREE.Group();
  root.add(chassis);
  addMesh(chassis, geometries.unitBox, materials.darkMetal, [0, 0.9, 0.05], [2.55, 0.34, 4.15]);
  addMesh(chassis, geometries.unitBox, bodyMaterial, [0, 1.18, -0.68], [2.35, 0.54, 2.48], [-0.04, 0, 0]);
  addMesh(chassis, geometries.unitBox, bodyMaterial, [0, 1.24, 1.35], [2.2, 0.32, 1.26], [0.08, 0, 0]);
  addMesh(chassis, geometries.unitBox, materials.darkMetal, [0, 1.55, 0.58], [1.28, 0.2, 1.0]);
  addMesh(chassis, geometries.unitBox, materials.seat, [0, 1.96, 0.7], [1.12, 0.84, 0.18], [-0.12, 0, 0]);
  addMesh(chassis, geometries.unitBox, materials.glass, [0, 1.72, -0.58], [1.92, 0.74, 0.08], [-0.32, 0, 0]);
  const seat = new THREE.Group();
  seat.position.set(0, 2.02, 0.62);
  chassis.add(seat);

  const rollCage = new THREE.Group();
  chassis.add(rollCage);
  [-0.86, 0.86].forEach((x) => {
    addMesh(rollCage, geometries.unitCylinder, materials.brightMetal, [x, 2.35, 0.64], [0.11, 1.75, 0.11], [0.1, 0, x * -0.08]);
  });
  addMesh(rollCage, geometries.unitCylinder, materials.brightMetal, [0, 3.1, 0.52], [0.1, 1.78, 0.1], [0, 0, Math.PI / 2]);
  addMesh(chassis, geometries.unitBox, bodyMaterial, [0, 1.5, 2.15], [2.65, 0.14, 0.44]);

  const frontWheelMounts = [];
  const wheels = [];
  const hubs = [];
  [
    [-1.55, 0.82, -1.55, true],
    [1.55, 0.82, -1.55, true],
    [-1.55, 0.82, 1.58, false],
    [1.55, 0.82, 1.58, false],
  ].forEach(([x, y, z, front]) => {
    const mount = new THREE.Group();
    mount.position.set(x, y, z);
    chassis.add(mount);
    const suspension = addMesh(mount, geometries.unitBox, materials.brightMetal, [-x * 0.2, 0.22, 0], [0.72, 0.1, 0.12], [0, 0, x > 0 ? -0.22 : 0.22]);
    suspension.name = 'Rockhopper suspension arm';
    const wheel = new THREE.Mesh(geometries.tire, materials.tire);
    mount.add(wheel);
    const hub = new THREE.Mesh(geometries.hub, materials.brightMetal);
    mount.add(hub);
    wheels.push(wheel);
    hubs.push(hub);
    if (front) frontWheelMounts.push(mount);
  });

  const headlights = [];
  [-0.76, 0.76].forEach((x) => {
    const light = addMesh(chassis, geometries.unitCylinder, materials.warmLight, [x, 1.42, -1.95], [0.22, 0.08, 0.22], [Math.PI / 2, 0, 0]);
    headlights.push(light);
  });

  const thrusters = new THREE.Group();
  const thrusterFlames = new THREE.Group();
  const thrusterMaterial = makeFlameMaterial(options.thrusterColor ?? 0x69e8ff);
  [-0.62, 0.62].forEach((x) => {
    const nozzle = new THREE.Mesh(geometries.smallNozzle, materials.darkMetal);
    nozzle.position.set(x, 1.22, 2.28);
    nozzle.rotation.x = Math.PI / 2;
    thrusters.add(nozzle);
    const flame = new THREE.Mesh(geometries.flame, thrusterMaterial);
    flame.position.set(x, 1.22, 2.95);
    flame.rotation.x = Math.PI / 2;
    thrusterFlames.add(flame);
  });
  thrusterFlames.visible = false;
  chassis.add(thrusters, thrusterFlames);

  let wheelDistance = 0;
  function updateMotion({ distance = wheelDistance, steering = 0, thrust = 0, time = 0 } = {}) {
    const deltaDistance = distance - wheelDistance;
    wheelDistance = distance;
    wheels.forEach((wheel) => { wheel.rotation.x -= deltaDistance / 0.72; });
    frontWheelMounts.forEach((mount) => { mount.rotation.y = THREE.MathUtils.clamp(steering, -1, 1) * 0.42; });
    const thrustLevel = THREE.MathUtils.clamp(thrust, 0, 1);
    thrusterFlames.visible = thrustLevel > 0.01;
    thrusterFlames.scale.y = 0.45 + thrustLevel * 0.75 + Math.sin(time * 38) * thrustLevel * 0.08;
    thrusterMaterial.opacity = 0.58 + thrustLevel * 0.32;
  }

  return {
    kind: 'rockhopper',
    profile: { maxForwardSpeed: 22, maxReverseSpeed: 10, turnRate: 2.25, collisionRadius: 1.25, caveAllowed: true },
    root,
    chassis,
    seat,
    bodyMaterial,
    rollCage,
    wheels,
    hubs,
    frontWheelMounts,
    headlights,
    thrusters,
    thrusterFlames,
    thrusterMaterial,
    updateMotion,
  };
}

function fillTreadInstances(batch, side, phase, dummy) {
  const count = batch.count;
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2 + phase;
    const dy = 0.66 * Math.cos(angle);
    const dz = -2.58 * Math.sin(angle);
    dummy.position.set(side * 2.02, 0.92 + Math.sin(angle) * 0.66, Math.cos(angle) * 2.58);
    dummy.rotation.set(-Math.atan2(dy, dz), 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    batch.setMatrixAt(index, dummy.matrix);
  }
  batch.instanceMatrix.needsUpdate = true;
}

export function buildDustcrawler(options = {}) {
  const { geometries, materials } = getSharedAssets();
  const root = new THREE.Group();
  root.name = 'Dustcrawler · heavy tracked Mars hauler';
  applyRootOptions(root, options);

  const bodyMaterial = resolveBodyMaterial(materials.crawlerBody, options.color);
  const body = new THREE.Group();
  root.add(body);
  addMesh(body, geometries.unitBox, materials.crawlerArmor, [0, 1.38, 0], [3.72, 0.82, 5.72]);
  addMesh(body, geometries.unitBox, bodyMaterial, [0, 2.08, -1.55], [3.28, 1.42, 2.05], [-0.03, 0, 0]);
  addMesh(body, geometries.unitBox, materials.glass, [0, 2.36, -2.6], [2.58, 0.74, 0.08], [-0.12, 0, 0]);
  addMesh(body, geometries.unitBox, materials.darkMetal, [0, 2.08, 1.16], [3.28, 0.38, 2.0]);
  const cargoBed = addMesh(body, geometries.unitBox, bodyMaterial, [0, 2.54, 1.2], [3.34, 0.18, 2.38]);
  [-1.55, 1.55].forEach((x) => {
    addMesh(body, geometries.unitBox, materials.crawlerArmor, [x, 2.93, 1.2], [0.14, 0.82, 2.36]);
  });
  addMesh(body, geometries.unitBox, materials.crawlerArmor, [0, 2.93, 2.36], [3.2, 0.82, 0.14]);

  const treadDummy = new THREE.Object3D();
  const treadCount = options.treadSegments ?? 28;
  const leftTread = new THREE.InstancedMesh(geometries.tread, materials.tire, treadCount);
  const rightTread = new THREE.InstancedMesh(geometries.tread, materials.tire, treadCount);
  const crawlerBounds = new THREE.Sphere(new THREE.Vector3(0, 1.05, 0), 3.75);
  geometries.tread.boundingSphere = crawlerBounds.clone();
  geometries.roadWheel.boundingSphere = crawlerBounds.clone();
  leftTread.frustumCulled = true;
  rightTread.frustumCulled = true;
  leftTread.name = 'Dustcrawler left animated tread';
  rightTread.name = 'Dustcrawler right animated tread';
  fillTreadInstances(leftTread, -1, 0, treadDummy);
  fillTreadInstances(rightTread, 1, 0, treadDummy);
  body.add(leftTread, rightTread);

  const roadWheelCount = 12;
  const roadWheels = new THREE.InstancedMesh(geometries.roadWheel, materials.darkMetal, roadWheelCount);
  roadWheels.frustumCulled = true;
  roadWheels.name = 'Dustcrawler batched road wheels';
  const roadWheelDummy = new THREE.Object3D();
  const roadWheelPositions = [];
  [-1, 1].forEach((side) => {
    [-2.05, -1.23, -0.41, 0.41, 1.23, 2.05].forEach((z) => roadWheelPositions.push({ side, z }));
  });
  function updateRoadWheels(distance) {
    roadWheelPositions.forEach(({ side, z }, index) => {
      roadWheelDummy.position.set(side * 2.04, 0.9, z);
      roadWheelDummy.rotation.set(-distance / 0.48, 0, 0);
      roadWheelDummy.updateMatrix();
      roadWheels.setMatrixAt(index, roadWheelDummy.matrix);
    });
    roadWheels.instanceMatrix.needsUpdate = true;
  }
  updateRoadWheels(0);
  body.add(roadWheels);

  const exhausts = [];
  [-1.2, 1.2].forEach((x) => {
    const exhaust = addMesh(body, geometries.unitCylinder, materials.darkMetal, [x, 2.72, 2.7], [0.18, 0.9, 0.18]);
    exhausts.push(exhaust);
  });
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8b36,
    emissive: 0xff5a18,
    emissiveIntensity: 1.5,
    roughness: 0.25,
    toneMapped: false,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 7), beaconMaterial);
  beacon.position.set(0, 3.08, -1.42);
  body.add(beacon);
  const seat = new THREE.Group();
  seat.position.set(0, 2.34, -1.48);
  body.add(seat);

  let treadDistance = 0;
  function updateMotion({ distance = treadDistance, steering = 0, time = 0 } = {}) {
    treadDistance = distance;
    const turn = THREE.MathUtils.clamp(steering, -1, 1) * 0.24;
    fillTreadInstances(leftTread, -1, distance / 0.66 + turn, treadDummy);
    fillTreadInstances(rightTread, 1, distance / 0.66 - turn, treadDummy);
    updateRoadWheels(distance);
    beaconMaterial.emissiveIntensity = 1.15 + (Math.sin(time * 5.2) * 0.5 + 0.5) * 1.35;
  }

  return {
    kind: 'dustcrawler',
    profile: { maxForwardSpeed: 10, maxReverseSpeed: 5.5, turnRate: 1.05, collisionRadius: 2.2, caveAllowed: false },
    root,
    body,
    seat,
    bodyMaterial,
    cargoBed,
    treads: [leftTread, rightTread],
    roadWheels,
    exhausts,
    beacon,
    beaconMaterial,
    updateMotion,
  };
}

export function buildZephyrSkimmer(options = {}) {
  const { geometries, materials } = getSharedAssets();
  const root = new THREE.Group();
  root.name = 'Zephyr Skimmer · drifting low-hover craft';
  applyRootOptions(root, options);

  const bodyMaterial = resolveBodyMaterial(materials.skimmerBody, options.color);
  const driftRoot = new THREE.Group();
  driftRoot.position.y = 0.9;
  root.add(driftRoot);

  const hull = new THREE.Mesh(geometries.lowPolySphere, bodyMaterial);
  hull.scale.set(2.2, 0.46, 3.05);
  driftRoot.add(hull);
  addMesh(driftRoot, geometries.unitBox, materials.darkMetal, [0, 0.05, 0.42], [2.8, 0.16, 2.64]);
  const cockpit = new THREE.Mesh(geometries.lowPolySphere, materials.glass);
  cockpit.position.set(0, 0.48, -0.46);
  cockpit.scale.set(1.08, 0.58, 1.42);
  driftRoot.add(cockpit);
  const seat = new THREE.Group();
  seat.position.set(0, 0.56, -0.42);
  driftRoot.add(seat);

  const fins = [];
  [-1, 1].forEach((side) => {
    const sideFin = addMesh(
      driftRoot,
      geometries.unitBox,
      bodyMaterial,
      [side * 2.1, 0.02, 0.55],
      [1.4, 0.12, 2.6],
      [0, side * -0.08, side * 0.08]
    );
    fins.push(sideFin);
  });
  fins.push(addMesh(driftRoot, geometries.unitBox, materials.brightMetal, [0, 0.32, 2.66], [1.9, 0.08, 0.72], [0.08, 0, 0]));

  const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0x71ffe6,
    emissive: 0x2fe7d0,
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 0.82,
    roughness: 0.2,
    metalness: 0.36,
    toneMapped: false,
  });
  const hoverPads = [];
  [[-1.45, -1.55], [1.45, -1.55], [-1.45, 1.5], [1.45, 1.5]].forEach(([x, z]) => {
    const pad = new THREE.Mesh(geometries.hoverPad, hoverMaterial);
    pad.position.set(x, -0.42, z);
    driftRoot.add(pad);
    hoverPads.push(pad);
  });

  const thrusters = new THREE.Group();
  const thrusterFlames = new THREE.Group();
  const thrusterMaterial = makeFlameMaterial(options.thrusterColor ?? 0xb88cff);
  [-0.92, 0, 0.92].forEach((x) => {
    const nozzle = new THREE.Mesh(geometries.smallNozzle, materials.darkMetal);
    nozzle.position.set(x, 0.02, 2.74);
    nozzle.rotation.x = Math.PI / 2;
    thrusters.add(nozzle);
    const flame = new THREE.Mesh(geometries.flame, thrusterMaterial);
    flame.position.set(x, 0.02, 3.43);
    flame.rotation.x = Math.PI / 2;
    thrusterFlames.add(flame);
  });
  thrusterFlames.visible = false;
  driftRoot.add(thrusters, thrusterFlames);

  function updateMotion({ time = 0, speed = 0, steering = 0, thrust = 0 } = {}) {
    const speedLevel = THREE.MathUtils.clamp(Math.abs(speed) / 18, 0, 1);
    const steer = THREE.MathUtils.clamp(steering, -1, 1);
    driftRoot.position.y = 0.9 + Math.sin(time * (2.1 + speedLevel * 1.8)) * (0.06 + speedLevel * 0.04);
    driftRoot.rotation.z = THREE.MathUtils.lerp(driftRoot.rotation.z, -steer * (0.12 + speedLevel * 0.14), 0.12);
    driftRoot.rotation.x = Math.sin(time * 1.2) * 0.012 - speedLevel * 0.025;
    hoverMaterial.emissiveIntensity = 1.15 + Math.sin(time * 4.6) * 0.22 + speedLevel * 0.8;
    hoverPads.forEach((pad, index) => {
      const pulse = 1 + Math.sin(time * 5.4 + index * 1.45) * 0.05;
      pad.scale.setScalar(pulse);
    });
    const thrustLevel = THREE.MathUtils.clamp(Math.max(thrust, speedLevel * 0.65), 0, 1);
    thrusterFlames.visible = thrustLevel > 0.02;
    thrusterFlames.scale.y = 0.35 + thrustLevel * 0.95 + Math.sin(time * 44) * thrustLevel * 0.07;
    thrusterMaterial.opacity = 0.52 + thrustLevel * 0.38;
  }

  return {
    kind: 'zephyr-skimmer',
    profile: { maxForwardSpeed: 28, maxReverseSpeed: 12, turnRate: 1.85, collisionRadius: 1.65, caveAllowed: false },
    root,
    driftRoot,
    seat,
    hull,
    cockpit,
    bodyMaterial,
    fins,
    hoverPads,
    hoverMaterial,
    thrusters,
    thrusterFlames,
    thrusterMaterial,
    updateMotion,
  };
}

export function buildMarsVehicle(kind, options = {}) {
  if (kind === 'rockhopper') return buildRockhopper(options);
  if (kind === 'dustcrawler') return buildDustcrawler(options);
  if (kind === 'zephyr-skimmer' || kind === 'skimmer') return buildZephyrSkimmer(options);
  throw new Error(`Unknown Mars vehicle: ${kind}`);
}

export function buildMarsVehicleSuite(options = {}) {
  const root = new THREE.Group();
  root.name = 'Mars vehicle suite';
  const spacing = options.spacing ?? 8.5;
  const rockhopper = buildRockhopper(options.rockhopper);
  const dustcrawler = buildDustcrawler(options.dustcrawler);
  const zephyrSkimmer = buildZephyrSkimmer(options.zephyrSkimmer);
  rockhopper.root.position.x -= spacing;
  zephyrSkimmer.root.position.x += spacing;
  root.add(rockhopper.root, dustcrawler.root, zephyrSkimmer.root);
  return {
    root,
    vehicles: [rockhopper, dustcrawler, zephyrSkimmer],
    rockhopper,
    dustcrawler,
    zephyrSkimmer,
  };
}
