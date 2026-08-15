/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TOOL_EXECUTION_VIEW } from "@noobot/execution-isolation-protocol/execution-views";

export const SECURITY_ASSESSMENT_PROTOCOL_NAME = "noobot.security-assessment";
export const SECURITY_ASSESSMENT_PROTOCOL_VERSION = 1;

export const SECURITY_RISK_LEVEL = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

export const SECURITY_RISK_LEVELS = Object.freeze([
  SECURITY_RISK_LEVEL.LOW,
  SECURITY_RISK_LEVEL.MEDIUM,
  SECURITY_RISK_LEVEL.HIGH,
  SECURITY_RISK_LEVEL.CRITICAL,
]);

export const SECURITY_EVIDENCE_SOURCE = Object.freeze({
  MODEL_DECLARATION: "model_declaration",
  TOOL_PROFILE: "tool_profile",
  EXECUTION_VIEW: "execution_view",
  NORMALIZED_RESOURCE: "normalized_resource",
});

export const RESOURCE_OPERATION = Object.freeze({
  READ: "read",
  SEARCH: "search",
  WRITE: "write",
  PATCH: "patch",
  DELETE: "delete",
});

export const RESOURCE_SCOPE = Object.freeze({
  WORKSPACE: "workspace",
  HOST: "host",
});

const RISK_ORDER = Object.freeze(
  Object.fromEntries(SECURITY_RISK_LEVELS.map((riskLevel, index) => [riskLevel, index])),
);
const CONFIRMATION_MINIMUM_RISK = Object.freeze({
  low: 3,
  medium: 2,
  high: 1,
  critical: 0,
});

const TOOL_BASELINE_PROFILES = Object.freeze({
  write_file: SECURITY_RISK_LEVEL.MEDIUM,
  patch_file: SECURITY_RISK_LEVEL.MEDIUM,
  execute_script: SECURITY_RISK_LEVEL.MEDIUM,
  execute_native_script: SECURITY_RISK_LEVEL.MEDIUM,
});

const text = (value) => String(value || "").trim();

export function normalizeSecurityRiskLevel(value, fallback = "") {
  const normalized = text(value).toLowerCase();
  return Object.hasOwn(RISK_ORDER, normalized) ? normalized : fallback;
}

export function securityRiskRank(value) {
  const normalized = normalizeSecurityRiskLevel(value);
  return normalized ? RISK_ORDER[normalized] : -1;
}

export function maxSecurityRiskLevel(...values) {
  return values.reduce((highest, value) => {
    const normalized = normalizeSecurityRiskLevel(value);
    if (!normalized) return highest;
    return !highest || securityRiskRank(normalized) > securityRiskRank(highest)
      ? normalized
      : highest;
  }, SECURITY_RISK_LEVEL.LOW);
}

export function classifyToolCallBaselineRisk({ toolName = "", args = {} } = {}) {
  const name = text(toolName);
  if (name === "patch_file" && args?.dryRun === true) return SECURITY_RISK_LEVEL.LOW;
  return TOOL_BASELINE_PROFILES[name] || SECURITY_RISK_LEVEL.LOW;
}

export function classifyToolExecutionRisk({ toolName = "", executionView = "" } = {}) {
  const name = text(toolName);
  const view = text(executionView);
  if (name === "execute_script") {
    return view === TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED
      ? SECURITY_RISK_LEVEL.CRITICAL
      : SECURITY_RISK_LEVEL.MEDIUM;
  }
  return classifyToolCallBaselineRisk({ toolName: name });
}

export function classifyResourceRisk({ operation = "read", scope = "workspace" } = {}) {
  const normalizedOperation = text(operation).toLowerCase();
  const hostResource = text(scope).toLowerCase() === RESOURCE_SCOPE.HOST;
  if (normalizedOperation === RESOURCE_OPERATION.DELETE) {
    return hostResource ? SECURITY_RISK_LEVEL.CRITICAL : SECURITY_RISK_LEVEL.HIGH;
  }
  if (
    normalizedOperation === RESOURCE_OPERATION.WRITE ||
    normalizedOperation === RESOURCE_OPERATION.PATCH
  ) {
    return hostResource ? SECURITY_RISK_LEVEL.CRITICAL : SECURITY_RISK_LEVEL.MEDIUM;
  }
  return hostResource ? SECURITY_RISK_LEVEL.HIGH : SECURITY_RISK_LEVEL.LOW;
}

