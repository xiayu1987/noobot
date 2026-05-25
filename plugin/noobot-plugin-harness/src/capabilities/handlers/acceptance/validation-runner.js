/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
  buildAcceptanceMainPlanContextPromptText,
  buildAcceptanceValidationRequestPromptText,
  getAcceptanceMainPlanContextMarker,
  getAcceptanceSemanticValidationMarker,
} from "../shared/workflow-prompts.js";
import { injectMessageWithPolicy } from "../shared/message-injection-utils.js";

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

export function scheduleAcceptanceSemanticValidationByInject(ctx = {}, baseReport = null) {
  if (!baseReport) return false;
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    scheduledEvent: "acceptance_semantic_validation_scheduled_by_inject",
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
    event: "acceptance_semantic_validation_prompt_injected",
  });
  return true;
}

export function maybeCaptureAcceptanceSemanticValidationByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    completedEvent: "acceptance_semantic_validation_completed_inject",
    failedEvent: "acceptance_semantic_validation_capture_failed_inject",
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
  if (acceptanceOptions.semanticValidation !== true) return false;
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
  const agentMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "acceptance_semantic_validation",
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
        messages: buildCapabilityModelMessages({
          locale,
          agentMessages,
          constraints: [
            buildAcceptanceMainPlanContextPromptText({
              locale,
              marker: getAcceptanceMainPlanContextMarker(locale),
              data: { mainPlanContext },
            }),
          ],
          task: prompt,
        }),
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
      event: "acceptance_semantic_validation_failed",
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
      event: "acceptance_semantic_validation_empty_output",
    });
    return false;
  }
  baseReport.semanticValidation = parsed;
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "acceptance_semantic_validation_completed",
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}
