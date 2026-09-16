# Release notes

## v2.0.0 · native102 and public actions

v2.0.0 updates the public package from the earlier HairFlow viewer to the native102 model and a web runtime with public action and mouth-input ownership.

### Included

- Editable Cubism source at `model/source/Cubism/SuJiangXue_HairFlow_WIP_t102.cmo3`.
- A 25-file runtime package under `model/runtime/`, with 8 textures, 66 parameters, 226 drawables and 59 parts.
- Three outfits: formal, school and swimsuit. The current artwork remains an upper-thigh composition.
- Twelve expressions and one retained demo motion.
- Public curiosity, shy and smug action buttons.
- Closed-mouth left/right chew behavior with cancellation, re-entry, pause, reset and action-to-mouth handoff.
- `hikari:mouth-input` for bounded external mouth input with `open`, optional `form` and `pucker`, and a wall-clock TTL.
- Production action controls without a DEV QA surface or new audio-capture permission.
- Reproducible package, controller and real-browser smoke commands.

### Behavior and ownership

Actions are dispatched independently from informational UI announcements, so rapid clicks are not lost to message throttling. A queued greeting is handed back only after an interrupted action reaches its real idle boundary. Chew keeps the closed-mouth channel during its active and cancel transition; reset and destroy clear external mouth input. Pause freezes the rendered pose while TTL expiration follows wall-clock time.

### Validation record

The native102 source was saved, reopened and exported before runtime checks. Core readback covered the 66-parameter, 226-drawable and 59-part inventory and the accepted mouth-corner binding. Browser checks covered the three actions, chew, mouth ownership, pause, cancellation, re-entry, reset, outfit switching and page teardown. Public-page checks covered desktop and narrow layouts, model and expression requests, and the production absence of `window.__hikariQa`.

The performance comparison uses native101 versus native102 in one fixed headless Edge environment. It measures actual `drawModel` interval telemetry for three ten-second outfit runs. Median remained 4.2ms in every comparison; the measured means changed by +1.91%, +1.52% and −0.009% for outfits 0, 1 and 2. This is bounded comparative evidence, not a device-independent FPS guarantee or a claim that every browser has the same performance.

### Scope and non-goals

- The original PSD/CMO3 history is retained, but the published PSDs are not a complete final artwork master for all three outfits.
- No lower legs or feet were added; the existing upper-thigh artwork extent is preserved.
- No VTube Studio re-import, camera tracking, microphone input or webcam acceptance is included in this release.
- Media and screenshot review uses finite, labeled samples. It does not inspect every rendered frame or every parameter combination.
- The old failed candidates and recovery records remain evidence outside the public package; they are not silently rewritten as successful history.

### Upgrade guidance

Consumers should load the model3 file from `model/runtime/` by its current filename and preserve relative references. Code that assumes the older parameter inventory must enumerate the current model instead. External mouth writers should use the documented `hikari:mouth-input` event and treat TTL expiration, action priority and reset as part of the contract.
