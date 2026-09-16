# Third-party dependencies

The model license and the original code license do not relicense Live2D software.

## Live2D Cubism SDK for Web

The viewer is tested against **5-r.5**. Obtain it from [Live2D](https://www.live2d.com/en/sdk/download/web/).

- Core: [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
- Framework and shaders: [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).
- Application releases may also be subject to the [Cubism SDK Release License](https://www.live2d.com/en/download/cubism-sdk/release-license/).

No SDK, Core, Framework, shader or SDK type declaration is committed or included in the project's download archives. The local setup command copies selected files and the upstream license notices from a SDK directory you provide into ignored paths. The resulting local web build contains runtime components and must be distributed under the applicable upstream terms.

## Development tools

The npm lockfile pins Vite 8.0.2, TypeScript 5.9.3, Playwright 1.58.2 and Sharp 0.35.4 and their dependencies. Vite is MIT-licensed; TypeScript, Playwright and Sharp are Apache-2.0-licensed. Sharp is a build-time tool for lossless web texture encoding; consult its distributed notices for libvips and codec dependencies. Dependency packages and `node_modules` are not redistributed in this repository.

## Model scope

The current native102 CMO3 and runtime contain three outfits. The original HairFlow CMO3 and Photoshop artwork are retained as historical source materials; the PSDs are not a complete artwork master for all three current outfits. Private style references and raw internal audit logs are excluded.

Production includes Adobe Firefly-generated content. The model license preserves the no-AI/ML-training restriction associated with that content; it is a custom source-available asset license, not CC BY. See [provenance](docs/PROVENANCE.md), the [model license](LICENSES/Model-Attribution-NoAI-1.0.txt) and [Adobe's Generative AI Product Specific Terms, section 3.3](https://www.adobe.com/cc-shared/assets/pdf/legal/servicetou/adobe-generative-ai-product-specific-terms-en-us-20260423.pdf).
