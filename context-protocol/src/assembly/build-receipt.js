/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONTEXT_BUILD_STATUS = Object.freeze({
  BUILDING: "building",
  READY: "ready",
  FAILED: "failed",
});

export function createContextBuildReceipt({
  scope = {},
  mode = "",
  sourceRevision = "",
  policyFingerprint = "",
  startedAt = "",
  completedAt = "",
  status = CONTEXT_BUILD_STATUS.READY,
  messageCount = 0,
  error = null,
} = {}) {
  const receipt = {
    protocolVersion: 1,
    scope,
    mode: String(mode || "").trim(),
    sourceRevision: String(sourceRevision || "").trim(),
    policyFingerprint: String(policyFingerprint || "").trim(),
    startedAt: String(startedAt || "").trim(),
    completedAt: String(completedAt || "").trim(),
    status: String(status || "").trim(),
    messageCount: Number.isFinite(Number(messageCount)) ? Number(messageCount) : 0,
    ...(error
      ? {
          error: { name: String(error?.name || "Error"), message: String(error?.message || error) },
        }
      : {}),
  };
  if (
    ![
      CONTEXT_BUILD_STATUS.BUILDING,
      CONTEXT_BUILD_STATUS.READY,
      CONTEXT_BUILD_STATUS.FAILED,
    ].includes(receipt.status)
  ) {
    throw new TypeError(`invalid context build status: ${receipt.status}`);
  }
  if (!receipt.scope?.sessionId || !receipt.scope?.dialogProcessId || !receipt.scope?.turnScopeId) {
    throw new TypeError("context build receipt requires a complete context scope");
  }
  if (receipt.status === CONTEXT_BUILD_STATUS.FAILED && !receipt.error) {
    throw new TypeError("failed context build receipt requires error");
  }
  return Object.freeze(receipt);
}
