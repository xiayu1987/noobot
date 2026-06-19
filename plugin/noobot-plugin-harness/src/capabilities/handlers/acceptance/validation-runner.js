/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  buildCapabilityModelMessages,
  buildCapabilityProtocolModelMessages,
  ensureHarnessBucket,
  extractRawTextContent,
  invokeWithReasoningRetry,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  resolvePlanningGuidanceMode,
  getDefaultTaskOwner,
  translateI18nText,
} from "./deps.js";
import {
  captureInjectedResult,
  scheduleInjectTask,
} from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  applySemanticAcceptanceToReport,
  buildSemanticValidationPromptPayload,
} from "./report-builder.js";
import {
  buildAllPhaseAcceptanceReportSystemContents,
  buildAllSummaryReportSystemContents,
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildPhaseAcceptanceRequestPromptText,
  buildScenarioPolicyPromptText,
  resolveScenarioPolicyFlagsFromContext,
  getAllPhaseAcceptanceReportsMarker,
  getAllSummaryReportsMarker,
  getAcceptanceMainPlanContextMarker,
  getAcceptanceSemanticValidationMarker,
  getPhaseAcceptanceRequestMarker,
} from "../shared/workflow/prompts.js";
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";
import { buildHarnessInjectedMessage } from "../shared/message/injected-message-utils.js";
import { applyPhaseAcceptanceReportToPlanStatus } from "../shared/plan/acceptance-status.js";
import { resolveCurrentTaskGoalText } from "../shared/plan/checklist-context.js";
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

function buildTextAcceptanceValidationResult(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  return {
    status: "pass",
    consistent: true,
    protocol: "text_patch",
    content: raw,
  };
}

