/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import {
  safeParseAnimationAssets,
  safeParseAnimationProtocol,
} from "../../src/animation-protocol.js";
import { CHARACTER_ANIMATION_ARTIFACT_TYPE, CHARACTER_PLUGIN_ID } from "../../src/contract.js";

export const animationRuntimeState = reactive({ sessionId: "", cards: [], revision: 0 });

export function resetAnimationRuntimeState(sessionId = "") {
  animationRuntimeState.sessionId = String(sessionId || "").trim();
  animationRuntimeState.cards.splice(0);
  animationRuntimeState.revision = 0;
}

export function applyAnimationRuntimeEvent(envelope = {}) {
  const sessionId = String(envelope?.identity?.sessionId || "").trim();
  if (!sessionId) return { applied: false, reason: "missing_session_id" };
  if (
    envelope?.payload?.pluginId !== CHARACTER_PLUGIN_ID ||
    envelope?.payload?.artifactType !== CHARACTER_ANIMATION_ARTIFACT_TYPE
  ) {
    return { applied: false, reason: "unsupported_character_artifact" };
  }
  if (animationRuntimeState.sessionId !== sessionId) resetAnimationRuntimeState(sessionId);
  const assetResult = safeParseAnimationAssets(envelope?.payload?.data?.assets);
  if (!assetResult.success) return { applied: false, reason: "invalid_animation_assets" };
  const result = safeParseAnimationProtocol(envelope?.payload?.data?.protocol);
  if (!result.success) return { applied: false, reason: "invalid_animation_protocol" };
  const protocol = result.data;
  let card = animationRuntimeState.cards.find(
    (candidate) => candidate.animationId === protocol.animationId,
  );
  const created = !card;
  if (!card) {
    card = reactive({
      animationId: protocol.animationId,
      protocols: [],
      eventIds: [],
      assets: [],
      revision: 0,
    });
    animationRuntimeState.cards.push(card);
  }
  const eventId = String(envelope?.identity?.eventId || "").trim();
  if (card.eventIds.includes(eventId)) {
    return { applied: false, reason: "duplicate_event", animationId: protocol.animationId };
  }
  card.eventIds.push(eventId);
  const assetMap = new Map(card.assets.map((asset) => [asset.assetId, asset]));
  for (const asset of assetResult.data) assetMap.set(asset.assetId, asset);
  card.assets = [...assetMap.values()];
  card.protocols.push(protocol);
  card.revision += 1;
  animationRuntimeState.revision += 1;
  return {
    applied: true,
    created,
    animationId: protocol.animationId,
    cardRevision: card.revision,
    revision: animationRuntimeState.revision,
  };
}
