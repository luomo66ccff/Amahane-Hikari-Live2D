# Contributing

Thank you for helping make Hikari easier to run, inspect and extend. Contributions are welcome in three practical areas: JavaScript/TypeScript runtime work, documentation and translations, and carefully recorded bug reproductions. Please open an issue first when a change would alter a public runtime contract or the model asset boundary.

## Before you start

1. Read the root [README](README.md), [architecture](docs/ARCHITECTURE.md) and the applicable [license files](README.md#许可与署名).
2. Create a focused branch or fork and keep unrelated generated files out of the change.
3. Do not commit credentials, cookies, private audit logs, `node_modules`, `web/vendor`, `web/dist`, `web/public/vendor`, `web/public/model` or `web/reports`.
4. Use the issue templates when asking for a feature, translating documentation or reporting a reproducible problem. Security-sensitive reports belong in [SECURITY.md](SECURITY.md), not in a public issue.

The repository contains multiple license boundaries. Original web code and utility scripts are MIT-licensed; documentation and Skill prose are CC BY 4.0; model artwork and model files use the custom Model Attribution and No-AI License 1.0; Live2D SDK files remain under Live2D's terms. A code contribution does not change the model license or grant permission to use model assets for AI/ML work.

## SDK-free development checks

Use Node.js 22.12 or newer and run these commands from `web/`:

```sh
npm ci
npm test
npm run verify
npx playwright install chromium
npm run test:events
```

The first three commands do not require a Live2D SDK. `npm test` exercises the controller, frame timing, runtime contracts and resource cleanup with explicit doubles. `npm run test:events` uses a real browser for the public DOM event listener and the documented README example; it does not render a model.

If Chromium is already available through Edge, set `BROWSER_CHANNEL=msedge` for the browser command. If a change affects the real viewer, SDK-backed build or visual interaction, also install the locally obtained Cubism SDK for Web 5-r.5 and run:

```sh
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npm run build
npm run preview
```

With the server running, use the smoke command from the README. Record the browser, viewport and SDK version when reporting visual results. The setup script copies SDK files only into ignored paths; never commit those copies.

## JavaScript and TypeScript changes

Keep runtime changes close to the module that owns the behavior. `web/src/main.ts` owns application lifecycle and the public mouth event listener, `ui.ts` owns DOM controls, `runtime.ts` owns Cubism loading and the frame pipeline, and `action-controller.ts` owns renderer-independent action intents. See [architecture](docs/ARCHITECTURE.md) before changing parameter ownership or event behavior.

For a code change:

- describe the user-visible or contract-level behavior in the pull request;
- add or update a meaningful regression check when a boundary changes;
- run `npm test` and `npm run verify` when the affected files allow it;
- run `npm run test:events` for `main.ts`, the mouth event or its README example;
- run `npm run build` and a real browser smoke check for SDK-backed runtime, UI, loading or rendering changes;
- update the README or architecture document when a public command, event or capability changes.

Tests that use doubles must say what they do not prove. A passing controller or runtime-double test does not establish Cubism rendering quality, a successful model export, support on every device, or natural motion in every pose.

## Documentation and translations

Documentation fixes and translations are welcome. Preserve the meaning of commands, paths, version constraints, license boundaries and evidence limits. Do not turn a finite check into a general guarantee or add claims about downloads, adoption, supported devices or completed roadmap work without repository evidence.

When translating a document:

- keep code, file names, parameter IDs, URLs and license names unchanged unless the translation needs an explanatory gloss;
- keep links pointing to the same source section where practical;
- mark substantive translation or editorial changes in the pull request;
- check every relative link from the edited document.

The documentation license is CC BY 4.0. A translation is an adaptation, so retain attribution and link to the license. Do not translate or paraphrase the model license in a way that changes its legal meaning; link to the canonical text instead.

## Reproducible reports

Use the [reproduction issue template](.github/ISSUE_TEMPLATE/reproduction.md) for a normal bug. Include the smallest command or page interaction that demonstrates the problem, the commit or release tested, operating system, Node.js version, browser and SDK version when relevant, expected behavior, actual behavior and a sanitized error or trace. Add screenshots or a short recording only when they clarify a visual or interaction issue.

Do not attach secrets, cookies, access tokens, private model sources or unlicensed third-party material. If the problem could affect confidentiality, integrity or user-controlled script execution, follow [SECURITY.md](SECURITY.md) instead and keep the details private.

## Model and asset changes

Model, artwork, PSD, CMO3, texture, expression and preview changes require a clear provenance note, the exact files affected and confirmation that the custom model license still applies. Keep `ASSET_MANIFEST.json` consistent with any authorized asset change and explain the verification performed. Do not assume that the MIT license for web code covers model assets.

The model license prohibits using the supplied model materials or data derived from them to create, train, test or improve AI/ML systems or related datasets. Do not submit generated or third-party material without the rights needed for its proposed use.

## Pull requests

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Keep the title and description about the final change, link the relevant issue when one exists, and state the checks that actually ran. Maintainers may request a narrower patch or additional evidence when a change touches runtime ownership, licensing, generated assets or public behavior.

There is no promise of a particular review time or merge outcome. A maintainer will decide whether a change fits the project's scope, evidence standard and license boundaries.