function resolveAcceptanceMainPlanContext(
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

function resolveAcceptanceValidationRequestPayload(promptPayload = {}) {
  const source = promptPayload && typeof promptPayload === "object" ? promptPayload : {};
  return {
    expectedSchema: source.expectedSchema || {},
    acceptanceReport: source.acceptanceReport || null,
    toolSignals: source.toolSignals || {},
    finalOutput: String(source.finalOutput || "").trim(),
  };
}

function buildFinalAcceptanceSemanticValidationMessages({
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

function buildPhaseAcceptanceRequestPayload({ bucket = {}, state = {} } = {}) {
  return {
    acceptanceType: "phase",
    phaseIndex: Array.isArray(bucket?.phaseAcceptanceReports)
      ? bucket.phaseAcceptanceReports.length + 1
      : 1,
    toolSignals: state?.signals || {},
  };
}

function appendPhaseAcceptanceReport(bucket = {}, content = "", { planText = "" } = {}) {
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

function buildFinalOutputFallbackPhaseAcceptanceText(locale = LOCALE.ZH_CN, bucket = {}, state = {}) {
  const checklistCount = Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist.length : 0;
  const signalCount = Number(state?.signals?.successfulToolCount || 0);
  return translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_VALIDATION.PHASE_FINAL_OUTPUT_FALLBACK, {
    checklistCount,
    successfulToolCount: signalCount,
  });
}

function pushRoleMessage(messages = [], role = "system", content = "") {
  const normalizedContent = String(content || "").trim();
  if (!Array.isArray(messages) || !normalizedContent) return false;
  // Inject-mode phase acceptance prompts are current-turn dynamic guidance for
  // the main model. Keep them in the non-system/incremental segment so stable
  // system + history prefixes remain provider-cache friendly.
  messages.push(
    buildHarnessInjectedMessage(normalizedContent, {
      role: "user",
      injectedMessageType: "acceptance_prompt",
    }),
  );
  void role;
  return true;
}

function buildAcceptancePromptParts({
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

function buildPhaseAcceptanceMessages({
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

export function maybeInjectPhaseAcceptancePrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.pending.phaseAcceptance !== true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  } = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const { summaryReportsContents, planContextContent, phaseReportsContents, requestContent } = buildAcceptancePromptParts({
    bucket,
    state,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
    ctx,
    meta,
  });
  for (const content of summaryReportsContents) {
    pushRoleMessage(messages, "system", content);
  }
  pushRoleMessage(messages, "system", planContextContent);
  for (const content of phaseReportsContents) {
    pushRoleMessage(messages, "system", content);
  }
  pushRoleMessage(messages, "user", requestContent);
  pushRoleMessage(
    messages,
    "user",
    buildWorkflowResponsibilityConstraintUserPrompt(locale, "phase_acceptance", {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
  );
  setPendingStateWithMeta(state, "phaseAcceptance", false);
  setCaptureFlagStateWithMeta(state, "phaseAcceptanceCapturePending", true);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.phaseAcceptancePromptInjected,
  });
  return true;
}

export function maybeCapturePhaseAcceptanceByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    completedEvent: ACCEPTANCE_EVENTS.phaseAcceptanceCompletedInject,
    failedEvent: ACCEPTANCE_EVENTS.phaseAcceptanceCaptureFailedInject,
    isCapturePending: ({ state }) => state.flags.phaseAcceptanceCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      setCaptureFlagStateWithMeta(state, "phaseAcceptanceCapturePending", false);
      return {};
    },
    applyCaptureResult: ({ bucket, responseText, state }) => {
      const text = String(responseText || "").trim();
      if (!text) return { applied: false, detail: { reason: "empty_phase_acceptance_output" } };
      const report = appendPhaseAcceptanceReport(bucket, text);
      if (report && state?.flags && typeof state.flags === "object") {
        state.flags.phaseAcceptanceTriggeredThisTurn = true;
      }
      return {
        applied: Boolean(report),
        detail: { phaseAcceptanceCount: Array.isArray(bucket.phaseAcceptanceReports) ? bucket.phaseAcceptanceReports.length : 0 },
      };
    },
  });
}

export async function runPhaseAcceptanceBySeparateModel(
  ctx = {},
  meta = {},
  { forceRun = false } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const shouldRunFromPending = state.pending.phaseAcceptance === true;
  const shouldRun = forceRun === true || shouldRunFromPending;
  if (!shouldRun) return false;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    return forceRun === true ? false : maybeInjectPhaseAcceptancePrompt(ctx, meta);
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const { summaryReportsContents, planContextContent, phaseReportsContents, requestContent } = buildAcceptancePromptParts({
    bucket,
    state,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
    ctx,
    meta,
    includeWorkflowPolicy: false,
  });
  const agentMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "phase_acceptance",
  });
  if (shouldRunFromPending) {
    setPendingStateWithMeta(state, "phaseAcceptance", false);
  }
  let response = null;
  try {
    response = await invokeWithReasoningRetry({
      invoker,
      invokePayload: {
        purpose: "phase_acceptance",
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        model: resolveCapabilityModelName(meta, {
          purpose: "phase_acceptance",
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        }),
        locale,
        prompt: "",
        messages: buildPhaseAcceptanceMessages({
          locale,
          agentMessages: buildCapabilityModelMessages({
            locale,
            agentMessages,
            constraints: [],
            task: "",
          }),
          summaryReportsContents,
          planContextContent,
          phaseReportsContents,
          requestContent,
          workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, resolveScenarioPolicyFlagsFromContext(ctx, meta)),
          ...resolveScenarioPolicyFlagsFromContext(ctx, meta),
        }),
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "phase_acceptance"),
      },
      maxReasoningRetries: 1,
      purpose: "phase_acceptance",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
          purpose: "phase_acceptance",
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  if (!responseText) return false;
  appendPhaseAcceptanceReport(bucket, responseText);
  if (state?.flags && typeof state.flags === "object") {
    state.flags.phaseAcceptanceTriggeredThisTurn = true;
  }
  const attachmentMetas = await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "phase_acceptance",
    content: responseText,
    generationSource: "harness_phase_acceptance",
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "phase_acceptance",
    content: responseText,
    dedupe: true,
    attachmentMetas,
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.phaseAcceptanceCompleted,
    detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
  });
  return true;
}

