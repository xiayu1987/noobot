/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storeToRefs } from "pinia";
import { watch } from "vue";
import { useChatStore } from "../stores/useChatStore.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import {
  AGENT_COMMAND,
  createInteractionResponseCommand,
  selectAgentCommandIdentity,
} from "@noobot/agent-transport-protocol";
import { logThinkingReplayDebug } from "../../debug/loggers/thinkingReplayDebugLogger.js";
import { text, isObjectLike } from "@noobot/shared/value";

export function useAgentInteraction({ encryptPayloadBySessionId, sendJson } = {}) {
  const { translate } = useLocale();
  const chatStore = useChatStore();
  const {
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    activeSessionId,
  } = storeToRefs(chatStore);
  const handledInteractionRequestIds = new Set();

  function requestIdOf(requestOrId) {
    return isObjectLike(requestOrId) ? requestOrId.requestId : requestOrId;
  }

  function markInteractionRequestHandled(request) {
    handledInteractionRequestIds.add(request.requestId);
  }

  function findPendingInteractionIndex(requestOrId) {
    const requestId = requestIdOf(requestOrId);
    return pendingInteractionRequests.value.findIndex(
      (requestItem) => requestItem.requestId === requestId,
    );
  }

  function syncCurrentPendingInteraction() {
    const queue = Array.isArray(pendingInteractionRequests.value)
      ? pendingInteractionRequests.value.filter(
          (requestItem) => requestItem && typeof requestItem === "object",
        )
      : [];
    if (queue.length !== pendingInteractionRequests.value.length) {
      pendingInteractionRequests.value = queue;
    }
    const currentSessionId = text(activeSessionId.value);

    pendingInteractionRequest.value = currentSessionId
      ? queue.find((requestItem) => text(requestItem?.channelSessionId) === currentSessionId) ||
        null
      : queue[0] || null;
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
  }

  function removePendingInteraction(predicate = () => false) {
    const beforeLength = pendingInteractionRequests.value.length;
    pendingInteractionRequests.value = pendingInteractionRequests.value.filter(
      (requestItem) => !predicate(requestItem),
    );
    syncCurrentPendingInteraction();
    logThinkingReplayDebug("frontend.interaction.queueChanged", {
      sessionId: text(activeSessionId.value),
      removed: beforeLength - pendingInteractionRequests.value.length,
      pendingCount: pendingInteractionRequests.value.length,
    });
    return pendingInteractionRequests.value.length !== beforeLength;
  }

  function clearPendingInteraction(requestOrId = null) {
    if (requestOrId) {
      const requestId = requestIdOf(requestOrId);
      const removed = removePendingInteraction(
        (requestItem) => requestItem.requestId === requestId,
      );
      if (!removed) syncCurrentPendingInteraction();
      return removed;
    }
    pendingInteractionRequests.value = [];
    pendingInteractionRequest.value = null;
    interactionSubmitting.value = false;
    return true;
  }

  function clearPendingInteractionIfObsolete({
    sessionId = "",
    dialogProcessId = "",
    turnScopeId = "",
    requestId = "",
  } = {}) {
    const normalizedSessionId = text(sessionId);
    const normalizedDialogProcessId = text(dialogProcessId);
    const normalizedTurnScopeId = text(turnScopeId);
    const normalizedRequestId = text(requestId);
    const removed = removePendingInteraction((requestItem) => {
      if (!isObjectLike(requestItem)) return false;
      if (normalizedRequestId) return requestItem.requestId === normalizedRequestId;
      const pendingSessionId = text(requestItem?.sessionId);
      const pendingDialogProcessId = text(requestItem?.dialogProcessId);
      const pendingTurnScopeId = text(requestItem?.turnScopeId);
      if (pendingSessionId && normalizedSessionId && pendingSessionId !== normalizedSessionId) {
        return false;
      }
      if (
        pendingDialogProcessId &&
        normalizedDialogProcessId &&
        pendingDialogProcessId !== normalizedDialogProcessId
      ) {
        return false;
      }
      if (
        pendingTurnScopeId &&
        normalizedTurnScopeId &&
        pendingTurnScopeId !== normalizedTurnScopeId
      ) {
        return false;
      }
      return true;
    });
    if (!removed) syncCurrentPendingInteraction();
    return removed;
  }

  function setPendingInteractionRequest(request = {}) {
    if (!isObjectLike(request)) {
      clearPendingInteraction();
      return;
    }
    if (handledInteractionRequestIds.has(request.requestId)) return;
    logThinkingReplayDebug("frontend.interaction.requestMaterialization", {
      sessionId: text(request?.sessionId),
      channelSessionId: text(request?.channelSessionId),
      dialogProcessId: text(request?.dialogProcessId),
      turnScopeId: text(request?.turnScopeId),
      requestId: request.requestId,
      source: "authoritative-replay-or-stream",
    });
    const existingIndex = findPendingInteractionIndex(request);
    if (existingIndex >= 0) {
      const nextQueue = [...pendingInteractionRequests.value];
      nextQueue[existingIndex] = { ...nextQueue[existingIndex], ...request };
      pendingInteractionRequests.value = nextQueue;
      syncCurrentPendingInteraction();
      return;
    }
    pendingInteractionRequests.value = [...pendingInteractionRequests.value, request];
    syncCurrentPendingInteraction();
  }

  function submitInteractionResponse(response = {}, requestOverride = null) {
    const request =
      requestOverride && typeof requestOverride === "object"
        ? requestOverride
        : pendingInteractionRequest.value;
    if (!request?.requestId) {
      throw new Error(translate("infra.interactionChannelUnavailable"));
    }
    interactionSubmitting.value = true;
    const requireEncryption = request?.requireEncryption === true;
    const sessionId = text(request?.sessionId);
    const responsePayload =
      requireEncryption && sessionId
        ? {
            encrypted: true,
            payload: encryptPayloadBySessionId(response || {}, sessionId),
          }
        : response || {};
    try {
      sendJson(
        createInteractionResponseCommand({
          identity: selectAgentCommandIdentity(AGENT_COMMAND.INTERACTION_RESPONSE, request),
          interaction: { requestId: request.requestId, response: responsePayload },
        }),
      );
    } catch (error) {
      interactionSubmitting.value = false;
      throw error;
    }
    markInteractionRequestHandled(request);
    clearPendingInteraction(request);
    interactionSubmitting.value = false;
  }

  watch(activeSessionId, syncCurrentPendingInteraction);

  return {
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
  };
}
