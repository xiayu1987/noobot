/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";
import { readSelectedCharacterAssets } from "./asset-catalog.js";

const contextHeading = "Character animation assets:";
const content = (message = {}) => String(message?.content ?? message?.lc_kwargs?.content ?? "");

export async function injectAnimationContext(context = {}, config = {}) {
  const assets = await readSelectedCharacterAssets(config);
  const modelContext = context?.modelContext;
  if (!assets.length || !modelContext?.messageBlocks?.system) return false;
  if (
    modelContext.messageBlocks.system.some((message) => content(message).startsWith(contextHeading))
  )
    return false;
  const modelAssets = assets.map((asset) => ({
    assetId: asset.assetId,
    clips: asset.animations.map((item) => item.name),
    nodes: asset.nodes,
  }));
  appendContextMessage(
    modelContext,
    {
      role: "system",
      content: `${contextHeading} Protocol v4. Coordinates are right-handed normalized_world (Y-up, -Z forward); 1 unit is one canonical character height and the foot_center is the anchor. For character_animation_script, arguments are {script, animationId?, baseRevision?}: omit animationId and baseRevision when creating; for an existing animation call character_animation_get first and provide both animationId and its positive revision. The script object must contain format:"noobot.animation.script", version:1, scene, characters and root. Put coordinateSystem:"normalized_world", unitHeight:1, groundY:0, collisionSpace and contactConstraints inside scene; use scene.camera:{presetId:"camera.static.wide"}. Use semantic nodes: move {type:"move", characterId, mode:"walk"|"run"|"crawl"|"jump"|"hop"|"drop"|"detour"|"step_over"|"jump_over"|"vault"|"climb_over", clip, target:[x,y,z], duration?, obstacleId?, clearance?}; orient face {type:"orient", characterId, mode:"face", clip, target:[x,y,z], duration?}; orient turn {type:"orient", characterId, mode:"turn", clip, angle, duration?}; posture {type:"posture", characterId, mode:"idle"|"stop"|"crouch"|"kneel"|"sit"|"lie"|"stand_up", clip, duration}; for precise channels use {type:"channel", characterId, channelId, duration, tracks:[{node, property:"position"|"rotation"|"scale", keyframes:[{time,...}]}], rootMotion?}. Channel tracks are compiled into the same authoritative v4 timeline; no code is executed. target is world-space; the start is rootTransform or the previous node endpoint, so never repeat a from field. Obstacle modes require obstacleId referencing a solid box collider in scene.collisionSpace. The compiler creates the root trajectory and rejects invalid clearance or geometry. Do not nest scripts or move scene fields into collisionSpace. Existing animations: get before update. Each character requires characterId, assetId and rootTransform. Use only listed clips/nodes; timelines are synchronized and gap-free. The result returns trajectory diagnostics (distance, average/max speed, minimum clearance, penetration intervals).\n${JSON.stringify(modelAssets)}`,
    },
    { block: "system" },
  );
  return true;
}