function normalizeEvidence(evidence = {}) {
  const source = text(evidence?.source);
  const riskLevel = normalizeSecurityRiskLevel(evidence?.riskLevel);
  if (!Object.values(SECURITY_EVIDENCE_SOURCE).includes(source)) {
    throw new TypeError(`unsupported security evidence source: ${source || "<empty>"}`);
  }
  if (!riskLevel) throw new TypeError("security evidence riskLevel is required");
  return Object.freeze({ source, riskLevel });
}

function buildAssessment({ toolName = "", evidence = [] } = {}) {
  const normalizedEvidence = Object.freeze(evidence.map(normalizeEvidence));
  if (new Set(normalizedEvidence.map((item) => item.source)).size !== normalizedEvidence.length) {
    throw new TypeError("security assessment evidence sources must be unique");
  }
  return Object.freeze({
    protocol: SECURITY_ASSESSMENT_PROTOCOL_NAME,
    version: SECURITY_ASSESSMENT_PROTOCOL_VERSION,
    toolName: text(toolName),
    evidence: normalizedEvidence,
    effectiveRiskLevel: maxSecurityRiskLevel(...normalizedEvidence.map((item) => item.riskLevel)),
  });
}

export function validateSecurityAssessment(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_assessment"]) });
  }
  if (value.protocol !== SECURITY_ASSESSMENT_PROTOCOL_NAME) errors.push("protocol_mismatch");
  if (value.version !== SECURITY_ASSESSMENT_PROTOCOL_VERSION) errors.push("version_mismatch");
  if (!text(value.toolName)) errors.push("missing_tool_name");
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    errors.push("missing_evidence");
  } else {
    for (const evidence of value.evidence) {
      if (!Object.values(SECURITY_EVIDENCE_SOURCE).includes(text(evidence?.source))) {
        errors.push("invalid_evidence_source");
      }
      if (!normalizeSecurityRiskLevel(evidence?.riskLevel)) {
        errors.push("invalid_evidence_risk");
      }
    }
    if (new Set(value.evidence.map((item) => text(item?.source))).size !== value.evidence.length) {
      errors.push("duplicate_evidence_source");
    }
  }
  const expectedRisk = Array.isArray(value.evidence)
    ? maxSecurityRiskLevel(...value.evidence.map((item) => item?.riskLevel))
    : "";
  if (!normalizeSecurityRiskLevel(value.effectiveRiskLevel)) {
    errors.push("invalid_effective_risk");
  } else if (expectedRisk && value.effectiveRiskLevel !== expectedRisk) {
    errors.push("effective_risk_mismatch");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertSecurityAssessment(value) {
  const validation = validateSecurityAssessment(value);
  if (!validation.valid) {
    throw new TypeError(`invalid security assessment: ${validation.errors.join(",")}`);
  }
  return value;
}

export function createSecurityAssessment({ toolName = "", args = {} } = {}) {
  return buildAssessment({
    toolName,
    evidence: [
      {
        source: SECURITY_EVIDENCE_SOURCE.MODEL_DECLARATION,
        riskLevel: normalizeSecurityRiskLevel(args?.riskLevel, SECURITY_RISK_LEVEL.LOW),
      },
      {
        source: SECURITY_EVIDENCE_SOURCE.TOOL_PROFILE,
        riskLevel: classifyToolCallBaselineRisk({ toolName, args }),
      },
    ],
  });
}

export function raiseSecurityAssessment(assessment, evidence) {
  assertSecurityAssessment(assessment);
  return buildAssessment({
    toolName: assessment.toolName,
    evidence: [...assessment.evidence, evidence],
  });
}

export function shouldRequireSecurityConfirmation({
  enabled = true,
  confirmationLevel = "low",
  riskLevel,
} = {}) {
  if (enabled === false) return false;
  const normalizedRisk = normalizeSecurityRiskLevel(riskLevel);
  if (!normalizedRisk) return false;
  const normalizedConfirmation = normalizeSecurityRiskLevel(
    confirmationLevel,
    SECURITY_RISK_LEVEL.LOW,
  );
  return securityRiskRank(normalizedRisk) >= CONFIRMATION_MINIMUM_RISK[normalizedConfirmation];
}
