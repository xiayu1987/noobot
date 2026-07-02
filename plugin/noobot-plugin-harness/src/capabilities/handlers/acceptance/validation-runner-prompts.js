/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_I18N_KEYSET,
  LOCALE,
  buildCapabilityProtocolModelMessages,
  getDefaultTaskOwner,
  translateI18nText,
} from "./deps.js";
import { appendMessage } from "../../../core/message-store.js";
import {
  buildAllPhaseAcceptanceReportSystemContents,
  buildAllSummaryReportSystemContents,
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  buildWorkflowResponsibilityConstraintUserPrompt,
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
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";

export function buildTextAcceptanceValidationResult(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  return {
    status: "pass",
    consistent: true,
    protocol: "text_patch",
    content: raw,
  };
}

function isSummaryRelayMessage(message = {}) {
  const injectedType = String(
    message?.injectedMessageType ||
      message?.injected_message_type ||
      message?.lc_kwargs?.injectedMessageType ||
      message?.lc_kwargs?.injected_message_type ||
      "",
  ).trim();
  if (injectedType === "separate_model_relay:summary") return true;
  const content = String(message?.content ?? message?.lc_kwargs?.content ?? "").trim();
  const relayPrefixes = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) =>
      translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
        purpose: "summary",
      }),
    )
    .filter(Boolean);
  return content.startsWith("[harness:summary]") ||
    relayPrefixes.some((prefix) => content.startsWith(prefix)) ||
    /^\[from harness external model output\/summary\]/i.test(content);
}

export function filterHistoricalSummaryRelayMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter((message) => !isSummaryRelayMessage(message));
}

export function resolveAcceptanceMainPlanContext(
  promptPayload = {},
  bucket = {},
  locale = LOCALE.ZH_CN,
  ctx = {},
) {
  const finalMainPlan =
    promptPayload?.finalMainPlan && typeof promptPayload.finalMainPlan === "object"
      ? promptPayload.finalMainPlan
      : {};
  const checklistFromFinalMainPlan = Array.isArray(finalMainPlan?.taskChecklist)
    ? finalMainPlan.taskChecklist
    : [];
  const checklistFromPayload = Array.isArray(promptPayload?.finalPlanChecklist)
    ? promptPayload.finalPlanChecklist
    : [];
  const mainPlanVersion = Number.isFinite(Number(finalMainPlan?.mainPlanVersion))
    ? Number(finalMainPlan.mainPlanVersion)
    : Number.isFinite(Number(bucket?.currentMainPlanVersion))
      ? Number(bucket.currentMainPlanVersion)
      : Number.isFinite(Number(bucket?.mainPlanVersion))
        ? Number(bucket.mainPlanVersion)
        : 1;
  const taskOwner =
    String(finalMainPlan?.taskOwner || bucket?.taskOwner || getDefaultTaskOwner(locale)).trim() ||
    getDefaultTaskOwner(locale);
  const totalGoal = String(finalMainPlan?.totalGoal || bucket?.totalGoal || "").trim();
  const nextPhase =
    (finalMainPlan?.nextPhase && typeof finalMainPlan.nextPhase === "object"
      ? finalMainPlan.nextPhase
      : bucket?.nextPhase && typeof bucket.nextPhase === "object"
        ? bucket.nextPhase
        : null) || null;
  return {
    mainPlanVersion,
    totalGoal,
    taskOwner,
    nextPhase,
    taskChecklist:
      checklistFromFinalMainPlan.length
        ? checklistFromFinalMainPlan
        : checklistFromPayload.length
          ? checklistFromPayload
          : Array.isArray(bucket?.taskChecklist)
            ? bucket.taskChecklist
            : [],
    planText: String(promptPayload?.planText || "").trim(),
    currentTaskGoal: resolveCurrentTaskGoalText({
      ctx,
      bucket,
      currentTaskGoal: promptPayload?.currentTaskGoal || "",
    }),
    plansInOrder: Array.isArray(promptPayload?.plansInOrder) ? promptPayload.plansInOrder : [],
    refinementPlansForFinalMainPlan: Array.isArray(promptPayload?.refinementPlansForFinalMainPlan)
      ? promptPayload.refinementPlansForFinalMainPlan
      : [],
  };
}

export function resolveAcceptanceValidationRequestPayload(promptPayload = {}) {
  const source = promptPayload && typeof promptPayload === "object" ? promptPayload : {};
  return {
    expectedSchema: source.expectedSchema || {},
    acceptanceReport: source.acceptanceReport || null,
    toolSignals: source.toolSignals || {},
    finalOutput: String(source.finalOutput || "").trim(),
  };
}

