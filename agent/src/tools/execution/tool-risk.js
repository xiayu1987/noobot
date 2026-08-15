/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  SECURITY_EVIDENCE_SOURCE,
  SECURITY_RISK_LEVEL,
  createSecurityAssessment,
  normalizeSecurityRiskLevel,
  raiseSecurityAssessment,
  shouldRequireSecurityConfirmation,
} from "@noobot/security-assessment-protocol";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tTool } from "../core/tool-i18n.js";

const toolRiskAssessmentStorage = new AsyncLocalStorage();

export function createToolRiskAssessment(call = {}) {
  return {
    current: createSecurityAssessment({
      toolName: call?.name,
      args: call?.args && typeof call.args === "object" ? call.args : {},
    }),
  };
}

export function getToolRiskLevel(assessment) {
  return normalizeSecurityRiskLevel(
    assessment?.current?.effectiveRiskLevel,
    SECURITY_RISK_LEVEL.LOW,
  );
}

export function runWithToolRiskAssessment(assessment, operation) {
  return toolRiskAssessmentStorage.run(assessment, operation);
}

function assessToolOperation({ toolName, declaredRiskLevel, serverEvidence }) {
  const activeAssessment = toolRiskAssessmentStorage.getStore();
  const assessment =
    activeAssessment ||
    createToolRiskAssessment({ name: toolName, args: { riskLevel: declaredRiskLevel } });
  if (assessment.current.toolName !== String(toolName || "").trim()) {
    throw new TypeError("security assessment toolName does not match the active tool call");
  }
  if (
    !serverEvidence ||
    serverEvidence.source === SECURITY_EVIDENCE_SOURCE.MODEL_DECLARATION ||
    serverEvidence.source === SECURITY_EVIDENCE_SOURCE.TOOL_PROFILE
  ) {
    throw new TypeError("tool operation requires one server-owned security evidence item");
  }
  assessment.current = raiseSecurityAssessment(assessment.current, serverEvidence);
  return assessment;
}

export function createRiskLevelSchema(runtimeOrContext, descriptionKey) {
  return z
    .enum(Object.values(SECURITY_RISK_LEVEL))
    .describe(tTool(runtimeOrContext, descriptionKey));
}

function confirmationContent(
  runtime,
  { toolName, operation, target = "", reason = "", riskLevel = "" },
) {
  const formatTarget = (value) => {
    if (Array.isArray(value)) return value.map(formatTarget).filter(Boolean).join(", ");
    if (!value || typeof value !== "object") return String(value || "").trim();
    if (value.view === "attachment" && value.identity) {
      const identity = value.identity;
      return `attachment:${String(identity.sessionId || "").trim()}/${String(identity.attachmentSource || "").trim()}/${String(identity.attachmentId || "").trim()}`;
    }
    if (value.view && value.path) return String(value.path).trim();
    if (value.path) {
      const pathText = formatTarget(value.path);
      return [String(value.action || "").trim(), pathText].filter(Boolean).join(": ");
    }
    return "";
  };
  return tTool(runtime, "tools.risk.criticalConfirmation", {
    toolName,
    operation,
    target: formatTarget(target),
    reason,
    riskLevel,
  });
}

export async function confirmToolOperation({
  runtime,
  declaredRiskLevel,
  serverEvidence,
  toolName,
  operation,
  target = "",
  reason = "",
}) {
  const effectiveRiskLevel = getToolRiskLevel(
    assessToolOperation({ toolName, declaredRiskLevel, serverEvidence }),
  );
  const config = runtime?.systemRuntime?.config || {};
  if (
    !shouldRequireSecurityConfirmation({
      enabled: config.safeConfirm,
      confirmationLevel: config.safeConfirmLevel,
      riskLevel: effectiveRiskLevel,
    })
  )
    return;
  const bridge = runtime?.userInteractionBridge || null;
  if (!bridge?.requestUserInteraction) {
    throw recoverableToolError(tTool(runtime, "tools.risk.criticalConfirmationUnavailable"), {
      code: ERROR_CODE.RECOVERABLE_USER_INTERACTION_BRIDGE_MISSING,
    });
  }
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const result = await bridge.requestUserInteraction({
    content: confirmationContent(runtime, {
      toolName,
      operation,
      target,
      reason,
      riskLevel: effectiveRiskLevel,
    }),
    fields: [],
    dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
    requireEncryption: false,
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    toolName,
    lifecycle: "pending",
    ackMode: "manual",
    resolvedBy: "",
  });
  if (result?.confirmed !== true) {
    throw recoverableToolError(tTool(runtime, "tools.risk.criticalCancelled"), {
      code: ERROR_CODE.RECOVERABLE_USER_CANCELLED,
      details: { confirmed: false, cancelled: true },
    });
  }
}
