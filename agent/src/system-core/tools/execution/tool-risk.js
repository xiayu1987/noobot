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

const TOOL_RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const CONFIRMATION_MINIMUM_RISK = Object.freeze({ low: 3, medium: 2, high: 1, critical: 0 });

export function normalizeSafeConfirmLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.hasOwn(TOOL_RISK_ORDER, normalized) ? normalized : TOOL_RISK_LEVEL.LOW;
}

export function shouldConfirmToolRisk({ safeConfirm = true, safeConfirmLevel = "low", riskLevel } = {}) {
  if (safeConfirm === false) return false;
  const normalizedRiskLevel = String(riskLevel || "").trim().toLowerCase();
  if (!Object.hasOwn(TOOL_RISK_ORDER, normalizedRiskLevel)) return false;
  return TOOL_RISK_ORDER[normalizedRiskLevel] >= CONFIRMATION_MINIMUM_RISK[normalizeSafeConfirmLevel(safeConfirmLevel)];
}

export function createRiskLevelSchema(runtimeOrContext, descriptionKey) {
  return z.enum(Object.values(TOOL_RISK_LEVEL)).describe(tTool(runtimeOrContext, descriptionKey));
}

function confirmationContent(runtime, { toolName, operation, target = "", reason = "", riskLevel = "" }) {
  return tTool(runtime, "tools.risk.criticalConfirmation", {
    toolName,
    operation,
    target,
    reason,
    riskLevel,
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
  const config = runtime?.systemRuntime?.config || {};
  if (!shouldConfirmToolRisk({ safeConfirm: config.safeConfirm, safeConfirmLevel: config.safeConfirmLevel, riskLevel })) return;
  const bridge = runtime?.userInteractionBridge || null;
  if (!bridge?.requestUserInteraction) {
    throw recoverableToolError(
      tTool(runtime, "tools.risk.criticalConfirmationUnavailable"),
      { code: ERROR_CODE.RECOVERABLE_USER_INTERACTION_BRIDGE_MISSING },
    );
  }
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const result = await bridge.requestUserInteraction({
    content: confirmationContent(runtime, { toolName, operation, target, reason, riskLevel }),
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
