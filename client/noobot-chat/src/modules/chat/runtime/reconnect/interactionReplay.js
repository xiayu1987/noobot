/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils.js";
import { isTerminalInteraction } from "../interactionPayload.js";

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

export function applyReconnectInteractionRequest({
  eventData,
  normalizeInteractionRequestPayload,
  tryAutoResolveInteraction,
  isInteractionRequestHandled,
  setPendingInteractionRequest,
  clearPendingInteraction,
} = {}) {
  const interactionRequest = normalizeInteractionRequestPayload?.(eventData) || eventData || {};
  if (tryAutoResolveInteraction?.(interactionRequest)) return interactionRequest;
  if (isTerminalInteraction(interactionRequest)) {
    clearPendingInteraction?.(interactionRequest);
    return interactionRequest;
  }
  if (!isInteractionRequestHandled?.(interactionRequest)) {
    setPendingInteractionRequest?.(interactionRequest);
  }
  return interactionRequest;
}
