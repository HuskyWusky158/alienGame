# Performance guardrails

The guardrails have two layers:

1. A production bundle-size check that runs locally or in CI today.
2. Repeatable browser benchmarks using the game's existing `?perf` snapshot.

## Production bundle check

Run the complete check with:

```sh
npm run perf:check
```

`perf:check` creates a fresh Vite production build and then checks raw and gzip sizes. If `dist` is already current, run only:

```sh
npm run perf:budget
```

The enforced limits and longer-term targets live in [`scripts/performance-budgets.json`](../scripts/performance-budgets.json). Limits are regression ceilings and fail the command. Targets describe the desired end state and are informational until the corresponding optimization work is complete.

The initial JavaScript measurement includes module scripts referenced by `index.html` and their static import graph. Dynamic imports are excluded from the initial measurement and included in total JavaScript. This means code splitting can improve the initial budget without hiding growth in the complete download.

Current policy:

| Metric | Enforced limit | Optimization target |
| --- | ---: | ---: |
| Largest JavaScript file, raw | 950,000 B | — |
| Largest JavaScript file, gzip | 275,000 B | — |
| Initial JavaScript, gzip | 275,000 B | 200,000 B |
| All JavaScript, gzip | 350,000 B | — |
| All CSS, gzip | 10,000 B | — |
| Complete build, gzip | 375,000 B | — |

The ceilings are intentionally just above the current baseline. Tighten them after a successful optimization; do not raise them automatically when a check fails.

To test an experimental budget file:

```sh
node scripts/check-performance-budgets.mjs --config path/to/budgets.json
```

## Runtime measurement contract

Open a production preview with `npm run preview`, then add `?perf` to a route. The app updates this object about twice per second:

```js
window.__ALIEN_GAME_PERF__
// {
//   fps,
//   calls,
//   triangles,
//   geometries,
//   textures,
//   pixelRatio,
//   qualityMode: 'auto' | 'high' | 'medium' | 'low',
//   qualityTier: 'high' | 'medium' | 'low',
//   residency: { mars, moon, zephyra },
//   xenobiologyCullActive,
//   xenobiologyCullVisible,
//   xenobiologyTransmission
// }
```

The same values appear in the lower-right overlay. A future browser runner should read this object instead of parsing overlay text.

For deterministic comparisons, append `&quality=high`, `&quality=medium`, or
`&quality=low`. `&quality=auto` exercises the adaptive controller, which tops
out at Medium to protect frame pacing on high-DPI displays. High remains an
explicit benchmark/player choice. The query override wins over a saved
preference without replacing it. During normal play, press `Q` to cycle Auto →
High → Medium → Low; that selection is persisted.

For deterministic responsive testing, use `&device=mobile` with a 390×844
viewport or `&device=desktop` with a 1280×720 viewport. Mobile Auto starts and
stays at Low unless the player explicitly chooses a higher mode, and mobile and
desktop preferences use separate storage keys.

Use a fixed 1280×720 viewport. Wait for the loading screen to finish, allow 10 seconds for shader compilation and adaptive resolution to settle, and then take 20 snapshots at 500 ms intervals. Record median FPS, 95th-percentile frame time when browser tracing is available, maximum draw calls/triangles, and the final geometry/texture counts. Run each scene three times and keep the median run.

Do not compare FPS across different computers. FPS budgets apply to the target machine; draw-call, triangle, and residency regressions are generally comparable across machines.

## Benchmark scenes

All query strings below include the performance overlay and the app's focused QA position when one exists.

| Scene | Query string | Draw-call target | FPS target |
| --- | --- | ---: | ---: |
| Mars spawn | `?perf&quality=high` | ≤250 | 60 |
| Garage | `?perf&garage-roof-qa&quality=high` | ≤300 | 60 |
| UFO approach | `?perf&ufo-shop-qa&quality=high` | ≤300 | 60 |
| UFO archive | `?perf&ufo-archive-qa&quality=high` | ≤350 | 60 |
| Xenobiology exterior | `?perf&xenobiology-qa&quality=high` | ≤300 | 60 |
| Xenobiology interior | `?perf&xenobiology-interior-qa&quality=high` | ≤350 | ≥30, target 60 |
| Aquarium | `?perf&aquarium-qa&quality=high` | ≤350 | ≥30, target 60 |
| Oasis | `?perf&oasis-lake-qa&quality=high` | ≤300 | 60 |
| Cave and train | `?perf&mine-train-qa&qa-ride&quality=high` | ≤350 | ≥30, target 60 |
| Moon ray crater | `?perf&moon-rocks-qa&quality=high` | ≤300 | 60 |

Zephyra does not currently have a direct QA query. Add a stable `zephyra-qa` entry point before making it an automated scene budget. Until then, travel there normally and capture a manual baseline using `?perf`.

`?perf&no-stream` intentionally keeps every world's detailed objects visible. Use it as a diagnostic upper bound for streaming work, not as a pass/fail gameplay scene. Append a fixed quality mode when comparing it with streamed measurements.

Append `&draw-profile` to aggregate the five busiest scene branches in the
overlay. This diagnostic mode adds render hooks, so use it to locate a hotspot,
not for the final FPS measurement.

Current 1280×720 Medium baselines on the development machine after the
Xenobiology pass are roughly 125–160 calls across the museum and Aquarium
views, both at 60 FPS. The Aquarium previously fell to a sustained 1 FPS
because the nearby Oasis updater re-enabled hundreds of off-screen objects and
its transmissive water forced an extra opaque-scene pass.

Current 390×844 Mobile Auto baselines are about 117 calls at Mars spawn and
77–81 calls in the Aquarium, both at 60 FPS on the development machine.

## Runtime acceptance checks

- Only the active world and its intended neighbors are resident.
- Inactive regions perform no animation or interaction updates.
- Revisiting worlds does not cause geometry or texture counts to grow on every trip.
- Entering a newly loaded region causes no visible multi-frame freeze.
- Desktop should sustain 60 FPS on the target machine; dense scenes must never remain below 30 FPS.
- Adaptive resolution must not be the only reason a CPU-bound scene passes. Record draw calls alongside FPS.

When a refactor changes visuals intentionally, update the baseline notes but keep the target budgets unless the intended feature genuinely requires a reviewed budget change.
