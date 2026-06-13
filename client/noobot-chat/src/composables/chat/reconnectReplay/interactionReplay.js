/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils";

export function getInteractionPayloadWaitKey({ sessionId = "", dialogProcessId = "" } = {}) {
  return `${_trimStr(sessionId)}::${_trimStr(dialogProcessId)}`;
}


export function clearMissingInteractionPayloadTimer(
  missingInteractionPayloadTimers,
  { sessionId = "", dialogProcessId = "" } = {},
) {
  const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
  const timer = missingInteractionPayloadTimers?.get?.(key);
  if (!timer) return;
  clearTimeout(timer);
  missingInteractionPayloadTimers.delete(key);
}

export function hasPendingInteractionForDialog(pendingInteractionRequest, dialogProcessId = "") {
  const pendingRequest =
    pendingInteractionRequest?.value && typeof pendingInteractionRequest.value === "object"
      ? pendingInteractionRequest.value
      : null;
  if (!pendingRequest) return false;
  const pendingDialogProcessId = _trimStr(pendingRequest?.dialogProcessId);
  const normalizedDialogProcessId = _trimStr(dialogProcessId);
  return (
    !normalizedDialogProcessId ||
    !pendingDialogProcessId ||
    pendingDialogProcessId === normalizedDialogProcessId
  );
}

export function normalizePendingInteractionPayloads(stateData = {}) {
  const pendingInteractions = Array.isArray(stateData?.pendingInteractions)
    ? stateData.pendingInteractions
    : [];
  if (pendingInteractions.length) {
    return pendingInteractions.filter(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
  }
  return stateData?.pendingInteraction &&
    typeof stateData.pendingInteraction === "object" &&
    !Array.isArray(stateData.pendingInteraction)
    ? [stateData.pendingInteraction]
    : [];
}

export function applyReconnectInteractionRequest({
  eventData,
  missingInteractionPayloadTimers,
  normalizeInteractionRequestPayload,
  clearMissingInteractionPayloadTimer: clearTimer = clearMissingInteractionPayloadTimer,
  tryAutoResolveInteraction,
  isInteractionRequestHandled,
  setPendingInteractionRequest,
} = {}) {
  const interactionRequest = normalizeInteractionRequestPayload?.(eventData) || eventData || {};
  clearTimer?.(missingInteractionPayloadTimers, {
    sessionId: _trimStr(interactionRequest?.sessionId),
    dialogProcessId: _trimStr(interactionRequest?.dialogProcessId),
  });
  if (tryAutoResolveInteraction?.(interactionRequest)) return interactionRequest;
  if (!isInteractionRequestHandled?.(interactionRequest)) {
    setPendingInteractionRequest?.(interactionRequest);
  }
  return interactionRequest;
}
