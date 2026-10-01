/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const pendingInteractionRegistry = new Map();

function text(value = "") {
  return String(value || "").trim();
}

export function registerPendingInteraction(requestItem = {}) {
  const requestId = text(requestItem.requestId);
  if (!requestId || !text(requestItem.ownerUserId)) {
    throw new Error("pending interaction requires requestId and ownerUserId");
  }
  pendingInteractionRegistry.set(requestId, requestItem);
  return requestItem;
}

export function unregisterPendingInteraction(requestItem = {}) {
  const requestId = text(requestItem.requestId);
  if (pendingInteractionRegistry.get(requestId) !== requestItem) return false;
  pendingInteractionRegistry.delete(requestId);
  return true;
}

export function findPendingInteraction({ requestId = "", ownerUserId = "" } = {}) {
  const requestItem = pendingInteractionRegistry.get(text(requestId));
  if (!requestItem) return null;
  return text(requestItem.ownerUserId) === text(ownerUserId) ? requestItem : null;
}

export function rejectPendingInteractionsForTurn(
  { ownerUserId = "", sessionId = "", turnScopeId = "" } = {},
  error,
) {
  const target = [text(ownerUserId), text(sessionId), text(turnScopeId)];
  if (target.some((part) => !part)) return 0;
  let rejected = 0;
  for (const requestItem of [...pendingInteractionRegistry.values()]) {
    const owner = [
      text(requestItem.ownerUserId),
      text(requestItem.sessionId),
      text(requestItem.turnScopeId),
    ];
    if (owner.some((part, index) => part !== target[index])) continue;
    requestItem.reject?.(error);
    rejected += 1;
  }
  return rejected;
}
