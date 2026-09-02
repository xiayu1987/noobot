/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import CharacterAnimationAssets from "./components/CharacterAnimationAssets.vue";
import CharacterSessionArtifacts from "./components/CharacterSessionArtifacts.vue";
import {
  animationRuntimeState,
  applyAnimationRuntimeEvent,
  resetAnimationRuntimeState,
} from "./runtime/animationState.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { CHARACTER_ANIMATION_ARTIFACT_TYPE, CHARACTER_PLUGIN_ID } from "../src/contract.js";
import { configureImportedAssetStore } from "./runtime/importedAssetStore.js";
import { useCharacterLocale } from "./i18n/index.js";

export function routeCharacterRuntimeEvent({ envelope, descriptor, context } = {}) {
  if (
    descriptor?.family === EVENT_FAMILY.PLUGIN_ARTIFACT &&
    envelope?.payload?.pluginId === CHARACTER_PLUGIN_ID &&
    envelope?.payload?.artifactType === CHARACTER_ANIMATION_ARTIFACT_TYPE
  ) {
    const eventSessionId = String(envelope?.identity?.sessionId || "").trim();
    const activeSessionId = String(context?.sessionId || "").trim();
    // The live stream carries the authoritative session identity. Establish
    // the plugin projection boundary before applying its first event so a
    // session switch cannot reject that event while detail hydration is still
    // pending. A different active session remains ineligible.
    if (activeSessionId && eventSessionId && activeSessionId !== eventSessionId) return false;
    if (eventSessionId && animationRuntimeState.sessionId !== eventSessionId) {
      resetAnimationRuntimeState(eventSessionId);
    }
    return applyAnimationRuntimeEvent(envelope).applied === true;
  }
  return false;
}

function hydrateCharacterSessionArtifacts({ mainSessionDoc = {}, sessionItem = {} } = {}) {
  const sessionId = String(mainSessionDoc?.sessionId || sessionItem?.sessionId || "").trim();
  if (!sessionId) return 0;
  if (animationRuntimeState.sessionId !== sessionId) resetAnimationRuntimeState(sessionId);
  const events = Array.isArray(mainSessionDoc?.sessionArtifactEvents)
    ? [...mainSessionDoc.sessionArtifactEvents].sort(
        (left, right) =>
          Number(left?.ordering?.sequence || 0) - Number(right?.ordering?.sequence || 0),
      )
    : [];
  return events.reduce(
    (count, envelope) =>
      count +
      Number(
        String(envelope?.identity?.sessionId || "").trim() === sessionId &&
          applyAnimationRuntimeEvent(envelope).applied === true,
      ),
    0,
  );
}

export async function activate(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const pluginId = String(ctx?.pluginMeta?.pluginId || "").trim();
  if (typeof contribute !== "function" || !points) {
    throw new Error("frontend contribution API is required");
  }
  if (!pluginId) throw new Error("frontend plugin identity is required");
  configureImportedAssetStore({ request: ctx?.services?.authenticatedRequest?.request });
  const { translate } = useCharacterLocale();
  const resolveAssetProps = (context = {}, mode) => ({
    pluginModelConfig: context?.pluginModelConfig?.[pluginId] || {},
    updatePluginModelConfig: (next = {}) => context?.updatePluginModelConfig?.(pluginId, next),
    connected: context?.connected === true,
    mode,
  });
  contribute(points.RUNTIME_STREAM_ROUTE, {
    id: "character-animation-projector",
    priority: 15,
    when: ({ envelope, descriptor } = {}) =>
      descriptor?.family === EVENT_FAMILY.PLUGIN_ARTIFACT &&
      envelope?.payload?.pluginId === pluginId &&
      envelope?.payload?.artifactType === CHARACTER_ANIMATION_ARTIFACT_TYPE,
    provide: () => [routeCharacterRuntimeEvent],
  });
  contribute(points.SESSION_DETAIL_HYDRATOR, {
    id: "character-session-artifact-hydrator",
    provide: () => [hydrateCharacterSessionArtifacts],
  });
  contribute(points.SESSION_ARTIFACT_PANEL, {
    id: "character-session-artifacts",
    resolveTitle: () => translate("character.animationArtifact"),
    when: ({ sessionId } = {}) => {
      const projectedSessionId = animationRuntimeState.sessionId;
      const artifactCount = animationRuntimeState.cards.length;
      return Boolean(sessionId && projectedSessionId === sessionId && artifactCount > 0);
    },
    component: CharacterSessionArtifacts,
    resolveProps: ({ sessionId } = {}) => ({ sessionId }),
  });
  contribute(points.COMPOSER_MORE_ACTIONS, {
    id: "character-more-actions",
    resolveTitle: () => translate("character.select"),
    capability: "character.animation.assets",
    component: CharacterAnimationAssets,
    resolveProps: (context = {}) => resolveAssetProps(context, "select"),
  });
  contribute(points.RIGHT_TOOL_PANEL, {
    id: "character-right-panel",
    resolveTitle: () => translate("character.feature"),
    capability: "character.animation.assets",
    component: CharacterAnimationAssets,
    resolveProps: (context = {}) => resolveAssetProps(context, "manage"),
  });
  // Expose a capability service for host panels and app integrations. The
  // character state is a feature projection, not a chat message.
  return createPluginActivationResult({
    pluginId: "character",
    surface: PLUGIN_SURFACE.FRONTEND,
  });
}
