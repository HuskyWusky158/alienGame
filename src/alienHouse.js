import { createProceduralRockGeometry, createProceduralRockMaterial } from './proceduralRocks.js';

/**
 * Build an enterable, terrain-matched Martian mountain home.
 *
 * The model is authored in local tangent-space: +Y is outward/up and the
 * front door faces -Z. The caller owns planet placement so the same asset can
 * sit cleanly on any surface normal without importing a second copy of Three.
 */
export function buildAlienMountainHouse({
  THREE,
  makeStandardMaterial,
  makeLabelSprite,
  isTouchDevice = false,
  name = "ALIEN'S MOUNTAIN HOME",
} = {}) {
  if (!THREE) throw new Error('buildAlienMountainHouse requires the project THREE namespace.');

  const root = new THREE.Group();
  root.name = 'Enterable Martian mountain home and alien tree grove';

  const material = (color, options = {}) => makeStandardMaterial
    ? makeStandardMaterial(color, options)
    : new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08, ...options });

  const shellMaterial = material(0xffffff, { roughness: 1, metalness: 0, flatShading: true });
  const interiorMaterial = material(0x6b3d30, { roughness: 0.96, metalness: 0, flatShading: true });
  const floorMaterial = material(0x38231f, { roughness: 0.93, metalness: 0.04 });
  const roofMaterial = material(0x4b2925, { roughness: 0.98, metalness: 0.01, flatShading: true });
  const woodMaterial = material(0x4c2c22, { roughness: 0.89, metalness: 0.02, flatShading: true });
  const darkMetalMaterial = material(0x20262a, { roughness: 0.5, metalness: 0.62 });
  const applianceMaterial = material(0x42575a, { roughness: 0.48, metalness: 0.48 });
  const fabricMaterial = material(0xa85843, { roughness: 0.96, metalness: 0 });
  const linenMaterial = material(0xd8b48c, { roughness: 0.9, metalness: 0 });
  const bathMaterial = material(0x89a69d, { roughness: 0.38, metalness: 0.16 });
  const waterMaterial = material(0x55d9d0, {
    emissive: 0x0a554f,
    emissiveIntensity: 0.5,
    roughness: 0.18,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82,
  });
  const glowMaterial = material(0xffc27d, {
    emissive: 0xff7b35,
    emissiveIntensity: 2.1,
    roughness: 0.3,
    metalness: 0.08,
    toneMapped: false,
  });
  const windowMaterial = material(0x82e1d6, {
    emissive: 0x1b736d,
    emissiveIntensity: 1.05,
    roughness: 0.24,
    metalness: 0.12,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });

  const dummy = new THREE.Object3D();
  const addInstancedBoxes = (records, batchMaterial, batchName, colors = false) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), batchMaterial, records.length);
    mesh.name = batchName;
    records.forEach((record, index) => {
      dummy.position.set(record.x, record.y, record.z);
      dummy.rotation.set(record.rx ?? 0, record.ry ?? 0, record.rz ?? 0);
      dummy.scale.set(record.sx, record.sy, record.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (colors && record.color != null) mesh.setColorAt(index, new THREE.Color(record.color));
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !isTouchDevice;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // A broad sandstone shell with the center of the front wall deliberately
  // omitted. The doorway is therefore real geometry, not a dark painted door.
  const shellBlocks = [
    { x: -7.2, y: 2.65, z: -9, sx: 7.6, sy: 5.3, sz: 0.72, color: 0x8a5038 },
    { x: 7.2, y: 2.65, z: -9, sx: 7.6, sy: 5.3, sz: 0.72, color: 0x7a422f },
    { x: 0, y: 4.78, z: -9, sx: 6.8, sy: 1.05, sz: 0.72, color: 0x9a5d3d },
    { x: -10.65, y: 2.65, z: 0, sx: 0.72, sy: 5.3, sz: 18.7, color: 0x70402f },
    { x: 10.65, y: 2.65, z: 0, sx: 0.72, sy: 5.3, sz: 18.7, color: 0x83503a },
    { x: 0, y: 2.65, z: 9, sx: 21.3, sy: 5.3, sz: 0.72, color: 0x704033 },
    // Deep stone jambs make the entry readable at driving distance.
    { x: -3.7, y: 2.05, z: -9.28, sx: 0.65, sy: 4.1, sz: 1.08, color: 0xa16646 },
    { x: 3.7, y: 2.05, z: -9.28, sx: 0.65, sy: 4.1, sz: 1.08, color: 0x9b5d40 },
  ];
  const shell = addInstancedBoxes(shellBlocks, shellMaterial, 'Batched variegated Martian stone house shell', true);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(20.62, 0.34, 17.6), floorMaterial);
  floor.name = 'Stable continuous mountain-home walking floor';
  floor.position.set(0, 0.03, 0);
  floor.receiveShadow = true;
  root.add(floor);
  const floorY = 0.21;

  const threshold = new THREE.Mesh(new THREE.BoxGeometry(6.65, 0.24, 4.7), floorMaterial);
  threshold.name = 'Door threshold connected to mountain trail';
  threshold.position.set(0, 0.01, -11.18);
  threshold.receiveShadow = true;
  root.add(threshold);

  // Partition segments leave three generous physical door gaps. Furniture is
  // kept away from these channels so walking integration needs no collision
  // exceptions to visit every room.
  const partitions = [
    { x: -9.05, y: 2.45, z: 1.45, sx: 3.2, sy: 4.9, sz: 0.32 },
    { x: -1.48, y: 2.45, z: 1.45, sx: 7.65, sy: 4.9, sz: 0.32 },
    { x: 7.75, y: 2.45, z: 1.45, sx: 5.8, sy: 4.9, sz: 0.32 },
    { x: 5.25, y: 2.45, z: 6.55, sx: 0.32, sy: 4.9, sz: 4.65 },
    { x: 5.25, y: 4.45, z: 3.05, sx: 0.32, sy: 0.9, sz: 2.35 },
    { x: 5.25, y: 1.02, z: 3.05, sx: 0.32, sy: 2.05, sz: 2.35 },
  ];
  const interiorWalls = addInstancedBoxes(partitions, interiorMaterial, 'Batched interior adobe room partitions');

  // Two heavy roof planes read as a lodge roof from afar while their irregular
  // foundation stones tie the silhouette back to the surrounding mountain.
  const roofSlabs = [
    { x: -4.95, y: 6.9, z: 0, sx: 11.4, sy: 0.62, sz: 19.7, rz: 0.33 },
    { x: 4.95, y: 6.9, z: 0, sx: 11.4, sy: 0.62, sz: 19.7, rz: -0.33 },
  ];
  const roof = addInstancedBoxes(roofSlabs, roofMaterial, 'Batched iron-rich stone lodge roof');

  const rockRecords = [];
  const rockColors = [0x713b2d, 0x8d5035, 0x613128, 0xa05e3e];
  for (let index = 0; index < 32; index++) {
    const side = index % 2 === 0 ? -1 : 1;
    const alongSide = index < 16;
    const x = alongSide ? side * (10.8 + (index % 5) * 0.3) : -9.8 + (index - 16) * 1.31;
    const z = alongSide ? -8.4 + (index % 8) * 2.35 : (index % 2 ? -9.35 : 9.35);
    const scale = 0.62 + ((index * 7) % 9) * 0.085;
    rockRecords.push({
      x,
      y: scale * 0.44,
      z,
      scale,
      ry: index * 1.71,
      color: rockColors[index % rockColors.length],
    });
  }
  const rockGeometry = createProceduralRockGeometry({
    THREE,
    seed: 0x40a5e123,
    detail: isTouchDevice ? 1 : 2,
    archetype: 'dusted',
  });
  const foundationRockMaterial = createProceduralRockMaterial({
    THREE,
    color: 0xffffff,
    seed: 0x40a5e123,
    roughness: 1,
    bumpScale: 0.065,
    textureSize: isTouchDevice ? 64 : 96,
    dustColor: 0xc07a52,
    dustStrength: 0.24,
  });
  const foundationRocks = new THREE.InstancedMesh(rockGeometry, foundationRockMaterial, rockRecords.length);
  foundationRocks.name = 'Batched natural mountain foundation stones';
  rockRecords.forEach((rock, index) => {
    dummy.position.set(rock.x, rock.y, rock.z);
    dummy.rotation.set(index * 0.11, rock.ry, index * 0.07);
    dummy.scale.set(rock.scale * 1.25, rock.scale, rock.scale * 1.12);
    dummy.updateMatrix();
    foundationRocks.setMatrixAt(index, dummy.matrix);
    foundationRocks.setColorAt(index, new THREE.Color(rock.color));
  });
  foundationRocks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  foundationRocks.instanceMatrix.needsUpdate = true;
  if (foundationRocks.instanceColor) foundationRocks.instanceColor.needsUpdate = true;
  foundationRocks.castShadow = false;
  foundationRocks.receiveShadow = true;
  root.add(foundationRocks);

  // Common room: a low stone table and two benches establish domestic scale.
  const woodRecords = [
    { x: 0, y: 0.92, z: -2.45, sx: 4.1, sy: 0.22, sz: 1.8 },
    { x: -1.72, y: 0.48, z: -2.45, sx: 0.22, sy: 0.94, sz: 1.35 },
    { x: 1.72, y: 0.48, z: -2.45, sx: 0.22, sy: 0.94, sz: 1.35 },
    { x: 0, y: 0.5, z: -4.02, sx: 3.7, sy: 0.18, sz: 0.65 },
    { x: 0, y: 0.5, z: -0.9, sx: 3.7, sy: 0.18, sz: 0.65 },
    // Bed platform, headboard, bedside table, and wardrobe.
    { x: 1.72, y: 0.48, z: 6.35, sx: 3.7, sy: 0.62, sz: 4.4 },
    { x: 1.72, y: 1.34, z: 8.28, sx: 3.9, sy: 2.15, sz: 0.24 },
    { x: 4.24, y: 0.62, z: 7.3, sx: 0.92, sy: 1.24, sz: 1.05 },
    { x: -0.96, y: 1.42, z: 6.72, sx: 1.05, sy: 2.84, sz: 3.3 },
  ];
  const woodFurnishings = addInstancedBoxes(woodRecords, woodMaterial, 'Batched home table, benches, and bedroom furniture');

  const kitchenRecords = [
    { x: -6.72, y: 0.68, z: 8.08, sx: 6.35, sy: 1.35, sz: 1.18 },
    { x: -9.64, y: 0.68, z: 5.67, sx: 1.08, sy: 1.35, sz: 3.7 },
    { x: -5.78, y: 0.72, z: 3.76, sx: 3.35, sy: 1.44, sz: 1.25 },
  ];
  const counters = addInstancedBoxes(kitchenRecords, applianceMaterial, 'Batched Martian kitchen counters and island');
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.85, 1.35), applianceMaterial);
  fridge.name = 'Kitchen cold-storage cabinet';
  fridge.position.set(-9.15, 1.52, 7.35);
  root.add(fridge);
  const fridgeSeam = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.045, 0.04), glowMaterial);
  fridgeSeam.position.set(-9.15, 1.55, 6.66);
  root.add(fridgeSeam);

  const stoveTop = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.11, 0.92), darkMetalMaterial);
  stoveTop.name = 'Induction cooking surface';
  stoveTop.position.set(-4.55, 1.42, 8.05);
  root.add(stoveTop);
  const burnerGeometry = new THREE.TorusGeometry(0.25, 0.035, 5, 14);
  burnerGeometry.rotateX(Math.PI / 2);
  const burners = new THREE.InstancedMesh(burnerGeometry, glowMaterial, 4);
  [[-5.05, 7.82], [-4.08, 7.82], [-5.05, 8.25], [-4.08, 8.25]].forEach(([x, z], index) => {
    dummy.position.set(x, 1.495, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    burners.setMatrixAt(index, dummy.matrix);
  });
  burners.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  burners.instanceMatrix.needsUpdate = true;
  root.add(burners);
  const sink = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.16, 0.78), waterMaterial);
  sink.name = 'Luminous kitchen sink basin';
  sink.position.set(-7.25, 1.45, 8.04);
  root.add(sink);

  const mattress = new THREE.Mesh(new THREE.BoxGeometry(3.36, 0.34, 3.95), fabricMaterial);
  mattress.name = 'Bedroom rust-red mattress';
  mattress.position.set(1.72, 0.96, 6.25);
  root.add(mattress);
  const pillowGeometry = new THREE.BoxGeometry(1.18, 0.26, 0.62);
  const pillows = new THREE.InstancedMesh(pillowGeometry, linenMaterial, 2);
  [-0.73, 0.73].forEach((offset, index) => {
    dummy.position.set(1.72 + offset, 1.28, 7.72);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pillows.setMatrixAt(index, dummy.matrix);
  });
  pillows.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  pillows.instanceMatrix.needsUpdate = true;
  root.add(pillows);

  // Bathroom silhouettes are intentionally exaggerated enough to read from a
  // third-person camera: tub, glowing water, toilet, basin, and shower glass.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.9, 1.68), bathMaterial);
  tub.name = 'Bathroom soaking tub';
  tub.position.set(7.75, 0.58, 7.48);
  root.add(tub);
  const tubWater = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.08, 1.14), waterMaterial);
  tubWater.position.set(7.75, 1.05, 7.48);
  root.add(tubWater);
  const toiletBase = new THREE.Mesh(new THREE.CylinderGeometry(0.49, 0.6, 0.72, 12), bathMaterial);
  toiletBase.name = 'Bathroom toilet';
  toiletBase.position.set(9.22, 0.54, 4.8);
  root.add(toiletBase);
  const toiletTank = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.5), bathMaterial);
  toiletTank.position.set(9.22, 1.08, 5.25);
  root.add(toiletTank);
  const basinStand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.42, 1.05, 10), bathMaterial);
  basinStand.position.set(6.2, 0.66, 5.25);
  root.add(basinStand);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.55, 0.3, 12), waterMaterial);
  basin.position.set(6.2, 1.28, 5.25);
  root.add(basin);
  const showerGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 3.4),
    windowMaterial
  );
  showerGlass.name = 'Translucent bathroom shower screen';
  showerGlass.position.set(9.15, 1.86, 6.4);
  showerGlass.rotation.y = -Math.PI / 2;
  root.add(showerGlass);

  // Exterior and interior windows use emissive material rather than extra
  // lights, preserving the warm occupied silhouette without shadow cost.
  const windowRecords = [
    { x: -7.35, y: 3.06, z: -9.39, sx: 2.5, sy: 1.55, sz: 0.05 },
    { x: 7.35, y: 3.06, z: -9.39, sx: 2.5, sy: 1.55, sz: 0.05 },
    { x: -10.99, y: 3.04, z: 3.8, sx: 0.05, sy: 1.5, sz: 2.35 },
    { x: 10.99, y: 3.04, z: 3.8, sx: 0.05, sy: 1.5, sz: 2.35 },
  ];
  const windows = addInstancedBoxes(windowRecords, windowMaterial, 'Batched luminous mountain-home windows');

  const doorLight = new THREE.PointLight(0xff9a52, isTouchDevice ? 2.5 : 3.6, 12, 2);
  doorLight.name = 'Warm doorway light';
  doorLight.position.set(0, 3.3, -6.75);
  doorLight.castShadow = false;
  root.add(doorLight);
  const roomLight = new THREE.PointLight(0xffd09c, isTouchDevice ? 2.1 : 3.2, 15, 2);
  roomLight.name = 'Warm interior room light';
  roomLight.position.set(-1.5, 4.15, 2.3);
  roomLight.castShadow = false;
  root.add(roomLight);
  const bathroomLight = new THREE.PointLight(0x7dfff1, isTouchDevice ? 1.2 : 1.8, 7, 2);
  bathroomLight.name = 'Soft bathroom aqua light';
  bathroomLight.position.set(7.9, 3.5, 6.2);
  bathroomLight.castShadow = false;
  root.add(bathroomLight);

  // An irregular grove of tall, drought-adapted alien conifers surrounds the
  // lodge while preserving a wide clear approach from the trail at -Z.
  const treePositions = [
    [-17.5, -13.8, 1.05], [-21.2, -6.4, 1.22], [-20.4, 2.8, 0.92], [-19.1, 11.5, 1.18],
    [-13.5, 16.5, 1.3], [-6.4, 18.5, 0.98], [2.6, 19.3, 1.15], [10.8, 17.2, 1.28],
    [17.6, 13.3, 0.94], [21.6, 5.8, 1.26], [21.1, -3.2, 1.05], [18.3, -11.5, 1.18],
    [13.2, -16.4, 1.34], [-12.1, -18.2, 0.96], [-24.2, 14.8, 0.86], [24.5, 14.3, 0.9],
    [-25.1, 3.2, 1.02], [25.2, -7.6, 1.06],
  ];
  const trunkMaterial = material(0x3b2a28, { roughness: 1, metalness: 0, flatShading: true });
  const crownMaterial = material(0xffffff, {
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
    emissive: 0x102d29,
    emissiveIntensity: 0.28,
  });
  const trunkGeometry = new THREE.CylinderGeometry(0.38, 0.68, 5.1, 7);
  const crownGeometry = new THREE.ConeGeometry(2.35, 5.8, 8);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treePositions.length * 2);
  trunks.name = 'Batched ironwood grove trunks';
  crowns.name = 'Batched blue-green alien conifer crowns';
  treePositions.forEach(([x, z, scale], index) => {
    dummy.position.set(x, 2.4 * scale, z);
    dummy.rotation.set(0, index * 2.11, Math.sin(index * 4.1) * 0.045);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    for (let tier = 0; tier < 2; tier++) {
      dummy.position.set(x, (5.15 + tier * 2.45) * scale, z);
      dummy.rotation.set(0, index * 1.17 + tier * 0.72, 0);
      dummy.scale.set(scale * (tier === 0 ? 1 : 0.72), scale, scale * (tier === 0 ? 1 : 0.72));
      dummy.updateMatrix();
      const crownIndex = index * 2 + tier;
      crowns.setMatrixAt(crownIndex, dummy.matrix);
      const crownColor = new THREE.Color(tier === 0 ? 0x39786b : 0x56a08b);
      crownColor.offsetHSL(Math.sin(index * 3.7) * 0.025, 0, Math.sin(index * 1.9) * 0.035);
      crowns.setColorAt(crownIndex, crownColor);
    }
  });
  [trunks, crowns].forEach((batch) => {
    batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    batch.castShadow = false;
    batch.receiveShadow = true;
    root.add(batch);
  });

  const labels = [];
  if (makeLabelSprite) {
    const labelSpecs = [
      [name, '#ffd19d', 0, 4.72, -9.72, 7.4, 0.96],
      ['KITCHEN', '#a9fff2', -6.6, 3.55, 1.19, 3.55, 0.72],
      ['BEDROOM', '#ffd3b1', 2.95, 3.55, 1.19, 3.65, 0.72],
      ['BATHROOM', '#9ffff6', 5.04, 3.82, 5.75, 3.35, 0.68],
    ];
    labelSpecs.forEach(([text, color, x, y, z, sx, sy], index) => {
      const label = makeLabelSprite(text, color);
      label.name = `${text} home label`;
      label.position.set(x, y, z);
      label.scale.set(sx, sy, 1);
      root.add(label);
      labels.push(label);
    });
  }

  const anchors = {
    approach: new THREE.Object3D(),
    threshold: new THREE.Object3D(),
    interior: new THREE.Object3D(),
    kitchen: new THREE.Object3D(),
    bedroom: new THREE.Object3D(),
    bathroom: new THREE.Object3D(),
  };
  anchors.approach.position.set(0, floorY, -17);
  anchors.threshold.position.set(0, floorY, -9.1);
  anchors.interior.position.set(0, floorY, -4.8);
  anchors.kitchen.position.set(-6.15, floorY, 4.2);
  anchors.bedroom.position.set(1.9, floorY, 4.4);
  anchors.bathroom.position.set(7.8, floorY, 5.5);
  Object.entries(anchors).forEach(([key, anchor]) => {
    anchor.name = `Mountain home ${key} anchor`;
    root.add(anchor);
  });

  const local = {
    forward: new THREE.Vector3(0, 0, -1),
    inward: new THREE.Vector3(0, 0, 1),
    floorY,
    bounds: {
      min: new THREE.Vector3(-10.3, floorY, -8.75),
      max: new THREE.Vector3(10.3, floorY, 8.75),
    },
    thresholdBounds: {
      min: new THREE.Vector3(-3.25, floorY, -13.45),
      max: new THREE.Vector3(3.25, floorY, -8.7),
    },
    doorway: {
      center: new THREE.Vector3(0, 2.05, -9.38),
      width: 6.7,
      height: 4.1,
      minX: -3.35,
      maxX: 3.35,
      minY: floorY,
      maxY: 4.1,
      planeZ: -9.38,
      outward: new THREE.Vector3(0, 0, -1),
      inward: new THREE.Vector3(0, 0, 1),
    },
    clearChannels: [
      { name: 'front entry', minX: -3.1, maxX: 3.1, minZ: -13.4, maxZ: -0.2 },
      { name: 'kitchen entry', minX: -7.75, maxX: -4.5, minZ: 0.9, maxZ: 2.05 },
      { name: 'bedroom entry', minX: 1.5, maxX: 4.5, minZ: 0.9, maxZ: 2.05 },
      { name: 'bathroom entry', minX: 4.75, maxX: 5.75, minZ: 1.85, maxZ: 4.25 },
    ],
    rooms: {
      common: { minX: -9.9, maxX: 9.9, minZ: -8.7, maxZ: 1.2 },
      kitchen: { minX: -10.15, maxX: -2.0, minZ: 1.7, maxZ: 8.65 },
      bedroom: { minX: -1.8, maxX: 5.0, minZ: 1.7, maxZ: 8.65 },
      bathroom: { minX: 5.5, maxX: 10.15, minZ: 3.7, maxZ: 8.65 },
    },
    groveRadius: 27,
    structureRadius: 14.5,
  };

  const world = {
    approachPosition: new THREE.Vector3(),
    thresholdPosition: new THREE.Vector3(),
    interiorPosition: new THREE.Vector3(),
    kitchenPosition: new THREE.Vector3(),
    bedroomPosition: new THREE.Vector3(),
    bathroomPosition: new THREE.Vector3(),
    outward: new THREE.Vector3(),
    inward: new THREE.Vector3(),
  };
  const updateWorldAnchors = () => {
    root.updateWorldMatrix(true, true);
    anchors.approach.getWorldPosition(world.approachPosition);
    anchors.threshold.getWorldPosition(world.thresholdPosition);
    anchors.interior.getWorldPosition(world.interiorPosition);
    anchors.kitchen.getWorldPosition(world.kitchenPosition);
    anchors.bedroom.getWorldPosition(world.bedroomPosition);
    anchors.bathroom.getWorldPosition(world.bathroomPosition);
    world.outward.copy(local.forward).transformDirection(root.matrixWorld);
    world.inward.copy(local.inward).transformDirection(root.matrixWorld);
    return world;
  };

  // Mark only the compact structure for dynamic shadows. The large grove and
  // foundation receive lighting but avoid multiplying the shadow-map cost.
  [floor, threshold, fridge, stoveTop, sink, mattress, tub, toiletBase, toiletTank, basinStand, basin].forEach((mesh) => {
    mesh.castShadow = !isTouchDevice;
    mesh.receiveShadow = true;
  });

  updateWorldAnchors();
  return {
    root,
    anchors,
    local,
    world,
    rooms: local.rooms,
    lights: [doorLight, roomLight, bathroomLight],
    labels,
    meshes: {
      shell,
      roof,
      floor,
      threshold,
      interiorWalls,
      foundationRocks,
      woodFurnishings,
      counters,
      windows,
      trunks,
      crowns,
      tubWater,
    },
    materials: {
      shellMaterial,
      interiorMaterial,
      floorMaterial,
      roofMaterial,
      woodMaterial,
      applianceMaterial,
      fabricMaterial,
      bathMaterial,
      waterMaterial,
      glowMaterial,
      windowMaterial,
    },
    updateWorldAnchors,
  };
}

export default buildAlienMountainHouse;
