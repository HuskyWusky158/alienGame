import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const BACK = new THREE.Vector3(0, 0, -1);

function tangentBasis(normal) {
  const reference = Math.abs(normal.y) < 0.9 ? UP : BACK;
  const forward = reference.clone().addScaledVector(normal, -reference.dot(normal)).normalize();
  const right = forward.clone().cross(normal).normalize();
  return { forward, right };
}

function exponentialMap(center, direction, distance, radius, target = new THREE.Vector3()) {
  const angle = distance / radius;
  return target.copy(center).multiplyScalar(Math.cos(angle))
    .addScaledVector(direction, Math.sin(angle))
    .normalize();
}

function courseNormalAt(course, ratio, radius, target = new THREE.Vector3()) {
  const angle = ratio * Math.PI * 2;
  const radialWobble = 1
    + Math.sin(angle * course.waves + course.phase) * course.waveAmount
    + Math.sin(angle * (course.waves + 2) - course.phase * 0.7) * course.waveAmount * 0.36;
  const x = Math.cos(angle) * course.radiusX * radialWobble;
  const z = Math.sin(angle) * course.radiusZ * radialWobble;
  const distance = Math.hypot(x, z);
  course.direction.copy(course.basis.right).multiplyScalar(x)
    .addScaledVector(course.basis.forward, z)
    .normalize();
  return exponentialMap(course.centerNormal, course.direction, distance, radius, target);
}

