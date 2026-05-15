/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storeToRefs } from "pinia";
import { useChatStore } from "../../shared/stores/useChatStore";
import { useLocale } from "../../shared/i18n/useLocale";

export function useAgentInteraction({
  encryptPayloadBySessionId,
  sendJson,
} = {}) {
  const { translate } = useLocale();
  const chatStore = useChatStore();
  const { pendingInteractionRequest, interactionSubmitting } = storeToRefs(chatStore);
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

  function markInteractionRequestHandled(requestOrId = "") {
    if (requestOrId && typeof requestOrId === "object") {
      const normalizedRequestId = normalizeRequestId(requestOrId?.requestId || "");
      if (normalizedRequestId) handledInteractionRequestIds.add(normalizedRequestId);
      const signature = buildInteractionRequestSignature(requestOrId);
      if (signature.replaceAll("|", "")) {
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
      const signature = buildInteractionRequestSignature(requestOrId);
      return Boolean(signature.replaceAll("|", "") && handledInteractionRequestSignatures.has(signature));
    }
    const normalizedRequestId = normalizeRequestId(requestOrId);
    return Boolean(normalizedRequestId && handledInteractionRequestIds.has(normalizedRequestId));
  }

  function clearPendingInteraction() {
    pendingInteractionRequest.value = null;
  }

  function clearPendingInteractionIfObsolete({
    sessionId = "",
    dialogProcessId = "",
  } = {}) {
    const pendingRequest = pendingInteractionRequest.value;
    if (!pendingRequest || typeof pendingRequest !== "object") return false;
    const pendingSessionId = String(pendingRequest?.sessionId || "").trim();
    const pendingDialogProcessId = String(pendingRequest?.dialogProcessId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
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
    pendingInteractionRequest.value = null;
    interactionSubmitting.value = false;
    return true;
  }

  function setPendingInteractionRequest(request = {}) {
    if (!request || typeof request !== "object") {
      pendingInteractionRequest.value = null;
      return;
    }
    if (isInteractionRequestHandled(request)) return;
    pendingInteractionRequest.value = request;
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
    sendJson({
      action: "interaction_response",
      requestId: request.requestId,
      response: responsePayload,
    });
    markInteractionRequestHandled(request);
    if (!requestOverride) {
      pendingInteractionRequest.value = null;
    }
    interactionSubmitting.value = false;
  }

  return {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    markInteractionRequestHandled,
    isInteractionRequestHandled,
  };
}
