# Performance and single-user scaling plan

## Scope

This plan is intentionally about making one player's game fast, stable, and
easy to expand. It excludes traffic scaling, multi-user infrastructure, load
balancers, distributed services, and server capacity. The game is a static
Vite/Three.js client, so the relevant forms of scaling are:

- more worlds, landmarks, creatures, vehicles, and effects without a larger
  startup penalty;
- dense scenes without unbounded draw calls or main-thread animation work;
- long play sessions and repeated travel without GPU-memory growth;
- a predictable frame rate across different personal devices.

## Findings

The original bottleneck was not network traffic. The main costs were all in the
browser:

1. Most world and landmark objects were created at startup and remained in the
   scene graph even when far away.
2. Xenobiology used hundreds of small meshes and repeated geometry/material
   objects. It was the worst draw-call and shader hotspot.
3. Several animation loops continued updating invisible landmarks.
4. Procedural textures and geometry generation competed with startup and frame
   work on the main thread.
5. A single large entry module made it difficult to lazy-load optional content.
6. Quality control was mostly an implicit pixel-ratio adjustment, without a
   stable user-facing mode or shared settings contract.
7. There were no automated bundle ceilings or repeatable scene benchmarks, so
   regressions could land unnoticed.
8. First keyboard input synchronously synthesized more than a million audio
   samples, and hidden thruster PointLights changed the global shader light
   count when they first appeared.

## Work completed in this pass

### Measurement and regression protection

- Added `npm run perf:check` and `npm run perf:budget`.
- Added enforced raw/gzip production bundle ceilings and an informational
  200 KB initial-JavaScript gzip target.
- Extended `window.__ALIEN_GAME_PERF__` with quality mode/tier and documented a
  repeatable 1280×720 scene-measurement contract.
- Added unit tests for quality adaptation and resource-cache lifecycle.

### Runtime residency and update scheduling

- Kept world-level streaming and added hysteresis-based Mars landmark
  residency for the UFO outpost, Crystal Outcrop, Xenobiology, crash site, and
  mountain home.
- Stopped landmark animation/particle updates when their landmark is not
  resident.
- Added a second Xenobiology interior-detail residency boundary so the exterior
  shell can remain visible without paying for every creature, aquarium, light,
  and mote.
- Paused the frame body when the document is hidden and throttled ambient world
  simulation according to the selected quality tier.
- Reduced world/hub streaming checks to 8 Hz and precomputed their hub/runtime
  lookup entries instead of rebuilding arrays and scanning hub lists every
  animation frame.

### Draw calls and per-frame allocation

- Reused Xenobiology geometries/materials and instanced repeated aquarium frame,
  kelp, monkey-tail, and squid-tentacle parts.
- Removed repeated vector/matrix/color allocations in driving-course and mine
  train paths.
- Reused vehicle update results and scratch objects; stationary Dustcrawler
  treads no longer rewrite all instance matrices every frame.
- Added explicit disposal hooks to the course, train, and vehicle modules.

### First-use stalls, startup, and quality controls

- Builds the mountain home while the loading overlay is active. This keeps its
  500-line procedural builder and new light/material variants out of an active
  exploration frame.
- Keeps procedural Earth texture generation behind the loading screen so its
  main-thread work cannot stall an active gameplay frame.
- Splits procedural soundtrack/noise synthesis into small yielding tasks,
  halves the repeated music loop, and does not wait on a browser-controlled
  `AudioContext.resume()` promise before declaring the graph ready.
- Removed first-use PointLights from the player and rover thruster groups. The
  additive/emissive flames remain, but activating thrust no longer changes the
  scene-wide shader light count.
- Keeps local PointLights and SpotLights disabled for Auto/Medium/Low, using
  emissive art and stable global lights instead. Explicit High retains the local
  lighting treatment.
- Added Auto, High, Medium, and Low quality modes. Auto now tops out at Medium
  to avoid repeated Retina-resolution frame drops; High remains an explicit
  choice. Press `Q` to cycle the modes.
  Explicit `?quality=` query values override saved preferences for benchmarks.
- Added a reusable resource cache with reference-counted leases and disposal.
- Batched Xenobiology creatures into vertex-coloured proxies for Auto, Medium,
  and Low, while retaining the articulated versions for explicit High mode.
- Simplified Xenobiology glass outside High mode by disabling the full-scene
  transmission prepass and rendering double-sided transparent surfaces once.
- Added an interior visibility boundary that hides distant Mars detail and
  prevents the nearby Oasis updater from re-enabling off-screen scenery.
- Batched the player's rigid face, neck, and jetpack details without flattening
  the animated arms, legs, torso, or head silhouette.
- Disabled the full-scene transmission prepass for all non-High glass, not just
  Xenobiology, cutting the default desktop scene from roughly 398 calls to
  about 196–208 calls.
- Added deterministic desktop/mobile device overrides, separate persisted
  preferences, and a Mobile Auto ceiling at Low quality.
- Uses longer quality sample windows and two consecutive slow samples before a
  downshift. Isolated frames over 200 ms reset adaptation rather than causing a
  renderer resize, and benchmark query overrides no longer overwrite normal
  saved preferences.
