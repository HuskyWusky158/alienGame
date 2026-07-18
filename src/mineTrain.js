import * as THREE_NS from 'three';

const DEFAULT_UP = new THREE_NS.Vector3(0, 1, 0);

function curveFrame(THREE, curve, ratio, up, target = {}) {
  const point = target.point || new THREE.Vector3();
  const tangent = target.tangent || new THREE.Vector3();
  const right = target.right || new THREE.Vector3();
  curve.getPointAt(ratio, point);
  curve.getTangentAt(ratio, tangent).normalize();
  right.crossVectors(tangent, up).normalize();
  if (right.lengthSq() < 0.5) right.set(1, 0, 0);
  return { point, tangent, right };
}

function makeRouteOffsetCurve(THREE, curve, lateral, lift, samples, up) {
  const frame = {
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
  const points = [];
  for (let index = 0; index <= samples; index++) {
    const ratio = index / samples;
    curveFrame(THREE, curve, ratio, up, frame);
    points.push(frame.point.clone().addScaledVector(frame.right, lateral).addScaledVector(up, lift));
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
}

function applyRoutePose(THREE, object, point, tangent, up, direction, lift, scratch) {
  scratch.forward.copy(tangent).multiplyScalar(direction >= 0 ? 1 : -1).normalize();
  scratch.right.crossVectors(scratch.forward, up).normalize();
  if (scratch.right.lengthSq() < 0.5) scratch.right.set(1, 0, 0);
  scratch.back.copy(scratch.forward).multiplyScalar(-1);
  scratch.matrix.makeBasis(scratch.right, up, scratch.back);
  object.position.copy(point).addScaledVector(up, lift);
  object.quaternion.setFromRotationMatrix(scratch.matrix);
}

function addBox(THREE, parent, geometry, material, position, scale, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildStation({
  THREE,
  curve,
  ratio,
  name,
  label,
  up,
  makeLabelSprite,
  materials,
  shared,
}) {
  const station = new THREE.Group();
  station.name = name;
  const frame = curveFrame(THREE, curve, ratio, up);
  applyRoutePose(THREE, station, frame.point, frame.tangent, up, 1, 0.04, {
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    back: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
  });

  addBox(THREE, station, shared.box, materials.platform, [3.05, 0.14, 0], [1.75, 0.14, 3.25], `${name} platform`);
  addBox(THREE, station, shared.box, materials.edge, [1.48, 0.3, 0], [0.08, 0.18, 3.25], `${name} safety edge`);
  addBox(THREE, station, shared.box, materials.timber, [4.25, 1.75, 1.95], [0.16, 1.75, 0.16], `${name} sign post`);
  addBox(THREE, station, shared.box, materials.timber, [4.25, 3.05, 1.95], [1.55, 0.48, 0.16], `${name} sign board`);

  const lantern = new THREE.Mesh(shared.lantern, materials.lantern);
  lantern.name = `${name} platform lantern`;
  lantern.position.set(2.15, 1.18, -2.45);
  station.add(lantern);

  if (makeLabelSprite) {
    const sprite = makeLabelSprite(label, '#ffd392');
    sprite.name = `${name} destination label`;
    sprite.position.set(4.25, 3.08, 1.76);
    sprite.scale.set(3.2, 0.55, 1);
    station.add(sprite);
  }
  return station;
}

/**
 * Builds the Nightfall cave railway in the cave group's local coordinate space.
 * The returned root should be added to the existing cave interior group.
 */
export function buildCaveMineTrain({
  THREE = THREE_NS,
  curve,
  routeLength = curve?.getLength(),
  innerRadius = 6.4,
  isTouchDevice = false,
  makeLabelSprite = null,
  up = DEFAULT_UP,
} = {}) {
  if (!curve || !Number.isFinite(routeLength) || routeLength <= 0) {
    throw new Error('buildCaveMineTrain requires a curve and a positive routeLength.');
  }

  const root = new THREE.Group();
  root.name = 'Nightfall mine railway';
  const infrastructure = new THREE.Group();
  infrastructure.name = 'Nightfall underground railway infrastructure';
  const train = new THREE.Group();
  train.name = 'Nightfall open-top mine train';
  root.add(infrastructure, train);

  const materials = {
    rail: new THREE.MeshStandardMaterial({ color: 0x34373b, roughness: 0.46, metalness: 0.86 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x4b2c1c, roughness: 0.96, metalness: 0.02, flatShading: true }),
    platform: new THREE.MeshStandardMaterial({ color: 0x30211c, roughness: 0.98, metalness: 0.03 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xd79a45, emissive: 0x3d1904, emissiveIntensity: 0.36, roughness: 0.74 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x17252a, roughness: 0.5, metalness: 0.78, flatShading: true }),
    oxidized: new THREE.MeshStandardMaterial({ color: 0x3b7169, roughness: 0.62, metalness: 0.58, flatShading: true }),
    copper: new THREE.MeshStandardMaterial({ color: 0x9f562f, roughness: 0.45, metalness: 0.68 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x512c23, roughness: 0.94, metalness: 0.02 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x151619, roughness: 0.5, metalness: 0.9 }),
    lens: new THREE.MeshStandardMaterial({
      color: 0xffe0a2,
      emissive: 0xff9f36,
      emissiveIntensity: 4.2,
      roughness: 0.2,
      metalness: 0.08,
      toneMapped: false,
    }),
    lantern: new THREE.MeshStandardMaterial({
      color: 0x82efff,
      emissive: 0x20b9d1,
      emissiveIntensity: 3.2,
      roughness: 0.22,
      toneMapped: false,
    }),
  };
  const shared = {
    box: new THREE.BoxGeometry(1, 1, 1),
    wheel: new THREE.CylinderGeometry(0.47, 0.47, 0.24, isTouchDevice ? 10 : 14),
    axle: new THREE.CylinderGeometry(0.11, 0.11, 2.5, 8),
    lantern: new THREE.OctahedronGeometry(0.2, 0),
  };

  const trackSamples = isTouchDevice ? 46 : 74;
  const railGauge = Math.min(1.24, innerRadius * 0.22);
  const railRadius = isTouchDevice ? 0.072 : 0.082;
  const leftRailCurve = makeRouteOffsetCurve(THREE, curve, -railGauge, 0.24, trackSamples, up);
  const rightRailCurve = makeRouteOffsetCurve(THREE, curve, railGauge, 0.24, trackSamples, up);
  const railSegments = isTouchDevice ? 68 : 104;
  const leftRail = new THREE.Mesh(new THREE.TubeGeometry(leftRailCurve, railSegments, railRadius, 6, false), materials.rail);
  const rightRail = new THREE.Mesh(new THREE.TubeGeometry(rightRailCurve, railSegments, railRadius, 6, false), materials.rail);
  leftRail.name = 'Nightfall railway left rail';
  rightRail.name = 'Nightfall railway right rail';
  leftRail.receiveShadow = rightRail.receiveShadow = true;
  infrastructure.add(leftRail, rightRail);

  const tieSpacing = isTouchDevice ? 2.55 : 1.85;
  const tieCount = Math.max(12, Math.floor(routeLength / tieSpacing));
  const tieGeometry = new THREE.BoxGeometry(railGauge * 2 + 0.82, 0.16, 0.36);
  const ties = new THREE.InstancedMesh(tieGeometry, materials.timber, tieCount);
  ties.name = 'Nightfall railway shared timber ties';
  ties.receiveShadow = true;
  ties.castShadow = false;
  const tieDummy = new THREE.Object3D();
  const tieFrame = { point: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() };
  const poseScratch = {
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    back: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
  };
  for (let index = 0; index < tieCount; index++) {
    const ratio = tieCount <= 1 ? 0 : index / (tieCount - 1);
    curveFrame(THREE, curve, ratio, up, tieFrame);
    applyRoutePose(THREE, tieDummy, tieFrame.point, tieFrame.tangent, up, 1, 0.12, poseScratch);
    tieDummy.updateMatrix();
    ties.setMatrixAt(index, tieDummy.matrix);
  }
  ties.instanceMatrix.needsUpdate = true;
  // This project currently uses a Three.js release without
  // InstancedMesh.computeBoundingSphere(). The railway is streamed as one cave
  // unit, so disabling per-mesh frustum culling is both compatible and avoids
  // a too-small geometry-only bound dropping distant ties.
  ties.frustumCulled = false;
  infrastructure.add(ties);

  const surfaceStation = buildStation({
    THREE,
    curve,
    ratio: 0,
    name: 'Nightfall surface station',
    label: 'MINE TRAIN · UNDERMARS',
    up,
    makeLabelSprite,
    materials,
    shared,
  });
  const chamberStation = buildStation({
    THREE,
    curve,
    ratio: 1,
    name: 'Vastwater cavern station',
    label: 'VASTWATER TERMINUS',
    up,
    makeLabelSprite,
    materials,
    shared,
  });
  // Keep the surface station outside the underground infrastructure group so
  // callers can hide the long rail run without hiding the station and parked
  // train at the cave mouth.
  root.add(surfaceStation);
  infrastructure.add(chamberStation);

  const sprungBody = new THREE.Group();
  sprungBody.name = 'Mine train sprung body';
  train.add(sprungBody);

  // The locomotive leads toward local -Z. Its compact boiler and open cab keep
  // the whole silhouette readable in the narrow tunnel.
  const locomotive = new THREE.Group();
  locomotive.name = 'Nightfall battery locomotive';
  locomotive.position.z = -2.05;
  sprungBody.add(locomotive);
  addBox(THREE, locomotive, shared.box, materials.iron, [0, 0.82, 0], [1.38, 0.42, 1.3], 'Mine locomotive lower chassis');
  addBox(THREE, locomotive, shared.box, materials.oxidized, [0, 1.42, -0.18], [1.16, 0.52, 0.88], 'Mine locomotive battery bonnet');
  addBox(THREE, locomotive, shared.box, materials.copper, [0, 1.56, 0.82], [1.22, 0.09, 0.12], 'Mine locomotive rear safety rail');
  [-1, 1].forEach((side) => {
    addBox(THREE, locomotive, shared.box, materials.copper, [side * 1.16, 1.66, 0.48], [0.07, 0.62, 0.07], 'Mine locomotive cab post');
  });
  addBox(THREE, locomotive, shared.box, materials.copper, [0, 2.24, 0.48], [1.23, 0.08, 0.7], 'Mine locomotive cab canopy');

  const headlampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.28, 12), materials.copper);
  headlampHousing.name = 'Mine locomotive headlamp housing';
  headlampHousing.rotation.x = Math.PI / 2;
  headlampHousing.position.set(0, 1.55, -1.08);
  locomotive.add(headlampHousing);
  const headlampLens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), materials.lens);
  headlampLens.name = 'Mine locomotive warm headlamp lens';
  headlampLens.position.set(0, 1.55, -1.235);
  headlampLens.rotation.y = Math.PI;
  locomotive.add(headlampLens);

  const headlight = new THREE.SpotLight(0xffb35d, isTouchDevice ? 17 : 24, 28, Math.PI / 7, 0.64, 1.35);
  headlight.name = 'Mine locomotive headlight';
  headlight.position.set(0, 1.55, -1.3);
  headlight.target.position.set(0, 0.45, -13);
  locomotive.add(headlight, headlight.target);

  const cart = new THREE.Group();
  cart.name = 'Open passenger ore cart';
  cart.position.z = 1.2;
  sprungBody.add(cart);
  addBox(THREE, cart, shared.box, materials.iron, [0, 0.72, 0.5], [1.46, 0.22, 1.48], 'Passenger cart underframe');
  addBox(THREE, cart, shared.box, materials.oxidized, [0, 1.14, 1.78], [1.44, 0.48, 0.1], 'Passenger cart rear wall');
  [-1, 1].forEach((side) => {
    const wall = addBox(THREE, cart, shared.box, materials.oxidized, [side * 1.36, 1.12, 0.5], [0.1, 0.5, 1.36], 'Passenger cart open side wall');
    wall.rotation.z = side * -0.08;
  });
  addBox(THREE, cart, shared.box, materials.seat, [0, 0.98, 1.1], [1.05, 0.16, 0.48], 'Passenger cart padded bench');
  addBox(THREE, cart, shared.box, materials.copper, [0, 0.7, -1.02], [0.18, 0.18, 0.34], 'Mine train coupling');

  const riderAnchor = new THREE.Object3D();
  riderAnchor.name = 'Mine train alien rider anchor';
  riderAnchor.position.set(0, 1.25, 1.06);
  cart.add(riderAnchor);

  const wheelGroups = [];
  const wheelRecords = [
    { parent: locomotive, z: -0.7 },
    { parent: locomotive, z: 0.72 },
    { parent: cart, z: -0.55 },
    { parent: cart, z: 1.35 },
  ];
  wheelRecords.forEach((record, axleIndex) => {
    const axle = new THREE.Mesh(shared.axle, materials.wheel);
    axle.name = `Mine train axle ${axleIndex + 1}`;
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.48, record.z);
    record.parent.add(axle);
    [-1, 1].forEach((side) => {
      const wheelGroup = new THREE.Group();
      wheelGroup.name = `Mine train wheel ${wheelGroups.length + 1}`;
      wheelGroup.position.set(side * 1.35, 0.48, record.z);
      const wheel = new THREE.Mesh(shared.wheel, materials.wheel);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      wheelGroup.add(wheel);
      record.parent.add(wheelGroup);
      wheelGroups.push(wheelGroup);
    });
  });

  const lanterns = [];
  [-1, 1].forEach((side) => {
    const lantern = new THREE.Mesh(shared.lantern, materials.lantern);
    lantern.name = `Passenger cart glow lantern ${side < 0 ? 'left' : 'right'}`;
    lantern.position.set(side * 1.16, 1.72, 1.55);
    cart.add(lantern);
    lanterns.push(lantern);
  });

  const frame = { point: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() };
  let wheelRotation = 0;
  let lastDistance = 0;
  let hasUpdated = false;
  const updateState = { ratio: 0, point: frame.point, tangent: frame.tangent, right: frame.right };

  function update({ distance = 0, direction = 1, speed = null, dt = 1 / 60, time = 0, visible = true } = {}) {
    const clampedDistance = THREE.MathUtils.clamp(distance, 0, routeLength);
    const ratio = clampedDistance / routeLength;
    curveFrame(THREE, curve, ratio, up, frame);
    applyRoutePose(THREE, train, frame.point, frame.tangent, up, direction, 0.5, poseScratch);
    train.visible = visible;

    const deltaDistance = hasUpdated ? clampedDistance - lastDistance : 0;
    const signedTravel = Number.isFinite(speed) ? speed * Math.max(0, dt) : deltaDistance;
    wheelRotation += signedTravel / 0.47;
    wheelGroups.forEach((wheel) => { wheel.rotation.x = wheelRotation; });

    const motion = Math.min(1, Math.abs(Number.isFinite(speed) ? speed : deltaDistance * 60) / 8);
    sprungBody.position.y = Math.sin(time * 10.5) * 0.025 * motion;
    sprungBody.rotation.z = Math.sin(time * 7.4) * 0.007 * motion;
    materials.lens.emissiveIntensity = 3.8 + Math.sin(time * 8.2) * 0.32;
    materials.lantern.emissiveIntensity = 2.9 + Math.sin(time * 3.1) * 0.22;
    headlight.intensity = visible ? (isTouchDevice ? 17 : 24) : 0;
    lastDistance = clampedDistance;
    hasUpdated = true;
    updateState.ratio = ratio;
    return updateState;
  }

  function setVisible(visible, { includeInfrastructure = true } = {}) {
    train.visible = visible;
    if (includeInfrastructure) infrastructure.visible = visible;
    surfaceStation.visible = visible;
    if (!visible) headlight.intensity = 0;
  }

  function getPose(distance = 0, direction = 1, target = {}) {
    const clampedDistance = THREE.MathUtils.clamp(distance, 0, routeLength);
    const ratio = clampedDistance / routeLength;
    curveFrame(THREE, curve, ratio, up, frame);
    target.position = target.position || new THREE.Vector3();
    target.quaternion = target.quaternion || new THREE.Quaternion();
    target.forward = target.forward || new THREE.Vector3();
    target.up = target.up || new THREE.Vector3();
    target.position.copy(frame.point).addScaledVector(up, 0.5);
    target.forward.copy(frame.tangent).multiplyScalar(direction >= 0 ? 1 : -1).normalize();
    target.up.copy(up);
    poseScratch.right.crossVectors(target.forward, up).normalize();
    poseScratch.back.copy(target.forward).multiplyScalar(-1);
    poseScratch.matrix.makeBasis(poseScratch.right, up, poseScratch.back);
    target.quaternion.setFromRotationMatrix(poseScratch.matrix);
    return target;
  }

  function dispose() {
    const geometries = new Set();
    const disposableMaterials = new Set();
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach((material) => disposableMaterials.add(material));
        else disposableMaterials.add(object.material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    disposableMaterials.forEach((material) => material.dispose());
  }

  update({ distance: 0, direction: 1, time: 0, visible: true });

  return {
    root,
    infrastructure,
    train,
    sprungBody,
    locomotive,
    cart,
    riderAnchor,
    headlight,
    headlampLens,
    lanterns,
    wheelGroups,
    leftRail,
    rightRail,
    ties,
    surfaceStation,
    chamberStation,
    routeLength,
    railGauge,
    update,
    getPose,
    setVisible,
    dispose,
  };
}
