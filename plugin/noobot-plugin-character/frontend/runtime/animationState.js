/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { reducePluginArtifact } from "@noobot/event-protocol";
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

function rejectEnvelope(envelope, sessionId) {
  if (!sessionId) return { applied: false, reason: "missing_session_id" };
  if (
    envelope?.payload?.pluginId !== CHARACTER_PLUGIN_ID ||
    envelope?.payload?.artifactType !== CHARACTER_ANIMATION_ARTIFACT_TYPE
  ) {
    return { applied: false, reason: "unsupported_character_artifact" };
  }
  if (animationRuntimeState.sessionId && animationRuntimeState.sessionId !== sessionId) {
    return { applied: false, reason: "session_mismatch" };
  }
  return null;
}

function parseEnvelopeArtifact(envelope) {
  const assetResult = safeParseAnimationAssets(envelope?.payload?.data?.assets);
  if (!assetResult.success)
    return { error: { applied: false, reason: "invalid_animation_assets" } };
  const result = safeParseAnimationProtocol(envelope?.payload?.data?.protocol);
  if (!result.success) return { error: { applied: false, reason: "invalid_animation_protocol" } };
  const protocol = result.data;
  if (String(envelope?.payload?.artifactId || "").trim() !== protocol.animationId) {
    return {
      error: { applied: false, reason: "artifact_id_mismatch", animationId: protocol.animationId },
    };
  }
  return { protocol, assets: assetResult.data };
}

function applyAnimationCard(envelope, protocol, assets) {
  let card = animationRuntimeState.cards.find(
    (candidate) => candidate.animationId === protocol.animationId,
  );
  const eventId = String(envelope?.identity?.eventId || "").trim();
  if (!eventId)
    return { applied: false, reason: "missing_event_id", animationId: protocol.animationId };
  if (card?.eventIds.includes(eventId)) {
    return { applied: false, reason: "duplicate_event", animationId: protocol.animationId };
  }
  const currentArtifact = card
    ? {
        revision: card.revision,
        pluginId: CHARACTER_PLUGIN_ID,
        artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
        artifactId: protocol.animationId,
        data: { protocol: card.protocol, assets: card.assets },
      }
    : null;
  const reduced = reducePluginArtifact(currentArtifact, envelope);
  if (!reduced.applied)
    return { applied: false, reason: reduced.reason, animationId: protocol.animationId };
  const eventRevision = reduced.artifact.revision;
  if (!card) {
    card = reactive({
      animationId: protocol.animationId,
      protocol: null,
      eventIds: [],
      assets: [],
      revision: 0,
    });
  }
  const created = !animationRuntimeState.cards.includes(card);
  card.eventIds.push(eventId);
  card.assets = assets;
  card.protocol = protocol;
  card.revision = eventRevision;
  if (!animationRuntimeState.cards.includes(card)) animationRuntimeState.cards.push(card);
  animationRuntimeState.revision += 1;
  return {
    applied: true,
    created,
    animationId: protocol.animationId,
    cardRevision: card.revision,
    revision: animationRuntimeState.revision,
  };
}

export function applyAnimationRuntimeEvent(envelope = {}) {
  const sessionId = String(envelope?.identity?.sessionId || "").trim();
  const rejection = rejectEnvelope(envelope, sessionId);
  if (rejection) return rejection;
  if (!animationRuntimeState.sessionId) animationRuntimeState.sessionId = sessionId;
  const parsed = parseEnvelopeArtifact(envelope);
  if (parsed.error) return parsed.error;
  const result = applyAnimationCard(envelope, parsed.protocol, parsed.assets);
  return result;
}
