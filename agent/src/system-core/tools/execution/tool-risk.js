/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { ERROR_CODE } from "../../error/constants.js";
import { recoverableToolError } from "../../error/index.js";
import { tTool } from "../core/tool-i18n.js";

export const TOOL_RISK_LEVEL = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

export function createRiskLevelSchema(runtimeOrContext, descriptionKey) {
  return z.enum(Object.values(TOOL_RISK_LEVEL)).describe(tTool(runtimeOrContext, descriptionKey));
}

function confirmationContent(runtime, { toolName, operation, target = "", reason = "" }) {
  return tTool(runtime, "tools.risk.criticalConfirmation", {
    toolName,
    operation,
    target,
    reason,
  });
}

export async function confirmCriticalToolOperation({
  runtime,
  riskLevel,
  toolName,
  operation,
  target = "",
  reason = "",
}) {
  if (runtime?.systemRuntime?.config?.safeConfirm === false || riskLevel !== TOOL_RISK_LEVEL.CRITICAL) return;
  const bridge = runtime?.userInteractionBridge || null;
  if (!bridge?.requestUserInteraction) {
    throw recoverableToolError(
      tTool(runtime, "tools.risk.criticalConfirmationUnavailable"),
      { code: ERROR_CODE.RECOVERABLE_USER_INTERACTION_BRIDGE_MISSING },
    );
  }
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const result = await bridge.requestUserInteraction({
    content: confirmationContent(runtime, { toolName, operation, target, reason }),
    fields: [],
    dialogProcessId: resolveDialogProcessIdFromContext({ runtime }),
    requireEncryption: false,
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    toolName,
    lifecycle: "pending",
    ackMode: "manual",
    resolvedBy: "",
  });
  if (result?.confirmed !== true) {
    throw recoverableToolError(
      tTool(runtime, "tools.risk.criticalCancelled"),
      {
        code: ERROR_CODE.RECOVERABLE_USER_CANCELLED,
        details: { confirmed: false, cancelled: true },
      },
    );
  }
}