- Reused camera vectors instead of allocating two or more vectors every frame,
  and skips Lumi's hidden visual posing while the Moon region is not resident.

## Current measured state

Measurements below are from the same local 1280×720 browser session and are
useful for comparing this pass, not as universal hardware claims.

| Scene | Before | After this pass |
| --- | --- | --- |
| Mars spawn, Auto/Medium | ~486 calls, ~35 FPS | ~208 calls, ~266k triangles, 60 FPS |
| Mars spawn, Mobile Auto/Low | no fixed mobile baseline | ~186 calls, ~100k triangles, 60 FPS |
| First movement | visible freeze while audio synthesized | 20.1 ms worst sampled frame, no long frame |
| First jetpack thrust | visible shader freeze | 17.8 ms desktop / 17.7 ms mobile worst sampled frame |
| Xenobiology interior | ~1,606 calls, ~1 FPS | ~588–632 warmed calls; 36–60 FPS on High, 60 FPS on Medium |
| Aquarium focus | part of the prior Xenobiology hotspot | ~943 calls, 48 FPS on High |
| Mountain home approach | deferred procedural build during exploration | built under loading overlay; no approach-time module/builder stall |

The production build remains below the enforced 275 KB initial-JavaScript gzip
ceiling. The Vite warning about a large entry chunk is still valid. The next
startup win is splitting complete regions with a staged preload contract, not
running large region builders on the first active frame or merely raising the
warning threshold.

## Remaining roadmap

### Phase 1 — finish dense-scene batching

Priority: highest. Goal: make High stable at 60 FPS where practical and keep
every gameplay scene above 30 FPS.

- Convert static Xenobiology case bases, substrates, rings, canopies, glass
  edges, and props into a small set of instanced batches.
- Batch fish bodies/fins/eyes by material family, while keeping only the minimum
  transform nodes required for swimming animation.
- Instance or merge non-deforming creature parts by material; retain separate
  nodes only for wings, ears, tails, and other animated parts.
- Provide cheaper Medium/Low aquarium materials without transmission and
  double-sided physical shading.
- Target ≤350 calls for the interior and aquarium benchmarks. Until then, Auto
  or Medium is the recommended mode for those scenes.

### Phase 2 — true region lifecycle

Priority: high. Goal: adding content to one region should not increase startup
construction time or permanent GPU memory elsewhere.

- Give every region a `load`, `activate`, `deactivate`, and `dispose` contract.
- Dynamically import the Nightfall cave/train, mountain home, Moon landmarks,
  Zephyra, and other optional landmarks as region modules, but stage their CPU
  build and GPU upload work behind a travel/loading boundary before activation.
- Use the resource cache for shared geometry, material, and texture ownership.
- Retain recently visited regions in a small LRU cache to avoid travel hitches;
  dispose the least-recently-used region when its memory budget is exceeded.
- Add a travel soak test that repeatedly visits every world and verifies that
  geometry/texture counts plateau.

### Phase 3 — move generation away from interactive frames

Priority: high for startup and travel smoothness.

- Pre-bake deterministic terrain textures and high-cost static meshes during the
  build where authoring flexibility permits.
- Move remaining procedural array generation to Web Workers. Transfer typed
  arrays back to the main thread and create Three.js GPU objects there.
- Divide unavoidable main-thread work into bounded tasks with a visible travel
  preload state; never build a whole world during one animation frame.
- Cache deterministic generated results in IndexedDB, keyed by content/schema
  version, for faster later launches on the same device.

### Phase 4 — modular game loop and spatial work

Priority: medium. Goal: cost should follow nearby active content rather than the
total size of the game.

- Split `main.js` into world modules, landmark systems, travel state, renderer,
  input, audio, and diagnostics.
- Register update functions with active/ambient/distant rates from the quality
  manager instead of maintaining one monolithic per-frame block.
- Replace linear scans for obstacles, interactions, and discoveries with a
  simple per-world spatial grid once those lists become large enough to show up
  in profiles.
- Reuse scratch vectors and result objects at all hot call sites; prohibit new
  object creation inside high-frequency loops unless measured harmless.

### Phase 5 — automated runtime gates

Priority: medium, but required before large content growth.

- Add a browser benchmark runner that launches each documented QA query three
  times and records median FPS, p95 frame time, maximum draw calls/triangles,
  and final GPU resource counts.
- Gate pull requests on bundle ceilings, no console errors, and draw-call
  budgets. Keep FPS as a target-machine gate because it is hardware-dependent.
- Capture a cold-start benchmark separately from warmed scene performance so
  shader compilation and generation hitches remain visible.

## Acceptance criteria

The performance work is complete when:

- Mars spawn sustains 60 FPS at High on the target device and is brought below
  250 calls throughout the complete spawn/shuttle cycle.
- Dense scenes never remain below 30 FPS, and Auto reaches a stable tier without
  rapid oscillation.
- Xenobiology interior and aquarium reach ≤350 draw calls.
- The initial JavaScript bundle reaches the 200 KB gzip target.
- No inactive region performs animation, particle, collision, or interaction
  work.
- Visiting all worlds repeatedly causes geometry and texture counts to plateau.
- New optional regions can be added without increasing the initial module or
  startup construction cost.
