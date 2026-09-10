# Initial public release · v1.0.0

Published source combines the native HairFlow model delivery and the subsequent web ambient-breeze update. This public version number is independent of the online site's internal release numbering.

## Included

- One Cubism project, saved and reopened in Cubism Editor 5.3.01.
- Hair artwork master PSD and two-layer back-hair patch PSD.
- 18 runtime resources: MOC3, model metadata, parameter display metadata, physics, two 8192 textures and 12 expressions.
- Native neutral-pose preview.
- Web application source, including binocular gaze, interactions, pause/reset and six-channel ambient hair motion.

Model and artwork are copied byte-for-byte from the accepted delivery. `ASSET_MANIFEST.json` records their current identities. The web packaging removes workstation-specific paths and provides a local SDK setup command; it does not change the rig or the breeze coefficients.

## Validation boundary

The native model passed Photoshop intake checks, Cubism save/close/reopen checks, parameter endpoint reads and SDK rendering samples. The web breeze was checked using 1,800 fixed-step frames, a separate 12-second real-time run and finite rendered-image samples. With the same reset implementation, toggling only the breeze leaves 42 non-hair parameters identical. Reset outputs match a fresh SDK solver under the same inputs.

Expressions, pointer and touch interactions, desktop/mobile layouts, pause, reset and reduced-motion behavior were checked in a real browser. Finite samples do not cover every pose or every device. This current native export has no new VTube Studio import or camera-tracking acceptance.

## Editing

The CMO3 is the editable rig. The PSDs are artwork inputs; the hair patch contains only the two long back-hair layers. Re-export model resources from Cubism after changing the rig. The extra continuous breeze is implemented in the web application, so changes to that effect do not require an art re-export.