export async function ensurePhaseAcceptanceBeforeFinalAcceptance(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state?.flags?.phaseAcceptanceTriggeredThisTurn === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceSkippedBeforeFinalOutputSameTurn,
      detail: {
        reason: "phase_acceptance_already_triggered_this_turn",
        phaseAcceptanceCount: Array.isArray(bucket?.phaseAcceptanceReports)
          ? bucket.phaseAcceptanceReports.length
          : 0,
      },
    });
    return false;
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const requestPayload = buildPhaseAcceptanceRequestPayload({ bucket, state });
  const { summaryReportsContents, planContextContent, phaseReportsContents, requestContent } = buildAcceptancePromptParts({
    bucket,
    state,
    locale,
    phase: true,
    requestPayload,
    ctx,
    meta,
    includeWorkflowPolicy: false,
  });
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    const fallbackText = buildFinalOutputFallbackPhaseAcceptanceText(locale, bucket, state);
    const report = appendPhaseAcceptanceReport(bucket, fallbackText);
    if (!report) return false;
    if (state?.flags && typeof state.flags === "object") {
      state.flags.phaseAcceptanceTriggeredThisTurn = true;
    }
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceGeneratedBeforeFinalOutputFallback,
      detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
    });
    return true;
  }
  let response = null;
  try {
    response = await invokeWithReasoningRetry({
      invoker,
      invokePayload: {
        purpose: "phase_acceptance_before_final",
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        model: resolveCapabilityModelName(meta, {
          purpose: "phase_acceptance_before_final",
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        }),
        locale,
        prompt: "",
        messages: buildPhaseAcceptanceMessages({
          locale,
          agentMessages: buildCapabilityModelMessages({
            locale,
            agentMessages: resolveCapabilityModelMessages(meta, {
              ctx,
              purpose: "phase_acceptance_before_final",
            }),
            constraints: [],
            task: "",
          }),
          summaryReportsContents,
          planContextContent,
          phaseReportsContents,
          requestContent,
          workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, resolveScenarioPolicyFlagsFromContext(ctx, meta)),
          ...resolveScenarioPolicyFlagsFromContext(ctx, meta),
        }),
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "phase_acceptance_before_final"),
      },
      maxReasoningRetries: 1,
      purpose: "phase_acceptance_before_final",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
          purpose: "phase_acceptance_before_final",
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceBeforeFinalFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  const reportText = responseText || buildFinalOutputFallbackPhaseAcceptanceText(locale, bucket, state);
  const report = appendPhaseAcceptanceReport(bucket, reportText);
  if (!report) return false;
  if (state?.flags && typeof state.flags === "object") {
    state.flags.phaseAcceptanceTriggeredThisTurn = true;
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.phaseAcceptanceGeneratedBeforeFinalOutput,
    detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
  });
  return true;
}

export function scheduleAcceptanceSemanticValidationByInject(ctx = {}, baseReport = null) {
  if (!baseReport) return false;
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    scheduledEvent: ACCEPTANCE_EVENTS.semanticValidationScheduledByInject,
    setPendingData: ({ bucket, state }) => {
      const locale = state?.locale || LOCALE.ZH_CN;
      const finalOutput = String(ctx?.result?.output || "").trim();
      const reportIndex = Array.isArray(bucket.acceptanceReports)
        ? bucket.acceptanceReports.lastIndexOf(baseReport)
        : -1;
      setPendingStateWithMeta(state, "acceptanceSemanticValidation", {
        reportIndex,
        payload: buildSemanticValidationPromptPayload({
          bucket,
          state,
          baseReport,
          finalOutput,
          locale,
        }),
      });
      return { reportIndex, hasFinalOutput: Boolean(finalOutput) };
    },
    buildScheduledDetail: ({ result }) => ({
      reportIndex: Number(result?.reportIndex ?? -1),
      hasFinalOutput: result?.hasFinalOutput === true,
    }),
  });
}

