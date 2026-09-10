# Third-party dependencies

The model license and the original code license do not relicense Live2D software.

## Live2D Cubism SDK for Web

The viewer is tested against **5-r.5**. Obtain it from [Live2D](https://www.live2d.com/en/sdk/download/web/).

- Core: [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
- Framework and shaders: [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).
- Application releases may also be subject to the [Cubism SDK Release License](https://www.live2d.com/en/download/cubism-sdk/release-license/).

No SDK, Core, Framework, shader or SDK type declaration is committed or included in the project's download archives. The local setup command copies selected files and the upstream license notices from a SDK directory you provide into ignored paths. The resulting local web build contains runtime components and must be distributed under the applicable upstream terms.

## Development tools

The npm lockfile pins Vite 8.2.2 and TypeScript 5.9.3 and their dependencies. Vite is MIT-licensed and TypeScript is Apache-2.0-licensed; consult the license files supplied with each installed package. Dependency packages and `node_modules` are not redistributed in this repository.

## Model scope

The published files are the current model project and its HairFlow artwork. Other outfits, style-reference folders, internal audit records and older model versions are not part of this release.

Production includes Adobe Firefly-generated content. The model license preserves the no-AI/ML-training restriction associated with that content; it is a custom source-available asset license, not CC BY. See [provenance](docs/PROVENANCE.md), the [model license](LICENSES/Model-Attribution-NoAI-1.0.txt) and [Adobe's Generative AI Product Specific Terms, section 3.3](https://www.adobe.com/cc-shared/assets/pdf/legal/servicetou/adobe-generative-ai-product-specific-terms-en-us-20260423.pdf).
