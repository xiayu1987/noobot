/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function tryAutoResolveReconnectInteraction({
  rawRequest = {},
  interactionSubmitting,
  normalizeInteractionRequestPayload,
  isAutoResolvedInteraction,
  clearPendingInteraction,
} = {}) {
  const request = normalizeInteractionRequestPayload?.(rawRequest || {}) || rawRequest || {};
  if (!isAutoResolvedInteraction?.(request)) return false;
  clearPendingInteraction?.(request);
  if (interactionSubmitting?.value !== undefined) {
    interactionSubmitting.value = false;
  }
  return true;
}
