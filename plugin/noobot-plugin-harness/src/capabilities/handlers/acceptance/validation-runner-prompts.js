/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_I18N_KEYSET,
  LOCALE,
  buildCapabilityProtocolModelMessages,
  translateI18nText,
} from "./deps.js";
import { appendMessage } from "../../../core/message-store.js";
import { isSystemLikeMessageRole } from "@noobot/context-protocol/policy/message";
import { readContextMessageField } from "@noobot/context-protocol/message/codec";
import {
  buildAllPhaseAcceptanceReportSystemContents,
  buildAllSummaryReportSystemContents,
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildAcceptancePatchProtocolText,
  buildPhaseAcceptanceRequestPromptText,
  resolveScenarioPolicyFlagsFromContext,
  getAllPhaseAcceptanceReportsMarker,
  getAllSummaryReportsMarker,
  getAcceptanceMainPlanContextMarker,
  getAcceptanceSemanticValidationMarker,
  getPhaseAcceptanceRequestMarker,
} from "../shared/workflow/prompts.js";
import { buildHarnessInjectedMessage } from "../shared/message/injected-message-utils.js";
import { applyPhaseAcceptanceReportToPlanStatus } from "../shared/plan/acceptance-status.js";
import { resolveCurrentTaskGoalText } from "../shared/plan/checklist-context.js";
import { parseMainPlansFromPlanText } from "../shared/plan/text-protocol.js";
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";
import { text } from "@noobot/shared/value";

export function buildTextAcceptanceValidationResult(sourceText = "") {
  const raw = text(sourceText);
  if (!raw) return null;
  return {
    status: "pass",
    consistent: true,
    protocol: "text_patch",
    content: raw,
  };
}

function isSummaryRelayMessage(message = {}) {
  const injectedType = readContextMessageField(message, "injectedMessageType");
  if (injectedType === "separate_model_relay:summary") return true;
  const content = text(message?.content ?? message?.lc_kwargs?.content);
  const relayPrefixes = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) =>
      translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
        purpose: "summary",
      }),
    )
    .filter(Boolean);
  return (
    content.startsWith("[harness:summary]") ||
    relayPrefixes.some((prefix) => content.startsWith(prefix)) ||
    /^\[from harness external model output\/summary\]/i.test(content)
  );
}

export function filterHistoricalSummaryRelayMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !isSummaryRelayMessage(message),
  );
}

export function resolveAcceptanceMainPlanContext(promptPayload = {}, bucket = {}) {
  return {
    planText: text(promptPayload?.planText),
    currentTaskGoal: resolveCurrentTaskGoalText({ bucket }),
  };
}

export function resolveAcceptanceValidationRequestPayload(promptPayload = {}) {
  const source = promptPayload && typeof promptPayload === "object" ? promptPayload : {};
  return {
    expectedSchema: source.expectedSchema || {},
    acceptanceState: source.acceptanceState || null,
    toolSignals: source.toolSignals || {},
    finalOutput: text(source.finalOutput),
  };
}

export function buildFinalAcceptanceSemanticValidationMessages({
  locale = LOCALE.ZH_CN,
  planContextContent = "",
  phaseReportsContents = [],
  requestContent = "",
  protocolContent = "",
  workflowPolicyPrompt = "",
  programmingMode = false,
  textMode = false,
  dynamicPolicyPrompt = "",
} = {}) {
  const hasRequest = text(requestContent);
  return buildCapabilityProtocolModelMessages({
    locale,
    contextMessages: [
      planContextContent,
      ...(Array.isArray(phaseReportsContents) ? phaseReportsContents : []),
      requestContent,
    ],
    protocolPrompt: protocolContent || buildAcceptancePatchProtocolText({ locale, mode: "final" }),
    workflowPolicyPrompt: hasRequest ? workflowPolicyPrompt : "",
    responsibilityPrompt: hasRequest
      ? buildWorkflowResponsibilityConstraintUserPrompt(locale, "final_acceptance", {
          programmingMode,
          textMode,
          dynamicPolicyPrompt,
          includeWorkflowPolicy: false,
        })
      : "",
  });
}

export function buildPhaseAcceptanceRequestPayload({ bucket = {}, state = {} } = {}) {
  return {
    acceptanceType: "phase",
    phaseIndex: Array.isArray(bucket?.phaseAcceptanceReports)
      ? bucket.phaseAcceptanceReports.length + 1
      : 1,
    toolSignals: state?.signals || {},
  };
}

