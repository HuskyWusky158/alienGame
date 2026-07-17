/**
 * Build a four-bay garage carved into a Martian rock face.
 *
 * This module intentionally does not import Three.js. Passing the app's THREE
 * namespace avoids bundling a second copy and keeps it compatible with r150.
 */
export function buildRockGarage({
  THREE,
  normal,
  heading,
  position,
  quaternion,
  surfaceOffset = 0.06,
  surfacePosition,
  surfaceQuaternion,
  makeStandardMaterial,
  makeLabelSprite,
  isTouchDevice = false,
  name = 'ARES ROCK GARAGE',
  bayLabels = ['ROVER', 'VOLTWING', 'SERVICE', 'EXPEDITION'],
} = {}) {
  if (!THREE) throw new Error('buildRockGarage requires the project THREE namespace.');

  const UP = new THREE.Vector3(0, 1, 0);
  const surfaceNormal = normal?.clone().normalize() ?? UP.clone();
  const garageHeading = heading?.clone() ?? new THREE.Vector3(0, 0, -1);
  garageHeading.addScaledVector(surfaceNormal, -garageHeading.dot(surfaceNormal));
  if (garageHeading.lengthSq() < 0.000001) {
    const fallback = Math.abs(surfaceNormal.y) < 0.9 ? UP : new THREE.Vector3(0, 0, -1);
    garageHeading.copy(fallback).addScaledVector(surfaceNormal, -fallback.dot(surfaceNormal));
  }
  garageHeading.normalize();

  const root = new THREE.Group();
  root.name = `${name} · four-bay carved rock garage`;
  if (position) root.position.copy(position);
  else if (surfacePosition) root.position.copy(surfacePosition(surfaceNormal, surfaceOffset));
  if (quaternion) root.quaternion.copy(quaternion);
  else if (surfaceQuaternion) root.quaternion.copy(surfaceQuaternion(surfaceNormal, garageHeading));
  else {
    const right = garageHeading.clone().cross(surfaceNormal).normalize();
    root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      right,
      surfaceNormal,
      garageHeading.clone().multiplyScalar(-1)
    ));
  }

  const material = (color, options = {}) => makeStandardMaterial
    ? makeStandardMaterial(color, options)
    : new THREE.MeshStandardMaterial({ color, ...options });

  const createLabel = (text, color) => {
    if (makeLabelSprite) return makeLabelSprite(text, color);
    if (typeof document === 'undefined') {
      throw new Error('buildRockGarage needs makeLabelSprite outside a browser.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 144;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(16, 8, 5, 0.9)';
    context.fillRect(8, 8, 752, 128);
    context.strokeStyle = '#a76434';
    context.lineWidth = 8;
    context.strokeRect(8, 8, 752, 128);
    context.font = '900 58px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = '#1d0b04';
    context.lineWidth = 14;
    context.strokeText(text, 384, 75, 720);
    context.fillStyle = color;
    context.fillText(text, 384, 75, 720);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  };

  const rockMaterial = material(0xffffff, { roughness: 1, metalness: 0, flatShading: true });
  const interiorMaterial = material(0x241a19, {
    emissive: 0x0b0605,
    emissiveIntensity: 0.18,
    roughness: 0.94,
    metalness: 0.04,
  });
  const floorMaterial = material(0x35241f, { roughness: 0.88, metalness: 0.12 });
  const padMaterial = material(0x2c3134, { roughness: 0.58, metalness: 0.54 });
  const padRingMaterial = material(0xb77a45, {
    emissive: 0xff8a3a,
    emissiveIntensity: 1.3,
    roughness: 0.34,
    metalness: 0.38,
  });
  const workLightMaterial = material(0xffd09a, {
    emissive: 0xff8d3c,
    emissiveIntensity: 2.35,
    roughness: 0.28,
    metalness: 0.12,
    toneMapped: false,
  });

  const bayCount = 4;
  const baySpacing = 6.1;
  const bayCenters = Array.from(
    { length: bayCount },
    (_, index) => (index - (bayCount - 1) / 2) * baySpacing
  );
  const garageWidth = baySpacing * bayCount;
  const dummy = new THREE.Object3D();

  const rockBlocks = [];
  const addRock = (x, y, z, sx, sy, sz, color) => rockBlocks.push({ x, y, z, sx, sy, sz, color });

  // Five deep piers and one continuous ceiling leave four clear drive-through
  // mouths. A single slab avoids coplanar overlaps that shimmer as the camera
  // approaches the garage.
  for (let boundary = 0; boundary <= bayCount; boundary++) {
    const x = (boundary - bayCount / 2) * baySpacing;
    addRock(x, 2.45, 0.25, boundary === 0 || boundary === bayCount ? 1.5 : 0.78, 4.9, 8.9, 0x623a2b);
  }
  addRock(0, 5.45, 0.25, garageWidth + 0.32, 1.18, 9.25, 0x68402f);

  // Irregular horizontal courses and battered side banks sell the excavation.
  const courseColors = [0x8a5033, 0x6f3e2c, 0x9a5c3b, 0x583128];
  for (let course = 0; course < 4; course++) {
    const y = 6.15 + course * 0.68;
    const inset = course * 0.48;
    const span = (garageWidth + 5 - inset * 2) / 7;
    for (let segment = 0; segment < 7; segment++) {
      const x = -(garageWidth + 5) * 0.5 + inset + span * (segment + 0.5);
      addRock(
        x + Math.sin(segment * 2.7 + course) * 0.16,
        y + Math.sin(segment * 1.9) * 0.08,
        0.15 + course * 0.24,
        span - 0.12,
        0.82,
        9.5 - course * 0.32,
        courseColors[(course + segment) % courseColors.length]
      );
    }
  }
  [-1, 1].forEach((side) => {
    for (let layer = 0; layer < 5; layer++) {
      addRock(
        side * (garageWidth * 0.5 + 1.1 + layer * 0.72),
        1.05 + layer * 0.95,
        0.8 + layer * 0.18,
        2.5,
        2.2,
        10.2 - layer * 0.5,
        courseColors[(layer + (side > 0 ? 1 : 0)) % courseColors.length]
      );
    }
  });

  const rockShell = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rockMaterial, rockBlocks.length);
  rockShell.name = 'Garage carved sandstone shell and strata';
  rockBlocks.forEach((block, index) => {
    dummy.position.set(block.x, block.y, block.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(block.sx, block.sy, block.sz);
    dummy.updateMatrix();
    rockShell.setMatrixAt(index, dummy.matrix);
    rockShell.setColorAt(index, new THREE.Color(block.color));
  });
  rockShell.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  rockShell.instanceMatrix.needsUpdate = true;
  if (rockShell.instanceColor) rockShell.instanceColor.needsUpdate = true;
  root.add(rockShell);

  const interiorWalls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), interiorMaterial, bayCount);
  bayCenters.forEach((x, index) => {
    dummy.position.set(x, 2.35, 4.55);
    dummy.scale.set(baySpacing - 0.82, 4.6, 0.28);
    dummy.updateMatrix();
    interiorWalls.setMatrixAt(index, dummy.matrix);
  });
  interiorWalls.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  interiorWalls.instanceMatrix.needsUpdate = true;
  root.add(interiorWalls);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(garageWidth + 0.9, 0.24, 10.2), floorMaterial);
  floor.name = 'Garage compacted service floor';
  floor.position.set(0, 0.01, 0.15);
  root.add(floor);

  const pads = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(2.05, 2.18, 0.16, isTouchDevice ? 18 : 28),
    padMaterial,
    bayCount
  );
  const ringGeometry = new THREE.TorusGeometry(1.72, 0.075, 6, isTouchDevice ? 24 : 38);
  ringGeometry.rotateX(Math.PI / 2);
  const padRings = new THREE.InstancedMesh(ringGeometry, padRingMaterial, bayCount);
  bayCenters.forEach((x, index) => {
    dummy.position.set(x, 0.2, 0.35);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pads.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 0.31;
    dummy.updateMatrix();
    padRings.setMatrixAt(index, dummy.matrix);
  });
  pads.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  padRings.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  pads.instanceMatrix.needsUpdate = true;
  padRings.instanceMatrix.needsUpdate = true;
  root.add(pads, padRings);

  // Three emissive strips per bay define each doorway for only one draw call.
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), workLightMaterial, bayCount * 3);
  let stripIndex = 0;
  bayCenters.forEach((x) => {
    [
      [x, 4.55, -4.38, 4.55, 0.12, 0.12],
      [x - 2.31, 2.45, -4.34, 0.1, 3.35, 0.1],
      [x + 2.31, 2.45, -4.34, 0.1, 3.35, 0.1],
    ].forEach(([px, py, pz, sx, sy, sz]) => {
      dummy.position.set(px, py, pz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      strips.setMatrixAt(stripIndex++, dummy.matrix);
    });
  });
  strips.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  strips.instanceMatrix.needsUpdate = true;
  root.add(strips);

  const signs = bayCenters.map((x, index) => {
    const label = bayLabels[index] ?? `BAY ${index + 1}`;
    const sign = createLabel(`BAY ${index + 1} · ${label}`, '#ffe2ad');
    sign.name = `Garage bay ${index + 1} readable sign`;
    sign.position.set(x, 5.05, -4.58);
    sign.scale.set(4.7, 0.88, 1);
    root.add(sign);
    return sign;
  });
  const garageSign = createLabel(name, '#ffd091');
  garageSign.name = 'Garage title sign';
  garageSign.position.set(0, 8.9, -4.05);
  garageSign.scale.set(8.8, 1.12, 1);
  root.add(garageSign);

  // Two short-range shadowless lights cover all four bays. The emissive strips
  // give each bay its own fixture without adding four light calculations.
  const lights = [-baySpacing, baySpacing].map((x, index) => {
    const light = new THREE.PointLight(index === 0 ? 0xffa55e : 0xffbd73, 3.8, 15, 2);
    light.name = `Garage warm work light ${index + 1}`;
    light.position.set(x, 3.9, -0.2);
    light.castShadow = false;
    root.add(light);
    return light;
  });

  const localInward = new THREE.Vector3(0, 0, 1);
  const localOutward = new THREE.Vector3(0, 0, -1);
  const bays = bayCenters.map((x, index) => {
    const anchorRoot = new THREE.Group();
    anchorRoot.name = `Garage bay ${index + 1} anchors`;
    const parking = new THREE.Object3D();
    const entry = new THREE.Object3D();
    const approach = new THREE.Object3D();
    parking.name = `Bay ${index + 1} parking anchor`;
    entry.name = `Bay ${index + 1} entry anchor`;
    approach.name = `Bay ${index + 1} approach anchor`;
    parking.position.set(x, 0.3, 0.35);
    entry.position.set(x, 0.3, -4.9);
    approach.position.set(x, 0.3, -10.5);
    [parking, entry, approach].forEach((anchor) => anchor.quaternion.setFromAxisAngle(UP, Math.PI));
    anchorRoot.add(parking, entry, approach);
    root.add(anchorRoot);
    return {
      index,
      key: `bay-${index + 1}`,
      label: bayLabels[index] ?? `BAY ${index + 1}`,
      anchors: { root: anchorRoot, parking, entry, approach },
      local: {
        parkingPosition: parking.position.clone(),
        entryPosition: entry.position.clone(),
        approachPosition: approach.position.clone(),
        inward: localInward.clone(),
        outward: localOutward.clone(),
        parkingQuaternion: parking.quaternion.clone(),
      },
      world: {
        parkingPosition: new THREE.Vector3(),
        entryPosition: new THREE.Vector3(),
        approachPosition: new THREE.Vector3(),
        inward: new THREE.Vector3(),
        outward: new THREE.Vector3(),
        parkingQuaternion: new THREE.Quaternion(),
      },
    };
  });

  const updateWorldAnchors = () => {
    root.updateWorldMatrix(true, true);
    bays.forEach((bay) => {
      bay.anchors.parking.getWorldPosition(bay.world.parkingPosition);
      bay.anchors.entry.getWorldPosition(bay.world.entryPosition);
      bay.anchors.approach.getWorldPosition(bay.world.approachPosition);
      bay.world.inward.copy(bay.local.inward).transformDirection(root.matrixWorld);
      bay.world.outward.copy(bay.local.outward).transformDirection(root.matrixWorld);
      bay.anchors.parking.getWorldQuaternion(bay.world.parkingQuaternion);
    });
    return bays;
  };
  updateWorldAnchors();

  return {
    root,
    bays,
    lights,
    signs,
    garageSign,
    meshes: { rockShell, interiorWalls, floor, pads, padRings, emissiveStrips: strips },
    materials: {
      rockMaterial,
      interiorMaterial,
      floorMaterial,
      padMaterial,
      padRingMaterial,
      workLightMaterial,
    },
    updateWorldAnchors,
  };
}

export default buildRockGarage;
