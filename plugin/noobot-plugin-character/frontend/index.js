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

export function routeCharacterRuntimeEvent({ envelope, descriptor } = {}) {
  if (
    descriptor?.family === EVENT_FAMILY.PLUGIN_ARTIFACT &&
    envelope?.payload?.pluginId === CHARACTER_PLUGIN_ID &&
    envelope?.payload?.artifactType === CHARACTER_ANIMATION_ARTIFACT_TYPE
  )
    return applyAnimationRuntimeEvent(envelope).applied === true;
  return false;
}

function hydrateCharacterSessionArtifacts({ mainSessionDoc = {}, sessionItem = {} } = {}) {
  const sessionId = String(mainSessionDoc?.sessionId || sessionItem?.sessionId || "").trim();
  resetAnimationRuntimeState(sessionId);
  const events = Array.isArray(mainSessionDoc?.sessionArtifactEvents)
    ? mainSessionDoc.sessionArtifactEvents
    : [];
  return events.reduce(
    (count, envelope) => count + Number(applyAnimationRuntimeEvent(envelope).applied === true),
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
    when: ({ sessionId } = {}) =>
      Boolean(
        sessionId &&
        animationRuntimeState.sessionId === sessionId &&
        animationRuntimeState.cards.length,
      ),
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