export function appendPhaseAcceptanceReport(bucket = {}, content = "") {
  if (!bucket || typeof bucket !== "object") return null;
  if (!Array.isArray(bucket.phaseAcceptanceReports)) bucket.phaseAcceptanceReports = [];
  const report = {
    type: "phase",
    acceptedAt: new Date().toISOString(),
    planText: text(bucket.planText),
    content: text(content),
  };
  bucket.phaseAcceptanceReports.push(report);
  applyPhaseAcceptanceReportToPlanStatus(bucket, report);
  if (bucket.phaseAcceptanceReports.length > 50) {
    bucket.phaseAcceptanceReports.splice(0, bucket.phaseAcceptanceReports.length - 50);
  }
  bucket.lastPhaseAcceptanceReport = report;
  return report;
}

export function buildFinalOutputFallbackPhaseAcceptanceText(
  locale = LOCALE.ZH_CN,
  bucket = {},
  state = {},
) {
  const checklistCount = parseMainPlansFromPlanText(bucket?.planText).length;
  const signalCount = Number(state?.signals?.successfulToolCount || 0);
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_VALIDATION.PHASE_FINAL_OUTPUT_FALLBACK,
    {
      checklistCount,
      successfulToolCount: signalCount,
    },
  );
}

export function pushRoleMessage(ctx = {}, messages = [], role = "system", content = "") {
  const normalizedContent = text(content);
  if (!Array.isArray(messages) || !normalizedContent) return false;
  const requestedRole = (text(role) || "system").toLowerCase();
  const normalizedRole = requestedRole === "user" ? "user" : requestedRole || "system";
  appendMessage(
    ctx,
    buildHarnessInjectedMessage(normalizedContent, {
      role: normalizedRole,
      injectedMessageType: "acceptance_prompt",
    }),
    { block: isSystemLikeMessageRole(normalizedRole) ? "system" : "incremental" },
  );
  return true;
}

export function buildAcceptancePromptParts({
  bucket = {},
  locale = LOCALE.ZH_CN,
  requestPayload = {},
  phase = false,
  ctx = {},
  meta = {},
  includeWorkflowPolicy = true,
} = {}) {
  const mainPlanContext = resolveAcceptanceMainPlanContext(
    { planText: text(bucket?.planText) },
    bucket,
  );
  const planContextContent = buildAcceptanceMainPlanContextPromptText({
    locale,
    marker: getAcceptanceMainPlanContextMarker(locale),
    data: { mainPlanContext },
  });
  const phaseReportsContents = buildAllPhaseAcceptanceReportSystemContents({
    locale,
    marker: getAllPhaseAcceptanceReportsMarker(locale),
    data: { phaseAcceptanceReports: bucket?.phaseAcceptanceReports || [] },
  });
  const summaryReportsContents = phase
    ? buildAllSummaryReportSystemContents({
        locale,
        marker: getAllSummaryReportsMarker(locale),
        data: { latestCompleteSummaryText: resolveLatestCompleteSummaryText({ bucket, ctx }) },
      })
    : [];
  const { programmingMode, textMode, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(
    ctx,
    meta,
  );
  const requestContent = phase
    ? buildPhaseAcceptanceRequestPromptText({
        locale,
        marker: getPhaseAcceptanceRequestMarker(locale),
        data: { requestPayload },
        programmingMode,
        textMode,
        dynamicPolicyPrompt,
        includeWorkflowPolicy,
        includeProtocol: false,
      })
    : buildAcceptanceValidationRequestPromptText({
        locale,
        marker: getAcceptanceSemanticValidationMarker(locale),
        data: { requestPayload },
        programmingMode,
        textMode,
        dynamicPolicyPrompt,
        includeWorkflowPolicy,
        includeProtocol: false,
      });
  return {
    planContextContent,
    summaryReportsContents,
    phaseReportsContents,
    requestContent,
    protocolContent: buildAcceptancePatchProtocolText({
      locale,
      mode: phase ? "phase" : "final",
    }),
  };
}

export function buildPhaseAcceptanceMessages({
  locale = LOCALE.ZH_CN,
  agentMessages = [],
  summaryReportsContents = [],
  planContextContent = "",
  phaseReportsContents = [],
  requestContent = "",
  protocolContent = "",
  workflowPolicyPrompt = "",
  programmingMode = false,
  textMode = false,
  dynamicPolicyPrompt = "",
} = {}) {
  const hasRequest = text(requestContent);
  return buildCapabilityProtocolModelMessages({
    locale,
    agentMessages,
    contextMessages: [
      ...(Array.isArray(summaryReportsContents) ? summaryReportsContents : []),
      planContextContent,
      ...(Array.isArray(phaseReportsContents) ? phaseReportsContents : []),
      requestContent,
    ],
    protocolPrompt: hasRequest ? protocolContent : "",
    workflowPolicyPrompt: hasRequest ? workflowPolicyPrompt : "",
    responsibilityPrompt: hasRequest
      ? buildWorkflowResponsibilityConstraintUserPrompt(locale, "phase_acceptance", {
          programmingMode,
          textMode,
          dynamicPolicyPrompt,
          includeWorkflowPolicy: false,
        })
      : "",
  });
}
