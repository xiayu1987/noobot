# Noobot character animation plugin

This plugin imports animated GLB files in the browser, records their exact clip
and node metadata, and renders LLM-authored animation protocols with Three.js.
It contributes agent tools for creating, reading, replacing, and compiling
declarative animation scripts.

The protocol is `noobot.animation.protocol` version 2. An animation has an
`animationId` and one synchronized, gap-free timeline per participating
character. Each character declares its imported `assetId` and root transform;
the scene declares normalized collision space and a camera track. Existing IDs
are replaced only with an explicit base revision. Scripts are structured
`sequence`/`parallel`/`event` trees; JavaScript is never executed.
Authoritative `plugin.artifact` events drive playback.

The right feature panel imports and previews GLB files. The Composer More
Actions extension selects assets for the current model request. Only selected
metadata is sent to the model. GLB bytes are stored by the authenticated
workspace asset service and cached in browser IndexedDB for playback.

## Creating animations with an LLM

1. Import an animated GLB in the Character feature.
2. Let the plugin inspect the asset's native clips and node names.
3. Select one or more character assets in Composer **More actions**.
4. Describe the intended movement in natural language.
5. The model calls `character_animation_generate` or `character_animation_script`.
6. The plugin validates and commits the `noobot.animation.protocol` payload.
7. The Session artifact panel renders the protocol and preserves it across refreshes.

Call `character_animation_get` before modifying an existing `animationId`, then
call `character_animation_update` or `character_animation_script` with its
`baseRevision`. Creation and replacement are distinct operations; no append
behavior exists.

The repository demo GIF is generated from the real Three.js runtime with:

```bash
node scripts/generate-character-animation-demo.mjs
```

The homepage also includes `noobot-character-animation-runtime.gif`, captured
from a running Noobot deployment. Recreate that recording with real credentials:

```bash
NOOBOT_E2E_USER_ID=... \
NOOBOT_E2E_CONNECT_CODE=... \
node scripts/capture-character-animation-runtime.mjs
```

`assets/samples/robot-expressive/RobotExpressive.glb` is the Three.js r180
official example model. Its accompanying README records the CC0 1.0 license.

The built-in sample catalog also includes `Soldier.glb`, `Flamingo.glb`,
`Horse.glb`, and `Parrot.glb` from the Three.js examples repository (r180).
These files are redistributed for demonstration and interoperability testing;
their upstream attribution and license notices are recorded in
`assets/samples/THREEJS-SAMPLES-LICENSES.md`. Review each notice before using
the samples in a separately distributed product.
