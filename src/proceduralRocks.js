import * as THREE_NS from 'three';

const textureCacheByThree = new WeakMap();

function seededRandomFactory(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let value = Math.imul(x | 0, 374761393)
    ^ Math.imul(y | 0, 668265263)
    ^ Math.imul(z | 0, 2147483647)
    ^ Math.imul(seed | 0, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise3(x, y, z, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const sample = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed) * 2 - 1;
  const x00 = sample(0, 0, 0) * (1 - fx) + sample(1, 0, 0) * fx;
  const x10 = sample(0, 1, 0) * (1 - fx) + sample(1, 1, 0) * fx;
  const x01 = sample(0, 0, 1) * (1 - fx) + sample(1, 0, 1) * fx;
  const x11 = sample(0, 1, 1) * (1 - fx) + sample(1, 1, 1) * fx;
  const y0 = x00 * (1 - fy) + x10 * fy;
  const y1 = x01 * (1 - fy) + x11 * fy;
  return y0 * (1 - fz) + y1 * fz;
}

function fbm3(x, y, z, seed, octaves = 4) {
  let value = 0;
  let amplitude = 0.56;
  let frequency = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    frequency *= 2.03;
    amplitude *= 0.48;
  }
  return value / normalization;
}

function valueNoise2(x, y, seed) {
  return valueNoise3(x, y, seed * 0.013, seed);
}

function fbm2(x, y, seed, octaves = 5) {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2(x * frequency, y * frequency, seed + octave * 977) * amplitude;
    normalization += amplitude;
    frequency *= 2.07;
    amplitude *= 0.5;
  }
  return value / normalization;
}

const ARCHETYPES = {
  basalt: {
    frequency: 1.8,
    ruggedness: 0.2,
    fineDetail: 0.055,
    fractures: 4,
    fractureMin: 0.68,
    fractureMax: 0.92,
    vertical: 0.86,
    base: -0.61,
  },
  sedimentary: {
    frequency: 1.35,
    ruggedness: 0.12,
    fineDetail: 0.035,
    fractures: 4,
    fractureMin: 0.72,
    fractureMax: 0.94,
    vertical: 0.58,
    base: -0.48,
    strata: 7,
    strataStrength: 0.075,
  },
  ventifact: {
    frequency: 1.55,
    ruggedness: 0.105,
    fineDetail: 0.038,
    fractures: 3,
    fractureMin: 0.74,
    fractureMax: 0.95,
    vertical: 0.6,
    base: -0.5,
    wind: 0.15,
  },
  breccia: {
    frequency: 2.35,
    ruggedness: 0.22,
    fineDetail: 0.075,
    fractures: 6,
    fractureMin: 0.62,
    fractureMax: 0.88,
    vertical: 0.82,
    base: -0.59,
  },
  dusted: {
    frequency: 1.2,
    ruggedness: 0.11,
    fineDetail: 0.028,
    fractures: 3,
    fractureMin: 0.76,
    fractureMax: 0.94,
    vertical: 0.7,
    base: -0.54,
    dustMantle: 0.08,
  },
  cavern: {
    frequency: 1.65,
    ruggedness: 0.23,
    fineDetail: 0.05,
    fractures: 6,
    fractureMin: 0.62,
    fractureMax: 0.9,
    vertical: 0.82,
    base: -0.6,
    cavernPitting: 0.12,
  },
  lunar: {
    frequency: 2.05,
    ruggedness: 0.2,
    fineDetail: 0.06,
    fractures: 6,
    fractureMin: 0.6,
    fractureMax: 0.88,
    vertical: 0.84,
    base: -0.58,
  },
};

