/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  buildCapabilityModelMessages,
  ensureHarnessBucket,
  extractRawTextContent,
  invokeWithReasoningRetry,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsAttachmentMetas,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  resolvePlanningGuidanceMode,
  getDefaultTaskOwner,
} from "./deps.js";
import {
  captureInjectedResult,
  scheduleInjectTask,
} from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import { buildSemanticValidationPromptPayload } from "./report-builder.js";
import {
  buildAllPhaseAcceptanceReportSystemContents,
  buildAllSummaryReportSystemContents,
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  buildPhaseAcceptanceRequestPromptText,
  getAllPhaseAcceptanceReportsMarker,
  getAllSummaryReportsMarker,
  getAcceptanceMainPlanContextMarker,
  getAcceptanceSemanticValidationMarker,
  getPhaseAcceptanceRequestMarker,
} from "../shared/workflow/prompts.js";
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";

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
} = {}) {
  const messages = [];
  if (String(planContextContent || "").trim()) {
    messages.push({ role: "system", content: String(planContextContent || "").trim() });
  }
  for (const item of Array.isArray(phaseReportsContents) ? phaseReportsContents : []) {
    const content = String(item || "").trim();
    if (!content) continue;
    messages.push({ role: "system", content });
  }
  if (String(requestContent || "").trim()) {
    messages.push({ role: "user", content: String(requestContent || "").trim() });
  }
  void locale;
  return messages;
}

function buildPhaseAcceptanceRequestPayload({ bucket = {}, state = {} } = {}) {
  return {
    acceptanceType: "phase",
    phaseIndex: Array.isArray(bucket?.phaseAcceptanceReports)
      ? bucket.phaseAcceptanceReports.length + 1
      : 1,
    summaryText: String(bucket?.summaryText || "").trim(),
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
  if (bucket.phaseAcceptanceReports.length > 50) {
    bucket.phaseAcceptanceReports.splice(0, bucket.phaseAcceptanceReports.length - 50);
  }
  bucket.lastPhaseAcceptanceReport = report;
  return report;
}

function buildFinalOutputFallbackPhaseAcceptanceText(locale = LOCALE.ZH_CN, bucket = {}, state = {}) {
  const checklistCount = Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist.length : 0;
  const signalCount = Number(state?.signals?.successfulToolCount || 0);
  if (locale === LOCALE.EN_US) {
    return `Phase acceptance before final acceptance: checklistCount=${checklistCount}, successfulToolCount=${signalCount}.`;
  }
  return `总体验收前阶段验收：checklistCount=${checklistCount}，successfulToolCount=${signalCount}。`;
}

function pushRoleMessage(messages = [], role = "system", content = "") {
  const normalizedContent = String(content || "").trim();
  if (!Array.isArray(messages) || !normalizedContent) return false;
  messages.push({ role: String(role || "system").trim() || "system", content: normalizedContent });
  return true;
}

function buildAcceptancePromptParts({
  bucket = {},
  state = {},
  locale = LOCALE.ZH_CN,
  requestPayload = {},
  phase = false,
} = {}) {
  const mainPlanContext = resolveAcceptanceMainPlanContext(
    {
      planText: String(bucket?.planText || "").trim(),
      finalPlanChecklist: Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist : [],
    },
    bucket,
    locale,
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
  const summaryReportsContents = buildAllSummaryReportSystemContents({
    locale,
    marker: getAllSummaryReportsMarker(locale),
    data: { summaryText: String(bucket?.summaryText || "").trim() },
  });
  const requestContent = phase
    ? buildPhaseAcceptanceRequestPromptText({
        locale,
        marker: getPhaseAcceptanceRequestMarker(locale),
        data: { requestPayload },
      })
    : buildAcceptanceValidationRequestPromptText({
        locale,
        marker: getAcceptanceSemanticValidationMarker(locale),
        data: { requestPayload },
      });
  void state;
  return { planContextContent, summaryReportsContents, phaseReportsContents, requestContent };
}

function buildPhaseAcceptanceMessages({
  agentMessages = [],
  summaryReportsContents = [],
  planContextContent = "",
  phaseReportsContents = [],
  requestContent = "",
} = {}) {
  const messages = [];
  for (const item of Array.isArray(agentMessages) ? agentMessages : []) {
    if (item && typeof item === "object") messages.push(item);
  }
  for (const item of Array.isArray(summaryReportsContents) ? summaryReportsContents : []) {
    const content = String(item || "").trim();
    if (!content) continue;
    messages.push({ role: "system", content });
  }
  if (String(planContextContent || "").trim()) {
    messages.push({ role: "system", content: String(planContextContent || "").trim() });
  }
  for (const item of Array.isArray(phaseReportsContents) ? phaseReportsContents : []) {
    const content = String(item || "").trim();
    if (!content) continue;
    messages.push({ role: "system", content });
  }
  if (String(requestContent || "").trim()) {
    messages.push({ role: "user", content: String(requestContent || "").trim() });
  }
  return messages;
}

export function maybeInjectPhaseAcceptancePrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.pending.phaseAcceptance !== true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const { summaryReportsContents, planContextContent, phaseReportsContents, requestContent } = buildAcceptancePromptParts({
    bucket,
    state,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
  });
  for (const content of summaryReportsContents) {
    pushRoleMessage(messages, "system", content);
  }
  pushRoleMessage(messages, "system", planContextContent);
  for (const content of phaseReportsContents) {
    pushRoleMessage(messages, "system", content);
  }
  pushRoleMessage(messages, "user", requestContent);
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
    return forceRun === true ? false : maybeInjectPhaseAcceptancePrompt(ctx);
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const { summaryReportsContents, planContextContent, phaseReportsContents, requestContent } = buildAcceptancePromptParts({
    bucket,
    state,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
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
  const attachmentMetas = await saveCapabilityOutputAsAttachmentMetas(ctx, {
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

export function maybeInjectAcceptanceSemanticValidationPrompt(ctx = {}) {
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
  const promptPayload = pendingData.payload && typeof pendingData.payload === "object" ? pendingData.payload : {};
  const mainPlanContext = resolveAcceptanceMainPlanContext(promptPayload, bucket, locale);
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
  });
  const systemInjection = injectMessageWithPolicy(ctx, {
    role: "system",
    content: systemContent,
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: false,
  });
  if (!systemInjection.injected) return false;
  for (const content of phaseReportsContents) {
    injectMessageWithPolicy(ctx, {
      role: "system",
      content,
      injectAt: "append",
      dedupe: false,
      avoidBreakToolCallContinuity: false,
    });
  }
  const userInjection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: requestContent,
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: false,
  });
  if (!userInjection.injected) return false;
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
  const mainPlanContext = resolveAcceptanceMainPlanContext(promptPayload, bucket, locale);
  const requestPayload = resolveAcceptanceValidationRequestPayload(promptPayload);
  const prompt = buildAcceptanceValidationRequestPromptText({
    locale,
    marker: getAcceptanceSemanticValidationMarker(locale),
    data: {
      requestPayload,
    },
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
  const attachmentMetas = await saveCapabilityOutputAsAttachmentMetas(ctx, {
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
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.semanticValidationCompleted,
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}