export function buildFinalAcceptanceSemanticValidationMessages({
  locale = LOCALE.ZH_CN,
  planContextContent = "",
  phaseReportsContents = [],
  requestContent = "",
  workflowPolicyPrompt = "",
  programmingMode = false,
  textMode = false,
  dynamicPolicyPrompt = "",
} = {}) {
  const hasRequest = String(requestContent || "").trim();
  return buildCapabilityProtocolModelMessages({
    locale,
    contextMessages: [
      planContextContent,
      ...(Array.isArray(phaseReportsContents) ? phaseReportsContents : []),
    ],
    protocolPrompt: requestContent,
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

export function appendPhaseAcceptanceReport(bucket = {}, content = "", { planText = "" } = {}) {
  if (!bucket || typeof bucket !== "object") return null;
  if (!Array.isArray(bucket.phaseAcceptanceReports)) bucket.phaseAcceptanceReports = [];
  const report = {
    type: "phase",
    acceptedAt: new Date().toISOString(),
    planText: String(planText || bucket?.planText || "").trim(),
    content: String(content || "").trim(),
  };
  bucket.phaseAcceptanceReports.push(report);
  applyPhaseAcceptanceReportToPlanStatus(bucket, report);
  if (bucket.phaseAcceptanceReports.length > 50) {
    bucket.phaseAcceptanceReports.splice(0, bucket.phaseAcceptanceReports.length - 50);
  }
  bucket.lastPhaseAcceptanceReport = report;
  return report;
}

export function buildFinalOutputFallbackPhaseAcceptanceText(locale = LOCALE.ZH_CN, bucket = {}, state = {}) {
  const checklistCount = Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist.length : 0;
  const signalCount = Number(state?.signals?.successfulToolCount || 0);
  return translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_VALIDATION.PHASE_FINAL_OUTPUT_FALLBACK, {
    checklistCount,
    successfulToolCount: signalCount,
  });
}

function isSystemLikeRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "system" || normalized === "developer";
}

export function pushRoleMessage(ctx = {}, messages = [], role = "system", content = "") {
  const normalizedContent = String(content || "").trim();
  if (!Array.isArray(messages) || !normalizedContent) return false;
  const requestedRole = String(role || "system").trim().toLowerCase();
  const normalizedRole = requestedRole === "user" ? "user" : requestedRole || "system";
  appendMessage(
    ctx,
    buildHarnessInjectedMessage(normalizedContent, {
      role: normalizedRole,
      injectedMessageType: "acceptance_prompt",
    }),
    { block: isSystemLikeRole(normalizedRole) ? "system" : "incremental" },
  );
  return true;
}

export function buildAcceptancePromptParts({
  bucket = {},
  state = {},
  locale = LOCALE.ZH_CN,
  requestPayload = {},
  phase = false,
  ctx = {},
  meta = {},
  includeWorkflowPolicy = true,
} = {}) {
  const mainPlanContext = resolveAcceptanceMainPlanContext(
    {
      planText: String(bucket?.planText || "").trim(),
      finalPlanChecklist: Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist : [],
      currentTaskGoal: resolveCurrentTaskGoalText({ ctx, bucket }),
    },
    bucket,
    locale,
    ctx,
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
  const {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  } = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const requestContent = phase
    ? buildPhaseAcceptanceRequestPromptText({
        locale,
        marker: getPhaseAcceptanceRequestMarker(locale),
        data: { requestPayload },
        programmingMode,
        textMode,
        dynamicPolicyPrompt,
        includeWorkflowPolicy,
      })
    : buildAcceptanceValidationRequestPromptText({
        locale,
        marker: getAcceptanceSemanticValidationMarker(locale),
        data: { requestPayload },
        programmingMode,
        textMode,
        dynamicPolicyPrompt,
        includeWorkflowPolicy,
      });
  void state;
  return { planContextContent, summaryReportsContents, phaseReportsContents, requestContent };
}

export function buildPhaseAcceptanceMessages({
  locale = LOCALE.ZH_CN,
  agentMessages = [],
  summaryReportsContents = [],
  planContextContent = "",
  phaseReportsContents = [],
  requestContent = "",
  workflowPolicyPrompt = "",
  programmingMode = false,
  textMode = false,
  dynamicPolicyPrompt = "",
} = {}) {
  const hasRequest = String(requestContent || "").trim();
  return buildCapabilityProtocolModelMessages({
    locale,
    agentMessages,
    contextMessages: [
      ...(Array.isArray(summaryReportsContents) ? summaryReportsContents : []),
      planContextContent,
      ...(Array.isArray(phaseReportsContents) ? phaseReportsContents : []),
    ],
    protocolPrompt: requestContent,
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