export function maybeInjectAcceptanceSemanticValidationPrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const pendingData =
    state.pending.acceptanceSemanticValidation &&
    typeof state.pending.acceptanceSemanticValidation === "object"
      ? state.pending.acceptanceSemanticValidation
      : null;
  if (!pendingData) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  } = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const promptPayload = pendingData.payload && typeof pendingData.payload === "object" ? pendingData.payload : {};
  const mainPlanContext = resolveAcceptanceMainPlanContext(promptPayload, bucket, locale, ctx);
  const requestPayload = resolveAcceptanceValidationRequestPayload(promptPayload);
  const systemContent = buildAcceptanceMainPlanContextPromptText({
    locale,
    marker: getAcceptanceMainPlanContextMarker(locale),
    data: { mainPlanContext },
  });
  const phaseReportsContents = buildAllPhaseAcceptanceReportSystemContents({
    locale,
    marker: getAllPhaseAcceptanceReportsMarker(locale),
    data: { phaseAcceptanceReports: bucket?.phaseAcceptanceReports || [] },
  });
  const requestContent = buildAcceptanceValidationRequestPromptText({
    locale,
    marker: getAcceptanceSemanticValidationMarker(locale),
    data: { requestPayload },
    programmingMode,
    textMode,
  });
  const systemInjection = injectMessageWithPolicy(ctx, {
    role: "system",
    content: systemContent,
    injectedMessageType: "acceptance_main_plan_context",
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: false,
  });
  if (!systemInjection.injected) return false;
  for (const content of phaseReportsContents) {
    injectMessageWithPolicy(ctx, {
      role: "system",
      content,
      injectedMessageType: "acceptance_phase_report",
      injectAt: "append",
      dedupe: false,
      avoidBreakToolCallContinuity: false,
    });
  }
  const userInjection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: requestContent,
    injectedMessageType: "acceptance_semantic_validation_request",
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: false,
  });
  if (!userInjection.injected) return false;
  injectMessageWithPolicy(ctx, {
    role: "user",
    content: buildWorkflowResponsibilityConstraintUserPrompt(locale, "final_acceptance", {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
    injectedMessageType: "acceptance_responsibility_constraint",
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: false,
  });
  setPendingStateWithMeta(state, "acceptanceSemanticValidation", null);
  setCaptureFlagStateWithMeta(state, "acceptanceSemanticValidationCapturePending", true);
  state.flags.acceptanceSemanticValidationCaptureReportIndex = Number(pendingData.reportIndex);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.semanticValidationPromptInjected,
  });
  return true;
}

export function maybeCaptureAcceptanceSemanticValidationByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    completedEvent: ACCEPTANCE_EVENTS.semanticValidationCompletedInject,
    failedEvent: ACCEPTANCE_EVENTS.semanticValidationCaptureFailedInject,
    isCapturePending: ({ state }) => state.flags.acceptanceSemanticValidationCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      const reportIndex = Number(state.flags.acceptanceSemanticValidationCaptureReportIndex);
      setCaptureFlagStateWithMeta(state, "acceptanceSemanticValidationCapturePending", false);
      return { reportIndex };
    },
    applyCaptureResult: ({ bucket, responseText, captureMeta }) => {
      const reportIndex = Number(captureMeta?.reportIndex);
      const targetReport =
        (Array.isArray(bucket.acceptanceReports) && reportIndex >= 0
          ? bucket.acceptanceReports[reportIndex]
          : null) ||
        bucket.lastAcceptanceReport ||
        null;
      if (!targetReport || typeof targetReport !== "object") {
        return { applied: false, detail: { reportIndex, reason: "missing_target_report" } };
      }
      const parsed = buildTextAcceptanceValidationResult(responseText);
      if (!parsed) {
        return { applied: false, detail: { reportIndex, reason: "empty_validation_output" } };
      }
      targetReport.semanticValidation = parsed;
      applySemanticAcceptanceToReport(targetReport);
      bucket.lastAcceptanceReport = targetReport;
      return {
        applied: true,
        detail: {
          reportIndex,
          status: targetReport.semanticValidation?.status,
          consistent: targetReport.semanticValidation?.consistent,
        },
      };
    },
    buildCompletedDetail: ({ result }) => result?.detail || {},
    buildFailedDetail: ({ result, captureMeta }) => result?.detail || { reportIndex: Number(captureMeta?.reportIndex) },
  });
}

