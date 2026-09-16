# Runtime fixes and merge verification scope

This revision reconciles PR #3 (`cab1630cd0a865959bd7574374dd01bcfa1b493c`) with `main` after PR #2 was merged (`bba5102e55db2ac5befdfaa8563cecfca2775c8c`). It changes web-runtime code, tests and documentation, not the native102 model release.

## Conflict resolution

- Keep the already-merged single capture-phase `window` mouth-input listener. It implements the same public contract as PR #3, including legacy document/connected-element senders, without duplicate delivery. Input validation and ownership rules are unchanged.
- Use PR #3's `runtime.ts` and `frame-timing.ts`: advance the complete parameter pipeline (actions, presence, expressions, secondary motion and native physics) in steps of at most 1/30 second. Present geometry and draw once per browser frame. This replaces PR #2's physics-only substeps; do not combine both loops.
- Ordinary 10/15/30/60/120 FPS frames retain their elapsed time. Long stalls accept at most 250ms (eight substeps). First frames after initialization, pause/resume, visibility changes and reset sample without advancing. Time above the long-stall cap is deliberately discarded.
- Use PR #3's `async-utils.ts` for timeout/abort cleanup, retaining PR #2's texture-allocation checks, early ownership registration, Blob URL revocation and image-source cleanup. Remove the superseded `frame-time.ts` and `decode-image.ts` instead of leaving two inactive implementations.
- Keep PR #3's real-runtime contract tests. Migrate PR #2's texture-loop and cleanup regressions into `scripts/test-runtime-resources.mjs`, targeting the active helper and extracting the actual texture loop from `runtime.ts`.
- Keep both complementary Chromium event suites: PR #3 tests redispatch of the same Event; PR #2 also tests unrelated events, an unavailable engine and replacement of that engine. Preserve the existing `test:mouth-event` command.
- Consolidate CI into the existing `.github/workflows/sdk-free-regression.yml`, retaining its `regression` job and applying PR #3's pinned action revisions and non-persisted checkout credentials. There is no second duplicate `ci.yml` workflow. Permissions remain read-only; no SDK download or deployment is configured.
- Preserve the old dated documentation as a historical entry point with a link to its original full Git revision. It is not the current timing specification.

## Reproduce

From `web/`, with the repository's supported Node.js version:

```sh
npm ci --ignore-scripts
npm run verify
npm test
npx playwright install chromium
npm run test:events
```

`npm test` runs the real action-controller tests, `test:runtime`, and `test:resources`. `test:events` runs both browser-event suites. Individual `test:controller`, `test:runtime`, `test:resources`, and `test:mouth-event` commands remain available. Set `BROWSER_CHANNEL=msedge` or `BROWSER_EXECUTABLE_PATH` to use a local browser; otherwise install Chromium matching the locked Playwright version.

## What these checks establish

- `test:runtime`: strict types for the SDK-independent helpers and actual `HikariStage` execution with explicit SDK/controller doubles; checks timing, lifecycle, mouth validation, TTL and handoff logic.
- `test:resources`: deterministic timeout and real AbortSignal cleanup checks, plus the actual texture loop with GL doubles. Covers success, allocation/upload/decode failure, timeout, cancellation, destroyed-stage cleanup and consumed late rejections.
- Browser suites: real Chromium event propagation using the actual main.ts registration and README example; the engine is a recording double, not a rendered model.
- `verify`: unchanged asset identities, hashes and runtime references. Dependencies continue to use the existing lockfile.

The merge-resolution revision must pass its own GitHub Actions run. Earlier PR #2/#3 local counts and release PASS records are historical evidence, not a claim that this integrated revision was revalidated. Use the workflow logs attached to the exact merge-resolution commit for results and tool versions.

## Not covered or changed

No complete Cubism SDK build, actual model rendering, native-physics visual comparison, VTube Studio check, mobile memory measurement or texture-network benchmark is established by the SDK-free tests. Native MOC3/CMO3/PNG files, parameter definitions, asset manifests, gaze compensation, shoulder/arm safety limits and licenses are unchanged. Paused rendering is not changed to on-demand rendering, and large textures are not downsampled. No production deployment is performed by this workflow.