function buildRoadGeometry(course, {
  radius,
  surfacePosition,
  isTouchDevice,
}) {
  const steps = isTouchDevice ? 112 : 168;
  const lanes = [-course.width, -course.width + 0.26, 0, course.width - 0.26, course.width];
  const laneColors = [course.edgeColor, course.roadColor, course.centerColor, course.roadColor, course.edgeColor]
    .map((color) => new THREE.Color(color));
  const routeNormals = Array.from({ length: steps }, (_, index) => (
    courseNormalAt(course, index / steps, radius)
  ));
  routeNormals.push(routeNormals[0].clone());
  const positions = [];
  const colors = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const sideNormal = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  for (let index = 0; index <= steps; index++) {
    const normal = routeNormals[index];
    const previous = routeNormals[(index - 1 + steps) % steps];
    const next = routeNormals[(index + 1) % steps];
    tangent.copy(next).sub(previous);
    tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
    right.copy(tangent).cross(normal).normalize();
    axis.crossVectors(normal, right).normalize();
    const texturePulse = 0.9 + Math.sin(index * 1.77 + course.phase) * 0.055;
    lanes.forEach((lateral, laneIndex) => {
      const sideAngle = lateral / radius;
      sideNormal.copy(normal).applyAxisAngle(axis, sideAngle).normalize();
      worldPosition.copy(surfacePosition(sideNormal, (course.lift ?? 0.12) + (laneIndex === 2 ? 0.012 : 0)));
      positions.push(worldPosition.x, worldPosition.y, worldPosition.z);
      const laneColor = laneColors[laneIndex];
      colors.push(laneColor.r * texturePulse, laneColor.g * texturePulse, laneColor.b * texturePulse);
    });
    if (index < steps) {
      for (let lane = 0; lane < lanes.length - 1; lane++) {
        const current = index * lanes.length + lane;
        const nextRow = current + lanes.length;
        indices.push(current, nextRow, current + 1, nextRow, nextRow + 1, current + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${course.name} · compacted race surface`;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, routeNormals, steps };
}

function matrixAtSurface(dummy, position, normal, tangent, scale, scratch, lateral = 0, vertical = 0) {
  scratch.right.copy(tangent).cross(normal).normalize();
  scratch.back.copy(tangent).multiplyScalar(-1);
  scratch.matrix.makeBasis(scratch.right, normal, scratch.back);
  dummy.position.copy(position).addScaledVector(scratch.right, lateral).addScaledVector(normal, vertical);
  dummy.quaternion.setFromRotationMatrix(scratch.matrix);
  dummy.scale.copy(scale);
  dummy.updateMatrix();
  return dummy.matrix;
}

function arcDistance(a, b, radius) {
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * radius;
}

export function buildDrivingCourses({
  planetRadius,
  normalFromCoords,
  surfacePosition,
  makeLabelSprite,
  isTouchDevice = false,
} = {}) {
  if (!planetRadius || !normalFromCoords || !surfacePosition) {
    throw new Error('buildDrivingCourses requires planetRadius, normalFromCoords, and surfacePosition.');
  }

  const definitions = [
    {
      id: 'cratercoil',
      name: 'CRATER COIL',
      subtitle: 'TECHNICAL · TIGHT SLALOM',
      center: [-128, -2],
      radiusX: 36,
      radiusZ: 31,
      width: 2.45,
      waves: 5,
      waveAmount: 0.14,
      phase: 1.9,
      roadColor: 0x4f3029,
      centerColor: 0x815044,
      edgeColor: 0x72e6ff,
      accentColor: 0x54d8ff,
      checkpointCount: 14,
      boostIndices: [5, 11],
      rampIndices: [8],
      recommended: 'DUSTCRAWLER',
    },
  ];

  const root = new THREE.Group();
  root.name = 'Mars driving course network';
  const courses = [];
  const gateRecords = [];
  const boostRecords = [];
  const rampRecords = [];
  const markerRecords = [];
  const dummy = new THREE.Object3D();
  const tangent = new THREE.Vector3();
  const position = new THREE.Vector3();
  const matrixScratch = {
    right: new THREE.Vector3(),
    back: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
  };
  const instanceColor = new THREE.Color();
  const rampBaseColor = new THREE.Color(0x4b241c);

  definitions.forEach((definition) => {
    const centerNormal = normalFromCoords(definition.center[0], definition.center[1]);
    const course = {
      ...definition,
      centerNormal,
      basis: tangentBasis(centerNormal),
      direction: new THREE.Vector3(),
      checkpoints: [],
      boostZones: [],
      rampZones: [],
      bestTime: null,
    };
    const road = buildRoadGeometry(course, {
      radius: planetRadius,
      surfacePosition,
      isTouchDevice,
    });
    course.road = road.mesh;
    course.routeNormals = road.routeNormals;
    course.steps = road.steps;
    root.add(road.mesh);

    for (let checkpointIndex = 0; checkpointIndex < course.checkpointCount; checkpointIndex++) {
      const routeIndex = Math.round((checkpointIndex / course.checkpointCount) * course.steps) % course.steps;
      const normal = course.routeNormals[routeIndex].clone();
      const previous = course.routeNormals[(routeIndex - 1 + course.steps) % course.steps];
      const next = course.routeNormals[(routeIndex + 1) % course.steps];
      const routeTangent = next.clone().sub(previous);
      routeTangent.addScaledVector(normal, -routeTangent.dot(normal)).normalize();
      const checkpoint = { normal, tangent: routeTangent, index: checkpointIndex };
      course.checkpoints.push(checkpoint);
      gateRecords.push({ course, checkpoint, start: checkpointIndex === 0 });
    }

    course.boostIndices.forEach((checkpointIndex) => {
      const checkpoint = course.checkpoints[checkpointIndex % course.checkpointCount];
      const zone = { normal: checkpoint.normal.clone(), tangent: checkpoint.tangent.clone(), cooldown: 0 };
      course.boostZones.push(zone);
      boostRecords.push({ course, zone });
    });
    course.rampIndices.forEach((checkpointIndex) => {
      const checkpoint = course.checkpoints[checkpointIndex % course.checkpointCount];
      const zone = { normal: checkpoint.normal.clone(), tangent: checkpoint.tangent.clone(), cooldown: 0 };
      course.rampZones.push(zone);
      rampRecords.push({ course, zone });
    });

    for (let index = 0; index < course.steps; index += isTouchDevice ? 10 : 8) {
      const normal = course.routeNormals[index];
      const previous = course.routeNormals[(index - 1 + course.steps) % course.steps];
      const next = course.routeNormals[(index + 1) % course.steps];
      const routeTangent = next.clone().sub(previous);
      routeTangent.addScaledVector(normal, -routeTangent.dot(normal)).normalize();
      markerRecords.push({ course, normal: normal.clone(), tangent: routeTangent, side: -1 });
      markerRecords.push({ course, normal: normal.clone(), tangent: routeTangent, side: 1 });
    }

    if (makeLabelSprite) {
      const label = makeLabelSprite(`${course.name} · ${course.subtitle}`, `#${course.accentColor.toString(16).padStart(6, '0')}`);
      const start = course.checkpoints[0];
      label.position.copy(surfacePosition(start.normal, 5.15));
      label.scale.set(9.4, 1.45, 1);
      label.name = `${course.name} start label`;
      root.add(label);
      course.label = label;
    }
    courses.push(course);
  });

  const gateMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.48,
    emissive: 0x2a1308,
    emissiveIntensity: 0.55,
  });
  const gateGeometry = new THREE.BoxGeometry(1, 1, 1);
  const gateBatch = new THREE.InstancedMesh(gateGeometry, gateMaterial, gateRecords.length * 3);
  gateBatch.name = 'Batched course checkpoint arches';
  let gateInstance = 0;
  gateRecords.forEach(({ course, checkpoint, start }) => {
    position.copy(surfacePosition(checkpoint.normal, 0.08));
    const postHeight = start ? 4.2 : 3.35;
    const halfWidth = course.width + (start ? 0.62 : 0.28);
    [-1, 1].forEach((side) => {
      gateBatch.setMatrixAt(gateInstance, matrixAtSurface(
        dummy,
        position,
        checkpoint.normal,
        checkpoint.tangent,
        new THREE.Vector3(start ? 0.28 : 0.18, postHeight, start ? 0.28 : 0.18),
        matrixScratch,
        side * halfWidth,
        postHeight * 0.5
      ));
      gateBatch.setColorAt(gateInstance, instanceColor.set(start ? 0xffffff : course.accentColor));
      gateInstance++;
    });
    gateBatch.setMatrixAt(gateInstance, matrixAtSurface(
      dummy,
      position,
      checkpoint.normal,
      checkpoint.tangent,
      new THREE.Vector3(halfWidth * 2 + 0.28, start ? 0.3 : 0.2, start ? 0.3 : 0.2),
      matrixScratch,
      0,
      postHeight
    ));
    gateBatch.setColorAt(gateInstance, instanceColor.set(start ? 0xffffff : course.accentColor));
    gateInstance++;
  });
  gateBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  gateBatch.instanceMatrix.needsUpdate = true;
  if (gateBatch.instanceColor) gateBatch.instanceColor.needsUpdate = true;
  gateBatch.castShadow = false;
  gateBatch.receiveShadow = true;
  root.add(gateBatch);

  const beaconMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const beaconBatch = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.92, 28, 8, 1, true),
    beaconMaterial,
    courses.length
  );
  beaconBatch.name = 'Distant course discovery beacons';
  courses.forEach((course, index) => {
    const start = course.checkpoints[0];
    position.copy(surfacePosition(start.normal, 0.12));
    beaconBatch.setMatrixAt(index, matrixAtSurface(
      dummy,
      position,
      start.normal,
      start.tangent,
      new THREE.Vector3(1, 1, 1),
      matrixScratch,
      0,
      14
    ));
    beaconBatch.setColorAt(index, instanceColor.set(course.accentColor));
  });
  beaconBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  beaconBatch.instanceMatrix.needsUpdate = true;
  if (beaconBatch.instanceColor) beaconBatch.instanceColor.needsUpdate = true;
  root.add(beaconBatch);

  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const markerBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), markerMaterial, markerRecords.length);
  markerBatch.name = 'Batched illuminated course edge markers';
  markerRecords.forEach(({ course, normal, tangent: routeTangent, side }, index) => {
    position.copy(surfacePosition(normal, 0.12));
    markerBatch.setMatrixAt(index, matrixAtSurface(
      dummy,
      position,
      normal,
      routeTangent,
      new THREE.Vector3(0.16, 0.12, 0.62),
      matrixScratch,
      side * (course.width + 0.38),
      0.1
    ));
    markerBatch.setColorAt(index, instanceColor.set(course.accentColor));
  });
  markerBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  markerBatch.instanceMatrix.needsUpdate = true;
  if (markerBatch.instanceColor) markerBatch.instanceColor.needsUpdate = true;
  root.add(markerBatch);

  const boostMaterial = new THREE.MeshStandardMaterial({
    color: 0x7eefff,
    emissive: 0x2fd9ff,
    emissiveIntensity: 2.25,
    roughness: 0.24,
    metalness: 0.58,
    toneMapped: false,
  });
  const boostBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), boostMaterial, boostRecords.length);
  boostBatch.name = 'Batched electric boost pads';
  boostRecords.forEach(({ course, zone }, index) => {
    position.copy(surfacePosition(zone.normal, 0.2));
    boostBatch.setMatrixAt(index, matrixAtSurface(
      dummy,
      position,
      zone.normal,
      zone.tangent,
      new THREE.Vector3(course.width * 1.25, 0.08, 3.2),
      matrixScratch
    ));
    boostBatch.setColorAt(index, instanceColor.set(course.accentColor));
  });
  boostBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  boostBatch.instanceMatrix.needsUpdate = true;
  if (boostBatch.instanceColor) boostBatch.instanceColor.needsUpdate = true;
  root.add(boostBatch);

  const rampMaterial = new THREE.MeshStandardMaterial({
    color: 0x402624,
    emissive: 0x4a1f18,
    emissiveIntensity: 0.45,
    roughness: 0.72,
    metalness: 0.32,
  });
  const rampBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rampMaterial, rampRecords.length * 4);
  rampBatch.name = 'Batched progressive launch ramps';
  let rampInstance = 0;
  rampRecords.forEach(({ course, zone }) => {
    position.copy(surfacePosition(zone.normal, 0.15));
    for (let slat = 0; slat < 4; slat++) {
      const longitudinal = (slat - 1.5) * 0.9;
      position.copy(surfacePosition(zone.normal, 0.15)).addScaledVector(zone.tangent, longitudinal);
      rampBatch.setMatrixAt(rampInstance, matrixAtSurface(
        dummy,
        position,
        zone.normal,
        zone.tangent,
        new THREE.Vector3(course.width * 1.45, 0.14 + slat * 0.12, 0.82),
        matrixScratch,
        0,
        slat * 0.17
      ));
      rampBatch.setColorAt(rampInstance, instanceColor.set(course.accentColor).lerp(rampBaseColor, 0.48));
      rampInstance++;
    }
  });
  rampBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  rampBatch.instanceMatrix.needsUpdate = true;
  if (rampBatch.instanceColor) rampBatch.instanceColor.needsUpdate = true;
  rampBatch.receiveShadow = true;
  root.add(rampBatch);

  const state = {
    activeCourse: null,
    nextCheckpoint: 0,
    startTime: 0,
    lapTime: 0,
    prompt: '',
    gateFlash: 0,
  };
  const updateResult = {
    event: '',
    boost: 0,
    jumpImpulse: 0,
    prompt: '',
    activeCourse: null,
    lapTime: 0,
    nextCheckpoint: 0,
  };

  function writeUpdateResult(event = '', boost = 0, jumpImpulse = 0) {
    updateResult.event = event;
    updateResult.boost = boost;
    updateResult.jumpImpulse = jumpImpulse;
    updateResult.prompt = state.prompt;
    updateResult.activeCourse = state.activeCourse;
    updateResult.lapTime = state.lapTime;
    updateResult.nextCheckpoint = state.nextCheckpoint;
    return updateResult;
  }

  function reset() {
    state.activeCourse = null;
    state.nextCheckpoint = 0;
    state.startTime = 0;
    state.lapTime = 0;
    state.prompt = '';
  }

  function update({ normal, speed = 0, grounded = true, time = 0, dt = 0 } = {}) {
    for (let index = 0; index < boostRecords.length; index++) {
      const zone = boostRecords[index].zone;
      zone.cooldown = Math.max(0, zone.cooldown - dt);
    }
    for (let index = 0; index < rampRecords.length; index++) {
      const zone = rampRecords[index].zone;
      zone.cooldown = Math.max(0, zone.cooldown - dt);
    }
    boostMaterial.emissiveIntensity = 1.8 + Math.sin(time * 8.5) * 0.44 + state.gateFlash * 1.2;
    beaconMaterial.opacity = 0.32 + (Math.sin(time * 1.7) * 0.5 + 0.5) * 0.18;
    gateMaterial.emissiveIntensity = 0.4 + Math.sin(time * 2.6) * 0.12 + state.gateFlash * 1.45;
    state.gateFlash = Math.max(0, state.gateFlash - dt * 2.8);
    if (!normal) {
      state.prompt = '';
      return writeUpdateResult();
    }

    let event = '';
    let boost = 0;
    let jumpImpulse = 0;
    if (!state.activeCourse) {
      for (const course of courses) {
        const start = course.checkpoints[0];
        if (arcDistance(normal, start.normal, planetRadius) < 5.2 && Math.abs(speed) > 2.2) {
          state.activeCourse = course;
          state.nextCheckpoint = 1;
          state.startTime = time;
          state.lapTime = 0;
          state.gateFlash = 1;
          event = `${course.name} START · BUILT FOR ${course.recommended}`;
          break;
        }
      }
    }

    if (state.activeCourse) {
      const course = state.activeCourse;
      state.lapTime = Math.max(0, time - state.startTime);
      const expected = course.checkpoints[state.nextCheckpoint];
      if (expected && arcDistance(normal, expected.normal, planetRadius) < 4.35) {
        state.nextCheckpoint++;
        state.gateFlash = 1;
        if (state.nextCheckpoint >= course.checkpoints.length) {
          const finishedTime = state.lapTime;
          const isRecord = course.bestTime === null || finishedTime < course.bestTime;
          if (isRecord) course.bestTime = finishedTime;
          event = `${course.name} COMPLETE · ${finishedTime.toFixed(1)} SEC${isRecord ? ' · NEW RECORD' : ''}`;
          state.activeCourse = null;
          state.nextCheckpoint = 0;
          state.prompt = '';
        } else {
          event = `CHECKPOINT ${state.nextCheckpoint}/${course.checkpoints.length} · ${state.lapTime.toFixed(1)} SEC`;
        }
      }
    }

    for (const { course, zone } of boostRecords) {
      if (zone.cooldown > 0 || arcDistance(normal, zone.normal, planetRadius) >= 3.35) continue;
      zone.cooldown = 2.8;
      boost = Math.max(boost, 5.2);
      event = `${course.name} · ELECTRIC BOOST`; 
      state.gateFlash = 1;
    }
    if (grounded && Math.abs(speed) > 5) {
      for (const { course, zone } of rampRecords) {
        if (zone.cooldown > 0 || arcDistance(normal, zone.normal, planetRadius) >= 3.1) continue;
        zone.cooldown = 4.2;
        jumpImpulse = Math.max(jumpImpulse, 6.2);
        event = `${course.name} · LAUNCH RAMP`; 
        state.gateFlash = 1;
      }
    }

    if (state.activeCourse) {
      const course = state.activeCourse;
      state.prompt = `${course.name} · GATE ${state.nextCheckpoint}/${course.checkpoints.length} · ${state.lapTime.toFixed(1)} SEC`;
    } else {
      let nearestCourse = null;
      let nearestDistance = Infinity;
      for (const course of courses) {
        const distance = arcDistance(normal, course.checkpoints[0].normal, planetRadius);
        if (distance < 17 && distance < nearestDistance) {
          nearestCourse = course;
          nearestDistance = distance;
        }
      }
      state.prompt = nearestCourse
        ? `${nearestCourse.name} START · ${Math.ceil(nearestDistance)} M · ${nearestCourse.recommended}`
        : '';
    }

    return writeUpdateResult(event, boost, jumpImpulse);
  }

  function dispose() {
    courses.forEach((course) => {
      course.road.geometry.dispose();
      course.road.material.dispose();
    });
    gateBatch.geometry.dispose();
    beaconBatch.geometry.dispose();
    markerBatch.geometry.dispose();
    boostBatch.geometry.dispose();
    rampBatch.geometry.dispose();
    gateMaterial.dispose();
    beaconMaterial.dispose();
    markerMaterial.dispose();
    boostMaterial.dispose();
    rampMaterial.dispose();
  }

  return {
    root,
    courses,
    gateBatch,
    beaconBatch,
    markerBatch,
    boostBatch,
    rampBatch,
    state,
    update,
    reset,
    dispose,
  };
}

export default buildDrivingCourses;
