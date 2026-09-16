# Runtime fixes and verification scope

Baseline: `7b5fbce24e4fced3c80957308741eff55312ccd1` (native102). These are web-runtime and test changes, not a new model release.

## Changes

- Receive `hikari:mouth-input` at `window` in capture mode. This keeps the published `window.dispatchEvent` example working while accepting existing `document` and connected-element senders, with or without bubbling, once per dispatch. Input validation and mouth ownership are unchanged.
- Split a browser frame into simulation steps of at most 1/30 second instead of discarding elapsed time above 1/30. The complete parameter pipeline, including actions, expressions and physics, advances on the same substeps. Geometry presentation and drawing still happen once per browser frame.
- Cap catch-up at 250 ms (at most eight steps) after a long stall. Ordinary 10/15/30/60/120 FPS operation preserves elapsed time; arbitrarily long stalls deliberately do not. First frames after initialization, pause/resume, visibility changes and reset sample without advancing. Timestamp zero is valid.
- Release image-decode timeout timers and abort listeners on success, failure, timeout and cancellation. The texture loader retains responsibility for clearing the image URL. Register texture ownership before upload and reject failed texture allocation explicitly.
- Add SDK-free runtime and browser-event tests, plus a read-only GitHub Actions workflow with pinned action revisions. No SDK download, model conversion, deployment or secrets are required by this workflow.

## Reproduce

From `web/`, using the repository's supported Node.js version:

```sh
npm ci
npm run verify
npm test
npx playwright install chromium
npm run test:events
```

`npm test` runs the existing real action-controller tests followed by `test:runtime`. Browser selection can use `BROWSER_CHANNEL=msedge` or an explicit `BROWSER_EXECUTABLE_PATH`; otherwise Playwright uses its installed Chromium. CI installs the browser matching the locked Playwright version.

## What the new tests establish

`test:runtime` strictly type-checks the new SDK-independent helpers, then executes the actual `HikariStage` runtime with explicitly mocked SDK and controller dependencies. Its 14 grouped cases cover frame/substep wiring at five frame rates, bounded stalls, pause/resume/visibility/reset, invalid timestamps, inactive stages, actual mouth-input validation and TTL/chew handoff code, and asynchronous cleanup. It is not a complete application build. The existing `test:controller` independently exercises the real action controller.

`test:events` extracts the actual public listener from `main.ts` and executes it in Chromium with a recording engine. Its nine cases cover window/document/element targets, bubbling and non-bubbling events, clearing, reusing an Event object, and executing the actual README example. Delivery to the recording engine is not proof of a rendered mouth shape.

Local implementation checks passed all 14 runtime and nine browser-event cases using Node.js 22.16.0, TypeScript 5.8.3, Playwright 1.57.0 and system Chromium 144.0.7559.96. These locally available tool versions differ from the repository lock. Negative controls also failed as expected: restoring a 1/30 frame-time cap broke elapsed-time preservation, and restoring the original document-only listener broke the window event case. CI uses `npm ci` and the repository lock for the authoritative dependency-version run.

## Not validated or changed here

- A full Cubism SDK 5-r.5 build, rendered native model, visual appearance, texture/network performance, mobile memory use and VTube Studio behavior were not revalidated by these local tests.
- Model binaries, editable projects, textures, asset manifests, gaze compensation, arm safety limits and licenses are unchanged.
- No claim is made that the previous release's browser/model PASS records were rerun. Those records remain historical release evidence.
- Paused rendering is not converted to on-demand rendering. Texture downsampling and native rig changes still require separate visual acceptance.
