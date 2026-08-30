# Noobot character animation plugin

This plugin imports animated GLB files in the browser, records their exact clip
and node metadata, and renders LLM-authored animation protocols with Three.js.
It contributes one agent tool: `character_animation_generate`.

The protocol is `noobot.animation.protocol` version 1. An animation has an
`animationId` and one synchronized, gap-free timeline per participating
character. Each character declares its imported `assetId`, initial world
position, recognized native clips, and optional position/quaternion/scale
keyframes. Passing an existing ID appends to its animation card; omitting the
ID creates one and returns it. JavaScript and unknown assets, clips, or nodes
are never accepted. Authoritative `plugin.artifact` events drive playback.

The right feature panel imports and previews GLB files. The Composer More
Actions extension selects assets for the current model request. Only selected
metadata is sent to the model; GLB bytes remain in browser IndexedDB.

## Creating animations with an LLM

1. Import an animated GLB in the Character feature.
2. Let the plugin inspect the asset's native clips and node names.
3. Select one or more character assets in Composer **More actions**.
4. Describe the intended movement in natural language.
5. The model calls `character_animation_generate`.
6. The plugin validates and commits the `noobot.animation.protocol` payload.
7. The Session artifact panel renders the protocol and preserves it across refreshes.

Use an existing `animationId` to extend the same animation card across turns.
Omit it to create a new animation artifact. The model supplies intent and
keyframes; the plugin remains responsible for asset identity, clip/node validity,
timing, and browser-side playback.

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