export async function runAcceptanceBySeparateModel(ctx = {}, meta = {}, baseReport = null) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !baseReport) return false;
  const { bucket, state } = holder;
  const acceptanceOptions = meta?.harness?.acceptance && typeof meta.harness.acceptance === "object"
    ? meta.harness.acceptance
    : {};
  const semanticValidationEnabled = acceptanceOptions.semanticValidation === undefined
    ? WORKFLOW_PARAMS.acceptance.semanticValidation.enabled === true
    : acceptanceOptions.semanticValidation === true;
  if (!semanticValidationEnabled) return false;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    if (resolvePlanningGuidanceMode(meta) === "inject") {
      return scheduleAcceptanceSemanticValidationByInject(ctx, baseReport);
    }
    return false;
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const finalOutput = String(ctx?.result?.output || "").trim();
  const promptPayload = buildSemanticValidationPromptPayload({
    bucket,
    state,
    baseReport,
    finalOutput,
    locale,
  });
  const mainPlanContext = resolveAcceptanceMainPlanContext(promptPayload, bucket, locale, ctx);
  const requestPayload = resolveAcceptanceValidationRequestPayload(promptPayload);
  const prompt = buildAcceptanceValidationRequestPromptText({
    locale,
    marker: getAcceptanceSemanticValidationMarker(locale),
    data: {
      requestPayload,
    },
    ...resolveScenarioPolicyFlagsFromContext(ctx, meta),
    includeWorkflowPolicy: false,
  });
  const mainPlanContextPrompt = buildAcceptanceMainPlanContextPromptText({
    locale,
    marker: getAcceptanceMainPlanContextMarker(locale),
    data: { mainPlanContext },
  });
  const phaseReportsPrompts = buildAllPhaseAcceptanceReportSystemContents({
    locale,
    marker: getAllPhaseAcceptanceReportsMarker(locale),
    data: { phaseAcceptanceReports: bucket?.phaseAcceptanceReports || [] },
  });
  const semanticValidationMessages = buildFinalAcceptanceSemanticValidationMessages({
    locale,
    planContextContent: mainPlanContextPrompt,
    phaseReportsContents: phaseReportsPrompts,
    requestContent: prompt,
    workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, resolveScenarioPolicyFlagsFromContext(ctx, meta)),
    ...resolveScenarioPolicyFlagsFromContext(ctx, meta),
  });
  let response = null;
  try {
    response = await invokeWithReasoningRetry({
      invoker,
      invokePayload: {
        purpose: "acceptance_semantic_validation",
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        model: resolveCapabilityModelName(meta, {
          purpose: "acceptance_semantic_validation",
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        }),
        locale,
        prompt: "",
        messages: semanticValidationMessages,
        ctx,
        baseReport,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "acceptance_semantic_validation"),
      },
      maxReasoningRetries: 1,
      purpose: "acceptance_semantic_validation",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.ACCEPTANCE,
          purpose: "acceptance_semantic_validation",
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.semanticValidationFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  const attachmentMetas = await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "acceptance_semantic_validation",
    content: responseText,
    generationSource: "harness_acceptance_semantic_validation",
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "acceptance_semantic_validation",
    content: responseText,
    dedupe: true,
    attachmentMetas,
  });
  const parsed = buildTextAcceptanceValidationResult(responseText);
  if (!parsed) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.semanticValidationEmptyOutput,
    });
    return false;
  }
  baseReport.semanticValidation = parsed;
  applySemanticAcceptanceToReport(baseReport);
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.semanticValidationCompleted,
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}
