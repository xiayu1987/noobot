/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTerminalInteraction } from "../interactionPayload.js";

export function applyReconnectInteractionRequest({
  eventData,
  channelSessionId,
  normalizeInteractionRequestPayload,
  tryAutoResolveInteraction,
  isInteractionRequestHandled,
  setPendingInteractionRequest,
  clearPendingInteraction,
} = {}) {
  const interactionRequest =
    normalizeInteractionRequestPayload?.(eventData, { channelSessionId }) || eventData || {};
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
