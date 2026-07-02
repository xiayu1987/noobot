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
  ensureHarnessBucket,
  extractRawTextContent,
  invokeWithReasoningRetry,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  resolvePlanningGuidanceMode,
} from "./deps.js";
import { captureInjectedResult, scheduleInjectTask } from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import { applySemanticAcceptanceToReport, buildSemanticValidationPromptPayload } from "./report-builder.js";
import {
  buildTextAcceptanceValidationResult,
  buildFinalAcceptanceSemanticValidationMessages,
  resolveAcceptanceMainPlanContext,
  resolveAcceptanceValidationRequestPayload,
} from "./validation-runner-prompts.js";
import {
  buildAllPhaseAcceptanceReportSystemContents,
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildScenarioPolicyPromptText,
  resolveScenarioPolicyFlagsFromContext,
  getAllPhaseAcceptanceReportsMarker,
  getAcceptanceMainPlanContextMarker,
  getAcceptanceSemanticValidationMarker,
} from "../shared/workflow/prompts.js";
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

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
  const attachments = await saveCapabilityOutputAsTransferArtifacts(ctx, {
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
    attachments,
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
