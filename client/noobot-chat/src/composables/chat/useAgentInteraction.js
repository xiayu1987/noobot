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
  const { t } = useLocale();
  const chatStore = useChatStore();
  const { pendingInteractionRequest, interactionSubmitting } = storeToRefs(chatStore);

  function clearPendingInteraction() {
    pendingInteractionRequest.value = null;
  }

  function setPendingInteractionRequest(request = {}) {
    pendingInteractionRequest.value =
      request && typeof request === "object" ? request : null;
  }

  function submitInteractionResponse(response = {}, requestOverride = null) {
    const request =
      requestOverride && typeof requestOverride === "object"
        ? requestOverride
        : pendingInteractionRequest.value;
    if (!request?.requestId) {
      throw new Error(t("infra.interactionChannelUnavailable"));
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
    if (!requestOverride) {
      pendingInteractionRequest.value = null;
    }
    interactionSubmitting.value = false;
  }

  return {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    setPendingInteractionRequest,
    submitInteractionResponse,
  };
}