// PolyhedronGeometry is non-indexed, so Three's default normal calculation
// leaves one normal per triangle even at high subdivision levels. Average the
// normals of coincident vertices while preserving UV seam duplicates. This
// removes the toy-like triangular facets without changing texture mapping.
function smoothCoincidentVertexNormals(THREE, geometry, precision = 10000) {
  geometry.computeVertexNormals();
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const groups = new Map();
  for (let index = 0; index < positions.count; index++) {
    const key = `${Math.round(positions.getX(index) * precision)},${Math.round(positions.getY(index) * precision)},${Math.round(positions.getZ(index) * precision)}`;
    let group = groups.get(key);
    if (!group) {
      group = { x: 0, y: 0, z: 0, indices: [] };
      groups.set(key, group);
    }
    group.x += normals.getX(index);
    group.y += normals.getY(index);
    group.z += normals.getZ(index);
    group.indices.push(index);
  }
  const normal = new THREE.Vector3();
  groups.forEach((group) => {
    normal.set(group.x, group.y, group.z).normalize();
    group.indices.forEach((index) => normals.setXYZ(index, normal.x, normal.y, normal.z));
  });
  normals.needsUpdate = true;
}

function randomUnitVector(THREE, random) {
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

/**
 * Builds a rounded but geologically fractured rock silhouette. Broad fracture
 * planes shape the outline; multi-octave noise adds erosion at two scales.
 * Geometry remains indexed with smooth normals, avoiding the low-poly facets
 * that made the previous detail-0 polyhedra read as toy blocks.
 */
export function createProceduralRockGeometry({
  THREE = THREE_NS,
  seed = 1,
  detail = 2,
  archetype = 'basalt',
  ruggedness = 1,
} = {}) {
  const profile = ARCHETYPES[archetype] || ARCHETYPES.basalt;
  const geometry = new THREE.IcosahedronGeometry(1, Math.max(1, detail));
  geometry.name = `Procedural ${archetype} rock · seed ${seed}`;
  const positions = geometry.attributes.position;
  const random = seededRandomFactory(seed ^ 0x9e3779b9);
  const xScale = 0.9 + random() * 0.19;
  const zScale = 0.9 + random() * 0.19;
  const leanX = (random() - 0.5) * 0.16;
  const leanZ = (random() - 0.5) * 0.16;
  const fractures = Array.from({ length: profile.fractures }, () => ({
    normal: randomUnitVector(THREE, random),
    distance: profile.fractureMin + random() * (profile.fractureMax - profile.fractureMin),
  }));
  const direction = new THREE.Vector3();

  for (let index = 0; index < positions.count; index++) {
    direction.set(positions.getX(index), positions.getY(index), positions.getZ(index)).normalize();
    const coarse = fbm3(
      direction.x * profile.frequency + seed * 0.00071,
      direction.y * profile.frequency - seed * 0.00043,
      direction.z * profile.frequency + seed * 0.00029,
      seed,
      4
    );
    const fine = fbm3(
      direction.x * 7.2 - seed * 0.00019,
      direction.y * 7.2 + seed * 0.00031,
      direction.z * 7.2 - seed * 0.00053,
      seed ^ 0x51ed270b,
      3
    );
    let radius = 1
      + coarse * profile.ruggedness * ruggedness
      + fine * profile.fineDetail * ruggedness;

    if (profile.strata) {
      const layerCoordinate = (direction.y * 0.5 + 0.5) * profile.strata;
      const layerEdge = Math.abs((layerCoordinate - Math.floor(layerCoordinate)) - 0.5) * 2;
      const ledge = Math.pow(1 - layerEdge, 5);
      radius += ledge * profile.strataStrength;
    }
    if (profile.wind) {
      const windFace = Math.max(0, direction.z * 0.72 + direction.x * 0.28);
      const leeFace = Math.max(0, -direction.z);
      radius += windFace * profile.wind - leeFace * profile.wind * 0.34;
    }
    if (profile.cavernPitting) {
      radius -= Math.max(0, fine) * profile.cavernPitting;
    }
    if (profile.dustMantle) {
      radius += Math.max(0, direction.y) * profile.dustMantle * (0.65 + coarse * 0.35);
    }

    fractures.forEach((fracture) => {
      const facing = direction.dot(fracture.normal);
      if (facing > 0.2) radius = Math.min(radius, fracture.distance / facing);
    });

    const verticalPosition = Math.max(direction.y * radius * profile.vertical, profile.base ?? -0.62);
    positions.setXYZ(
      index,
      direction.x * radius * xScale + verticalPosition * leanX,
      verticalPosition,
      direction.z * radius * zScale + verticalPosition * leanZ
    );
  }

  positions.needsUpdate = true;
  smoothCoincidentVertexNormals(THREE, geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createDetailTextures(THREE, seed, size = 96) {
  let cache = textureCacheByThree.get(THREE);
  if (!cache) {
    cache = new Map();
    textureCacheByThree.set(THREE, cache);
  }
  const key = `${seed}:${size}`;
  if (cache.has(key)) return cache.get(key);

  const albedoData = new Uint8Array(size * size * 4);
  const reliefData = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const broad = fbm2(x / size * 5.2, y / size * 5.2, seed, 5);
      const grain = fbm2(x / size * 21.5, y / size * 21.5, seed ^ 0x6ac690c5, 3);
      const dustSpeck = hash3(x, y, seed & 255, seed) > 0.965 ? 0.055 : 0;
      const shade = Math.max(0.82, Math.min(1, 0.94 + broad * 0.045 + grain * 0.02 + dustSpeck));
      const relief = Math.max(0, Math.min(1, 0.5 + broad * 0.3 + grain * 0.2));
      const offset = (y * size + x) * 4;
      albedoData[offset] = Math.round(255 * Math.min(1, shade * 1.02));
      albedoData[offset + 1] = Math.round(255 * shade);
      albedoData[offset + 2] = Math.round(255 * Math.max(0.68, shade * 0.96));
      albedoData[offset + 3] = 255;
      const reliefByte = Math.round(relief * 255);
      reliefData[offset] = reliefByte;
      reliefData[offset + 1] = reliefByte;
      reliefData[offset + 2] = reliefByte;
      reliefData[offset + 3] = 255;
    }
  }
  const albedo = new THREE.DataTexture(albedoData, size, size, THREE.RGBAFormat);
  albedo.name = `Procedural rock grain albedo ${seed}`;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(2.6, 2.1);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.needsUpdate = true;
  const relief = new THREE.DataTexture(reliefData, size, size, THREE.RGBAFormat);
  relief.name = `Procedural rock grain relief ${seed}`;
  relief.wrapS = relief.wrapT = THREE.RepeatWrapping;
  relief.repeat.set(3.1, 2.7);
  relief.needsUpdate = true;
  const textures = { albedo, relief };
  cache.set(key, textures);
  return textures;
}

/** Creates a non-metallic, dust-responsive PBR rock material. */
export function createProceduralRockMaterial({
  THREE = THREE_NS,
  color = 0x7c4937,
  seed = 1,
  roughness = 0.94,
  bumpScale = 0.075,
  textureSize = 96,
  dustColor = null,
  dustStrength = 0,
} = {}) {
  const textures = createDetailTextures(THREE, seed, textureSize);
  const material = new THREE.MeshStandardMaterial({
    color,
    map: textures.albedo,
    bumpMap: textures.relief,
    bumpScale,
    roughness,
    roughnessMap: textures.relief,
    metalness: 0.015,
    flatShading: false,
    dithering: true,
  });
  if (dustColor != null && dustStrength > 0) {
    const dustTint = new THREE.Color(dustColor);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRockDustColor = { value: dustTint };
      shader.uniforms.uRockDustStrength = { value: dustStrength };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying float vRockDustUp;\nvoid main() {')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vRockDustUp = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uRockDustColor;\nuniform float uRockDustStrength;\nvarying float vRockDustUp;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          '#include <opaque_fragment>\n  float rockDustMask = smoothstep(0.48, 0.92, vRockDustUp) * uRockDustStrength;\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uRockDustColor, rockDustMask);'
        );
    };
    material.customProgramCacheKey = () => `rock-dust:${dustTint.getHexString()}:${dustStrength.toFixed(3)}`;
    material.userData.dustColor = dustTint;
    material.userData.dustStrength = dustStrength;
  }
  material.name = `Procedural granular rock material ${seed}`;
  return material;
}

export const PROCEDURAL_ROCK_ARCHETYPES = Object.freeze(Object.keys(ARCHETYPES));
