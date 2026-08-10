/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storeToRefs } from "pinia";
import { watch } from "vue";
import { useChatStore } from "../stores/useChatStore.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { createInteractionResponseCommand } from "@noobot/agent-transport-protocol";
import { logThinkingReplayDebug } from "../../debug/loggers/thinkingReplayDebugLogger.js";

export function useAgentInteraction({
  encryptPayloadBySessionId,
  sendJson,
} = {}) {
  const { translate } = useLocale();
  const chatStore = useChatStore();
  const {
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    activeSessionId,
  } = storeToRefs(chatStore);
  const handledInteractionRequestIds = new Set();
  const handledInteractionRequestSignatures = new Set();

  function normalizeRequestId(requestId = "") {
    return String(requestId || "").trim();
  }

  function buildInteractionRequestSignature(request = {}) {
    if (!request || typeof request !== "object") return "";
    return [
      request?.sessionId,
      request?.dialogProcessId,
      request?.interactionType,
      request?.toolName,
      request?.connectorType,
      request?.connectorName,
      request?.content,
    ]
      .map((item) => String(item || "").trim())
      .join("|");
  }

  function hasUsableSignature(signature = "") {
    return Boolean(String(signature || "").replaceAll("|", ""));
  }

  function getInteractionRequestKey(request = {}) {
    if (!request || typeof request !== "object") return "";
    const normalizedRequestId = normalizeRequestId(request?.requestId || "");
    if (normalizedRequestId) return `id:${normalizedRequestId}`;
    const signature = buildInteractionRequestSignature(request);
    return hasUsableSignature(signature) ? `sig:${signature}` : "";
  }

  function findPendingInteractionIndex(requestOrId = "") {
    const normalizedRequestId =
      requestOrId && typeof requestOrId === "object"
        ? normalizeRequestId(requestOrId?.requestId || "")
        : normalizeRequestId(requestOrId || "");
    const targetSignature =
      requestOrId && typeof requestOrId === "object"
        ? buildInteractionRequestSignature(requestOrId)
        : "";
    return pendingInteractionRequests.value.findIndex((requestItem) => {
      if (!requestItem || typeof requestItem !== "object") return false;
      const requestItemId = normalizeRequestId(requestItem?.requestId || "");
      if (normalizedRequestId && requestItemId === normalizedRequestId) return true;
      if (normalizedRequestId) return false;
      if (!hasUsableSignature(targetSignature)) return false;
      return buildInteractionRequestSignature(requestItem) === targetSignature;
    });
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
    const currentSessionId = String(activeSessionId.value || "").trim();
    // During initial connection the authoritative request can arrive before
    // the active session identity is committed. Keep the queued protocol
    // record visible until that identity is available; the watcher below
    // then narrows it to the exact session.
    pendingInteractionRequest.value = currentSessionId
      ? queue.find((requestItem) => String(requestItem?.sessionId || "").trim() === currentSessionId) || null
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
      sessionId: String(activeSessionId.value || "").trim(),
      removed: beforeLength - pendingInteractionRequests.value.length,
      pendingCount: pendingInteractionRequests.value.length,
    });
    return pendingInteractionRequests.value.length !== beforeLength;
  }

  function markInteractionRequestHandled(requestOrId = "") {
    if (requestOrId && typeof requestOrId === "object") {
      const normalizedRequestId = normalizeRequestId(requestOrId?.requestId || "");
      if (normalizedRequestId) handledInteractionRequestIds.add(normalizedRequestId);
      const signature = buildInteractionRequestSignature(requestOrId);
      if (hasUsableSignature(signature)) {
        handledInteractionRequestSignatures.add(signature);
      }
      return;
    }
    const normalizedRequestId = normalizeRequestId(requestOrId);
    if (normalizedRequestId) handledInteractionRequestIds.add(normalizedRequestId);
  }

  function isInteractionRequestHandled(requestOrId = "") {
    if (requestOrId && typeof requestOrId === "object") {
      const normalizedRequestId = normalizeRequestId(requestOrId?.requestId || "");
      if (normalizedRequestId && handledInteractionRequestIds.has(normalizedRequestId)) return true;
      if (normalizedRequestId) return false;
      const signature = buildInteractionRequestSignature(requestOrId);
      return Boolean(hasUsableSignature(signature) && handledInteractionRequestSignatures.has(signature));
    }
    const normalizedRequestId = normalizeRequestId(requestOrId);
    return Boolean(normalizedRequestId && handledInteractionRequestIds.has(normalizedRequestId));
  }

  function clearPendingInteraction(requestOrId = null) {
    if (requestOrId) {
      const removed = removePendingInteraction((requestItem) => {
        if (!requestItem || typeof requestItem !== "object") return false;
        if (requestOrId && typeof requestOrId === "object") {
          return findPendingInteractionIndex(requestOrId) >= 0 &&
            getInteractionRequestKey(requestItem) === getInteractionRequestKey(requestOrId);
        }
        return normalizeRequestId(requestItem?.requestId || "") === normalizeRequestId(requestOrId);
      });
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
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedRequestId = normalizeRequestId(requestId || "");
    const removed = removePendingInteraction((requestItem) => {
      if (!requestItem || typeof requestItem !== "object") return false;
      const pendingRequestId = normalizeRequestId(requestItem?.requestId || "");
      if (normalizedRequestId) return pendingRequestId === normalizedRequestId;
      const pendingSessionId = String(requestItem?.sessionId || "").trim();
      const pendingDialogProcessId = String(requestItem?.dialogProcessId || "").trim();
      const pendingTurnScopeId = String(requestItem?.turnScopeId || "").trim();
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
      if (pendingTurnScopeId && normalizedTurnScopeId && pendingTurnScopeId !== normalizedTurnScopeId) {
        return false;
      }
      return true;
    });
    if (!removed) syncCurrentPendingInteraction();
    return removed;
  }

  function setPendingInteractionRequest(request = {}) {
    if (!request || typeof request !== "object") {
      clearPendingInteraction();
      return;
    }
    if (isInteractionRequestHandled(request)) return;
    logThinkingReplayDebug("frontend.interaction.requestMaterialization", {
      sessionId: String(request?.sessionId || "").trim(),
      dialogProcessId: String(request?.dialogProcessId || "").trim(),
      turnScopeId: String(request?.turnScopeId || "").trim(),
      requestId: normalizeRequestId(request?.requestId),
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
    const sessionId = String(request?.sessionId || "").trim();
    const responsePayload =
      requireEncryption && sessionId
        ? {
            encrypted: true,
            payload: encryptPayloadBySessionId(response || {}, sessionId),
          }
        : response || {};
    try {
      sendJson(createInteractionResponseCommand({
        commandId: `interaction:${request.requestId}`,
        identity: {
          sessionId,
          dialogProcessId: request?.dialogProcessId,
          turnScopeId: request?.turnScopeId,
        },
        interaction: { requestId: request.requestId, response: responsePayload },
      }));
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
    markInteractionRequestHandled,
    isInteractionRequestHandled,
  };
}
