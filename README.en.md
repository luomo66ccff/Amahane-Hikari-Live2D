# Amahane Hikari · Live2D v2.0.0

[简体中文](README.md) · [Interactive demo](https://live2d.luomo.moe/Amahane_Hikari/) · [Release repository](https://github.com/luomo66ccff/Amahane-Hikari-Live2D)

A silver-haired, red-eyed Live2D character with white animal ears and moon/snow details. v2.0.0 uses the native102 runtime model and includes three outfits, twelve expressions and reproducible web interactions.

<img src="previews/native102-dress.png" alt="Amahane Hikari native102 formal neutral preview" width="420" />

The public display name is **Amahane Hikari**. Production filenames retain **SuJiangXue / 苏绛雪** so Cubism and runtime references remain stable.

## Current release

| Item | Contents |
| --- | --- |
| Native version | native102; editable project: `model/source/Cubism/SuJiangXue_HairFlow_WIP_t102.cmo3` |
| Runtime | `model/runtime/`: 25 files, 8 textures, 66 parameters, 226 drawables and 59 parts |
| Outfits | Formal, school and swimsuit; the existing artwork ends at the upper thighs |
| Expressions | Neutral, Smile, Happy, Shy, Angry, Sad, Surprised, Sleepy, Cry, Wink_L, Wink_R and HappyCat |
| Web actions | Curiosity, shy and smug; left/right closed-mouth chew; cancel, re-entry, pause, reset and mouth handoff |
| Web controls | Gaze follow, tap feedback, drag, zoom, outfit switching, pause, reset and responsive layout |

The native package also retains one demo motion. Other native102 stills are available as `previews/native102-school.png`, `previews/native102-swim.png` and `previews/native102-mobile.png`. Web actions use verified parameter bindings; the presence of a parameter ID alone is not treated as semantic binding. See [validation](docs/VALIDATION.md) for the evidence boundary.

## Use the model

[Download v2.0.0](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/releases/tag/v2.0.0): runtime, editable CMO3, three-outfit comparison clips and release manifest. Before is native101 with head/shoulder upgrades already present; after is native102 and the final controller.

Preserve the directory structure under `model/runtime/` and load `SuJiangXue_HikariSmirk_t001.model3.json`. To continue rigging, open `model/source/Cubism/SuJiangXue_HairFlow_WIP_t102.cmo3` in **Live2D Cubism Editor 5.3.01**, then save, reopen and re-export the affected runtime resources.

The PSD files retained under `model/source/Photoshop/` are production inputs and local artwork patches. They are not a complete final PSD for all three outfits. Model, artwork, textures, rig, expressions and previews are governed by the [model license](LICENSES/Model-Attribution-NoAI-1.0.txt).

## Run the web viewer

Use Node.js **22.12+ or 24**. Obtain **Cubism SDK for Web 5-r.5** from the [official Live2D download page](https://www.live2d.com/en/sdk/download/web/), read its terms and extract it locally. The SDK is not redistributed here.

```sh
git clone https://github.com/luomo66ccff/Amahane-Hikari-Live2D.git
cd Amahane-Hikari-Live2D/web
npm ci
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npm run dev
```

Open the `/Amahane_Hikari/` URL printed by Vite. Quote SDK paths on Windows as well. Setup copies only required files from the local SDK, leaves the source SDK unchanged and stops if an existing destination file differs.

Build and preview with:

```sh
npm run build
npm run preview
```

The build verifies and synchronizes `model/runtime/`. Set `VITE_BASE` when serving under another path. Any public build must retain the applicable Live2D SDK terms.

## Mouth input

The viewer exposes a short-lived mouth input event for an external controller. It does not request microphone access:

```js
window.dispatchEvent(new CustomEvent('hikari:mouth-input', {
  detail: { open: 0.2, form: 0, pucker: 0, ttlMs: 180 }
}));

// Clear external mouth input
window.dispatchEvent(new CustomEvent('hikari:mouth-input', { detail: null }));
```

`open` is 0–1, `form` is −1–1, `pucker` is 0–1 and `ttlMs` defaults to 180ms with a 1–1000ms range. Pause freezes the final pose while TTL still expires on wall-clock time; reset and destroy clear the input. Closed-mouth chew keeps priority during the active and cancel transition, then hands control back to the external input.

## Reproducible checks

Run from `web/`:

```sh
npm run verify
npm run test:controller
npm run test:smoke -- http://127.0.0.1:5188/Amahane_Hikari/ ./reports/page-smoke
```

`verify` checks the asset manifest and runtime references. `test:controller` covers action intent, cancellation, pause, re-entry and reset only. `test:smoke` performs ordinary-page checks in a real headless browser, including the page entry, real resources, expressions, outfits and the absence of the DEV surface in the production build; it does not inject the internal model controller. Mouth handoff and TTL are covered by a separate browser ownership check. Install Chromium with `npx playwright install chromium`, or skip that step and set `BROWSER_CHANNEL=msedge` for installed Edge. The final local and public runs each passed 62 checks. See [validation](docs/VALIDATION.md) for network settings and limits.

## Repository layout

```text
model/source/Cubism/       Editable native102 CMO3
model/source/Photoshop/    Production PSD inputs and patches; not a complete final outfit master
model/runtime/             native102 MOC3, model3, physics3, CDI, textures, expressions and motion
previews/                  native102 formal, school, swimsuit and mobile stills; neutral.png is historical
web/                       Web application source; SDK and build output are ignored
scripts/                   SDK setup, model sync, manifest checks and release validation
ASSET_MANIFEST.json        Asset identity and SHA-256 manifest
LICENSES/                  Project and model license texts
```

See [workflow](docs/WORKFLOW.md), [lessons learned](docs/LESSONS_LEARNED.md), [release notes](docs/RELEASE_NOTES.md) and [provenance](docs/PROVENANCE.md) for the reproducible production record.

## Licensing and attribution

Model assets, artwork, textures, rig, expressions and previews use the [Model Attribution and No-AI License 1.0](LICENSES/Model-Attribution-NoAI-1.0.txt). Commercial use, modification and redistribution are permitted with attribution, retained terms and change notices. Use for creating, training, testing or improving AI/ML systems or associated datasets is prohibited. This is source-available model licensing with a use restriction, not CC BY or an OSI-approved open-source license.

Original web code, styles, HTML, SVG favicon and tools use [MIT](LICENSES/MIT.txt). Documentation uses CC BY 4.0. Suggested credit: **Amahane Hikari / SuJiangXue — luomo66ccff, Model Attribution and No-AI License 1.0**, with a link to the upstream repository.

Live2D Core, Framework, shaders and type declarations are third-party SDK components. They are not included in the source repository or source-model download package; generated web builds may contain the runtime components and must retain the applicable notices and terms. See [third-party notices](THIRD_PARTY_NOTICES.md).
