# Roadmap

This is a list of useful follow-up work for the repository. Items under **planned** are not promises, do not have target dates, and are not evidence that the work has started. The current baseline is listed separately so that existing behavior is not confused with future work.

## Current baseline

- A Vite/TypeScript viewer loads the checked-in native102 model through a locally supplied Cubism SDK for Web 5-r.5.
- The viewer exposes three outfits, twelve expressions, gaze follow, tap interaction, drag and zoom controls, pause/reset behavior, and three authored UI actions.
- `hikari:mouth-input` provides a bounded, short-lived external mouth-input boundary without requesting microphone access.
- `web/` has SDK-free checks for the action controller, frame timing, runtime contracts, asynchronous texture ownership and DOM event behavior. `npm run verify` checks the canonical model/preview manifest and runtime reference closure.
- `skills/live2d-end-to-end/` documents a reusable artwork-to-Cubism-to-runtime workflow with explicit evidence limits and recovery guidance.

## Planned

### Model adaptation guide

Document how to evaluate another Cubism model against the runtime's required parameter groups, outfit range, expressions, physics and drawable assumptions. Include a small capability matrix and a development-only model loading example so contributors can distinguish a compatible model from one that merely contains similarly named IDs.

### Device and browser coverage

Build a reproducible WebGL 2 test matrix for desktop and mobile viewport classes, with browser and GPU information recorded alongside results. Add coverage only after the corresponding real model and interaction checks have run; until then, do not describe an untested device or browser as supported.

### Visual loading and recovery acceptance

Extend real-browser acceptance around slow or interrupted model/shader/texture loads, retry, Cache Storage fallback, WebGL context loss and returning from a hidden tab. Record the user-visible state and cleanup result for each case, including reduced-motion behavior.

### Public runtime examples

Provide small, copyable JavaScript/TypeScript examples for the mouth event and any intentionally public action boundary. Keep the examples aligned with the actual listener and add contract checks when their shape changes. Document which examples require a mounted model and which can run SDK-free.

### Contributor onboarding and translations

Add focused guidance for extending a controller module, writing a browser regression, and translating a document without changing its license or evidence meaning. Use real repository commands and keep the Chinese and English entry points synchronized when public behavior changes.

### Release and license inventory

Make release preparation easier to audit by producing a concise archive inventory that separates MIT code, CC BY documentation, custom model assets and user-supplied SDK files. Keep generated output and third-party notices reproducible without committing SDK contents.

Roadmap order may change as maintainers and contributors learn from real usage. Propose a new item with a concrete user or maintainer problem, its verification boundary and the smallest useful deliverable.
