# Amahane Hikari · Live2D v2.1.0

[English](README.en.md) / [简体中文](README.md)

[![SDK-free regression](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/actions/workflows/sdk-free-regression.yml/badge.svg)](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/actions/workflows/sdk-free-regression.yml)

A moon-and-snow Live2D character with an editable TypeScript/Vite viewer, deterministic motion controllers, reproducible checks, and a reusable production skill.

[Interactive demo](https://live2d.luomo.moe/Amahane_Hikari/) · [Model download (v2.0.0)](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/releases/tag/v2.0.0) · [Production skill source](skills/live2d-end-to-end/SKILL.md) · [Skill package (v2.0.1)](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/releases/tag/v2.0.1) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

<p align="center">
  <img src="previews/oss-showcase.webp" alt="Amahane Hikari Live2D showcase in a moon-and-snow palette" width="960" />
</p>

<details>
<summary>View the three outfit stills</summary>

<p align="center">
  <a href="previews/native102-dress.png"><img src="previews/native102-dress.png" alt="Formal outfit preview" width="30%" /></a>
  <a href="previews/native102-school.png"><img src="previews/native102-school.png" alt="School outfit preview" width="30%" /></a>
  <a href="previews/native102-swim.png"><img src="previews/native102-swim.png" alt="Swimsuit outfit preview" width="30%" /></a>
</p>

</details>

## What is here

Amahane Hikari brings a real Live2D Cubism character into the browser and shares the code and production process behind it. Explore the action controller, reproduce loading and resource-cleanup failures, or use the production skill to begin your own character project.

Software and tools are MIT-licensed; documentation is CC BY 4.0. Character assets are source-available under separate Attribution + No-AI terms. See the [license section](#licensing-and-attribution) for each component's scope.

Maintainer: `luomo66ccff`. Code assistance: Hermes (`Amahane-Hikari`).

## Current contents

| Area | Included |
| --- | --- |
| Web runtime | TypeScript/Vite, WebGL 2, Cubism Core/Framework integration, responsive controls |
| Character interaction | 12 expressions, formal/school/swimsuit outfits, gaze follow, tap feedback, drag, zoom, pause and reset |
| Action system | `curiosity`, `shy` and `smug` public UI actions; the controller also retains `chewLeft` / `chewRight` mouth handoff boundaries |
| External input | Short-lived `hikari:mouth-input` events; no microphone permission is requested |
| Production skill | A reusable path from artwork checks and Photoshop gates through Cubism rigging, runtime acceptance and recovery |
| Reproducible checks | SDK-free controller, runtime-double, resource-cleanup and DOM-event checks; real model checks require the SDK |

The checked-in model is `native102`. Production filenames retain the historical `SuJiangXue / 苏绛雪` name so Cubism and runtime references stay stable. The artwork currently reaches the upper thighs; previews do not imply lower legs or feet.

## Run SDK-free checks first

Node.js must satisfy the requirement in `web/package.json`: **22.12+**. Install dependencies and run checks from `web/`:

```sh
git clone https://github.com/luomo66ccff/Amahane-Hikari-Live2D.git
cd Amahane-Hikari-Live2D/web
npm ci
npm test
npx playwright install chromium
npm run test:events
```

`npm test` covers the action controller, bounded frame timing, mouth TTL, pause/reset behavior and resource cleanup with TypeScript transpilation and explicit runtime doubles. It does not render a real model. `npm run test:events` uses real Chromium to check the `main.ts` DOM listener and the README mouth example; it also loads no SDK or model. Install Chromium once, or set `BROWSER_CHANNEL=msedge` to use an installed Edge.

The asset manifest and runtime reference closure can be checked separately:

```sh
npm run verify
```

## Run the complete viewer

v2.1.0 adds the project homepage, static preview and contributor documentation. Editable model packages are in v2.0.0, and the standalone Skill package is in v2.0.1. See the [release notes](docs/RELEASE_NOTES.md) for each version's contents and validation scope.

The full viewer requires **Cubism SDK for Web 5-r.5**. Obtain it from the [official Live2D download page](https://www.live2d.com/en/sdk/download/web/), read its terms, and extract it locally. The SDK, Core, Framework, shaders and type declarations are not distributed by this repository.

From `web/`:

```sh
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:5188/Amahane_Hikari/`. On Windows, quote paths as well. The setup script checks `cubism-info.yml` for `5-r.5`, then copies only the required files into ignored `web/vendor/`, `web/public/vendor/` and `web/public/licenses/` paths. It leaves the source SDK untouched and does not download an SDK.

Build and preview locally with:

```sh
npm run build
npm run preview
```

`dev`, `build` and `preview` first verify the model and prepare web-only resources, so the complete viewer path requires SDK setup. The default Vite base is `/Amahane_Hikari/`; set `VITE_BASE` when serving from another path. The build creates web-only texture files in ignored paths and leaves canonical PNG, MOC3 and CMO3 files unchanged. With the production preview server running after `npm run build`, a real page smoke check is:

```sh
npm run test:smoke -- http://127.0.0.1:5188/Amahane_Hikari/ ./reports/page-smoke
npm run test:project-page -- http://127.0.0.1:5188/Amahane_Hikari/ ./reports/project-page
```

This check needs `npm run preview`, a browser and the SDK-backed web resources. It verifies that development QA globals are absent, so do not run it against `npm run dev`. Results cover the browsers, viewports and interactions listed in the report.

## Mouth input

An external controller can dispatch a short-lived mouth event on `window`. `open` is `0–1`, `form` is `−1–1`, and `pucker` is `0–1`; `ttlMs` defaults to `180` ms and accepts `1–1000` ms. Dispatching `null` clears the current input. See [architecture](docs/ARCHITECTURE.md) for ownership and action handoff details.

## Repository map

```text
model/runtime/             native102 model3, MOC3, physics, expressions, motion and textures
model/source/Cubism/       Editable CMO3; filenames retain the SuJiangXue history
model/source/Photoshop/    Production inputs and patches, not a complete final outfit master
previews/                  Character previews, including the OSS hero image
web/src/                   UI, runtime, action, mouth, presence and helper modules
scripts/                   SDK setup, model sync, manifest checks and browser checks
skills/                    Portable Live2D production skill
LICENSES/                  MIT, CC BY 4.0 and model license texts
ASSET_MANIFEST.json        Identity and SHA-256 manifest for model and preview files
```

See [architecture](docs/ARCHITECTURE.md) for the runtime pipeline and contracts, [roadmap](docs/ROADMAP.md) for uncommitted work, and [CONTRIBUTING.md](CONTRIBUTING.md) for code, translation and reproduction guidance. The production record is in [workflow](docs/WORKFLOW.md), [validation](docs/VALIDATION.md), [provenance](docs/PROVENANCE.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Licensing and attribution

| Content | License | Boundary |
| --- | --- | --- |
| Original web code, styles, HTML, SVG favicon and utilities | [MIT](LICENSES/MIT.txt) | Follow the file SPDX markers and license text |
| Documentation and skill prose | [CC BY 4.0](LICENSES/CC-BY-4.0.txt) | Retain credit, license link and modification notice when sharing adaptations |
| Model, artwork, textures, rig, expressions, source CMO3/PSD and previews | [Model Attribution and No-AI License 1.0](LICENSES/Model-Attribution-NoAI-1.0.txt) | Follow its permissions, credit, change marking and AI/ML restriction; it is custom source-available licensing, not OSI open source |
| Live2D Core, Framework, shaders and type declarations | Live2D upstream terms | The SDK is obtained separately; generated builds that contain SDK components must retain applicable notices |

When redistributing model files or derivatives, retain the license and use this credit:

> Amahane Hikari / SuJiangXue — luomo66ccff, Model Attribution and No-AI License 1.0. Source: https://github.com/luomo66ccff/Amahane-Hikari-Live2D

The model license prohibits using these model materials or derived data to create, train, test or improve AI/ML systems or related datasets. Code contributions, documentation translations and model-asset changes have different boundaries; read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting.
