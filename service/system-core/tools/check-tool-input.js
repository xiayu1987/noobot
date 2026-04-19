/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../error/index.js";

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

export async function assertValidParentSessionId({
  parentSessionId = "",
  agentContext = {},
  fieldName = "parentSessionId",
}) {
  const normalizedParentSessionId = String(parentSessionId || "").trim();
  if (!normalizedParentSessionId) {
    throw recoverableToolError(`${fieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: fieldName },
    });
  }
  if (!isUuid(normalizedParentSessionId)) {
    throw recoverableToolError(`invalid ${fieldName} format (UUID required)`, {
      code: "RECOVERABLE_INVALID_PARENT_SESSION_ID",
      details: { field: fieldName, value: normalizedParentSessionId },
    });
  }

  const runtime = agentContext?.runtime || {};
  const sessionManager = runtime?.sessionManager || null;
  const userId = String(
    agentContext?.userId || runtime?.userId || runtime?.systemRuntime?.userId || "",
  ).trim();
  if (!sessionManager || !userId) {
    throw recoverableToolError("session context missing", {
      code: "RECOVERABLE_SESSION_CONTEXT_MISSING",
      details: { hasSessionManager: Boolean(sessionManager), hasUserId: Boolean(userId) },
    });
  }

  const sessionTree = await sessionManager.getSessionTree({ userId });
  if (!sessionTree?.nodes?.[normalizedParentSessionId]) {
    throw recoverableToolError(
      `parent session not found: ${normalizedParentSessionId}`,
      {
        code: "RECOVERABLE_PARENT_SESSION_NOT_FOUND",
        details: { parentSessionId: normalizedParentSessionId },
      },
    );
  }
  return normalizedParentSessionId;
}

