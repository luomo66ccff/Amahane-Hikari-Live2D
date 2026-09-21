# Production provenance

This project is initiated and maintained by luomo66ccff. Its production uses an AI-led execution workflow: Codex agents perform planning, code generation, tool orchestration, debugging, checks and documentation, while the maintainer provides requirements, visual/motion corrections, acceptance decisions and release authorization. Photoshop cleanup and painting, Cubism rigging, physics and expression setup remain actual production stages. See the [AI development record](AI_DEVELOPMENT.md) for responsibilities, inspectable changes and evidence limits.

## Artwork and model

The retained production history includes Adobe Firefly-generated hair, eye-component and accessory material. Photoshop was used for transparency handling, registration, local repainting and layer preparation; Cubism was used for mesh, deformer, parameter, physics and expression work. The native102 CMO3 and its 25-file runtime package are the accepted release outputs.

The provenance records do not map every final pixel back to an individual source layer or generation event. The project therefore does not describe the composite artwork as entirely hand-drawn, entirely human-made or free of Firefly material. The PSDs retained in the repository document their actual WIP and patch scope; they are not a complete final PSD for every current outfit.

The Firefly attribution is a statement in the retained production account. The public repository does not include the original generation sessions, prompt/seed receipts or a generated-image-to-final-layer mapping. A reader can inspect the retained PSDs and exported model, but these files alone do not independently establish which pixels came from Firefly. Exact generator versions and missing generation metadata remain unrecorded.

The model license preserves attribution and prohibits use of the model assets for creating, training, testing or improving AI/ML systems and related datasets. That restriction applies regardless of whether a particular asset was generated, painted or rigged by hand.

## Software and external components

The v2.1.0 `web/public/character-poster.webp` is a capture of the real native102 renderer, trimmed only to its transparent bounds and encoded as lossless WebP. The project cover and social preview are browser screenshots of the working page. These character images remain under the model/preview license; their presence beside MIT HTML and styles does not change that scope.

The original web application, styles, HTML, SVG favicon and release tools are MIT-licensed. Project documentation is CC BY 4.0. Model assets, artwork, textures, rig, expressions and previews use the custom [Model Attribution and No-AI License 1.0](../LICENSES/Model-Attribution-NoAI-1.0.txt).

Live2D Cubism Core, Framework, shaders and type declarations are obtained from the official **Cubism SDK for Web 5-r.5** by the user. The SDK source package is not redistributed by this repository; a generated web build may contain the runtime components needed by the viewer and must retain their upstream notices and terms. Read [third-party notices](../THIRD_PARTY_NOTICES.md) and the SDK licenses before setup or redistribution.

## Evidence boundary

The [AI evidence index](ai-evidence.json) records the published source baseline, fixed commits, artifact paths and verification entry points. It distinguishes reported production provenance from inspectable changes and recorded test results. Its asset references resolve to the existing [asset manifest](../ASSET_MANIFEST.json); the index does not duplicate asset hashes or certify AI authorship. Future contributions can preserve their actual execution and acceptance evidence with the [AI change record](templates/AI_CHANGE_RECORD.md).

The release record distinguishes native save/reopen/export checks, Core readback, browser interaction checks, media sampling and public-page smoke checks. A report proves only the cases it names. Finite samples do not establish every pose, device, browser, VTube Studio import or camera-tracking result.

The performance comparison uses native101 as the already-upgraded baseline and native102 as the release candidate. It measures intervals between actual `drawModel` timestamps in one fixed headless Edge environment for three outfits and roughly ten seconds per case; it is not a general FPS guarantee. The model artwork currently reaches the upper thighs, so no lower legs or feet are implied by a full-canvas preview.
