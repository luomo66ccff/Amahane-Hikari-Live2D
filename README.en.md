# Amahane Hikari · Live2D

[简体中文](README.md) · [Interactive demo](https://live2d.luomo.moe/Amahane_Hikari/) · [Runtime downloads](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/releases/latest)

A silver-haired, red-eyed Live2D character with white animal ears and moon/snow details. This repository provides the editable Cubism project, Photoshop hair artwork, exported runtime assets and the interactive web application with ambient hair motion.

<img src="previews/neutral.png" alt="Native neutral-pose preview" width="420" />

The public display name is **Amahane Hikari**. Production filenames retain **SuJiangXue / 苏绛雪** to preserve the original resource references.

## Model files

- Open `model/source/Cubism/SuJiangXue_HairFlow_t001.cmo3` in **Cubism Editor 5.3.01**.
- Load `model/runtime/SuJiangXue_HairFlow_t002.model3.json` in a compatible Cubism runtime. Preserve the directory structure.
- The two PSDs in `model/source/Photoshop/` are the hair artwork master and a two-layer back-hair import patch. Their WIP filenames identify their editing scope.
- The repository contains real source binaries, without Git LFS. GitHub's **Download ZIP** includes the sources; Releases also provide a smaller runtime-only archive.

The model has **48 parameters, 182 drawables, 14 physics groups and 17 physics outputs**, plus 12 expressions. The web viewer supports gaze, tap feedback, dragging, zoom, pause, reset, reduced motion and responsive layouts.

Ambient breeze is implemented in `web/src/hair-breeze.ts` and applied after native physics in `runtime.ts`. It is an additional web behavior, not embedded in the MOC3 export. The native rig retains its own segmented hair and arm physics.

This export was verified with **Cubism SDK for Web 5-r.5**. The current HairFlow version has not been re-imported into VTube Studio or tested with camera tracking. Check the target runtime's Core compatibility or re-export from the CMO3 as needed. The web viewer requires **WebGL 2 and 8192-pixel textures**.

## Run the viewer

Install Node.js **22.12+ or 24**. Obtain and extract **Cubism SDK for Web 5-r.5** from the [official download page](https://www.live2d.com/en/sdk/download/web/) under its own terms. The SDK is not redistributed here.

```sh
git clone https://github.com/luomo66ccff/Amahane-Hikari-Live2D.git
cd Amahane-Hikari-Live2D/web
npm ci
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npm run dev
```

Open the `/Amahane_Hikari/` URL shown in the terminal. Quote the SDK directory on Windows too. Setup copies only required files from your local SDK, leaves the source SDK unchanged and rejects a differing existing destination.

Use `npm run build` and `npm run preview` for a production build. Set `VITE_BASE` for another deployment path. Model files are verified and copied automatically before running or building. Run `node scripts/verify-package.mjs` from the repository root to verify the asset manifest and runtime references without installing the SDK.

## License

Model assets, artwork, rig, textures, expressions and previews use the **[Model Attribution and No-AI License 1.0](LICENSES/Model-Attribution-NoAI-1.0.txt)**. Commercial use, modification and redistribution are permitted with attribution, retained license terms and change notices. Use for creating, training, testing or improving AI/ML systems or associated datasets is prohibited. This is source-available model licensing with a use restriction, not CC BY or an OSI-approved open-source license.

Suggested credit: **Amahane Hikari / SuJiangXue — luomo66ccff, Model Attribution and No-AI License 1.0**, with a link to this repository.

Original application code and tools: **[MIT](LICENSES/MIT.txt)**. Text documentation uses CC BY 4.0; embedded model images retain the model license. Production includes AI assistance and Firefly-generated content; see [provenance](docs/PROVENANCE.md). Live2D SDK dependencies keep their own terms and are not included. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [release notes](docs/RELEASE_NOTES.md).
