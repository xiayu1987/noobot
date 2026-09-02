# Noobot character animation plugin

This plugin imports animated GLB files in the browser, records their exact clip
and node metadata, and renders LLM-authored animation protocols with Three.js.
It contributes agent tools for creating, reading, replacing, and compiling
declarative animation scripts.

The protocol is `noobot.animation.protocol` version 4. An animation has an
`animationId` and one synchronized, gap-free timeline per participating
character. Each character declares its imported `assetId` and root transform;
the scene declares normalized collision space, contact constraints and a camera track. Existing IDs
are replaced only with an explicit base revision. Scripts are structured
`sequence`/`parallel`/`event` trees; JavaScript is never executed.
Authoritative `plugin.artifact` events drive playback. GLB assets use meter source units, a right-handed Y-up/-Z-forward axis convention and a `foot_center` anchor. Input root motion is `character_local`; compilation produces absolute `normalized_world` tracks. Characters expose `orientationMode`: `face_motion` aligns locomotion to travel direction, while `authored` preserves backing and side-step facing. The runtime applies `rootTransform × rootMotion × assetCanonicalTransform` and reports trajectory distance, speed, clearance and penetration intervals.

Scripts also support semantic movement, orientation and posture presets. Move
nodes use `{ type: "move", characterId, mode, clip, target, duration?, obstacleId?, clearance? }`;
orientation nodes use `{ type: "orient", characterId, mode: "face", clip, target, duration? }` or `{ type: "orient", characterId, mode: "turn", clip, angle, duration? }`;
and posture nodes use `{ type: "posture", characterId, mode: "idle"|"stop"|"crouch"|"kneel"|"sit"|"lie"|"stand_up", clip, duration }`.
For precise model-authored animation programming, use a `channel` node:
`{ type: "channel", characterId, channelId, duration, tracks, rootMotion? }`.
Each track targets one imported node/property (`position`, `rotation` or
`scale`) and must provide complete keyframes from zero to its duration. The
channel label is retained on the authoritative v4 track; the renderer executes
that same v4 timeline, with no second runtime protocol.
Move modes include `walk`, `run`, `crawl`, `jump`, `hop`, `drop`, `detour`,
`step_over`, `jump_over`, `vault`, and `climb_over`. `target` is a world-space
destination; the start is the character root or the preceding node endpoint.
Obstacle modes reference a solid box collider declared in
`scene.collisionSpace`. The compiler expands these nodes into the same
authoritative v4 timeline and rejects unsupported geometry or invalid
ground/obstacle constraints.

Continuous solid collision playback uses `@dimforge/rapier3d-compat` (Rapier 3D
WASM, Apache-2.0). Each character is represented by a kinematic body with
capsule, sphere, or box colliders; the runtime adds a fixed ground collider,
uses a character controller for swept movement and grounding, enables CCD, and
projects the corrected position back to the Three.js anchor. `events_only`
protocols keep authored positions without the solid projection step.

New animations select a built-in, versioned camera preset through
`scene.camera`; the plugin compiler expands that request into the only runtime
representation, a complete `cameraTrack`. Artifacts never retain preset
references, so later catalog changes cannot alter existing animations. Use
`character_camera_preset_list` to read stable preset IDs and
`character_animation_camera_apply` to replace an existing animation's camera
at an explicit revision.

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
