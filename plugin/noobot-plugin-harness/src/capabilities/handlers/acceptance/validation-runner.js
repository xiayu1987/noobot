/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractRawTextContent,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  resolvePlanningGuidanceMode,
  translateI18nText,
} from "./deps.js";
import { parseSemanticValidationResult } from "../model-response-parser.js";
import {
  captureInjectedResult,
  injectScheduledPrompt,
  scheduleInjectTask,
} from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import { buildSemanticValidationPromptPayload } from "./report-builder.js";

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
  return injectScheduledPrompt(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    injectedEvent: "acceptance_semantic_validation_prompt_injected",
    getPendingData: ({ state }) =>
      state.pending.acceptanceSemanticValidation &&
      typeof state.pending.acceptanceSemanticValidation === "object"
        ? state.pending.acceptanceSemanticValidation
        : null,
    consumePendingData: ({ state }) => {
      setPendingStateWithMeta(state, "acceptanceSemanticValidation", null);
    },
    markCapturePending: ({ state, pendingData }) => {
      setCaptureFlagStateWithMeta(state, "acceptanceSemanticValidationCapturePending", true);
      state.flags.acceptanceSemanticValidationCaptureReportIndex = Number(pendingData.reportIndex);
    },
    buildPromptContent: ({ locale, pendingData }) =>
      [
        translateI18nText(locale, "acceptanceSemanticValidationMarker"),
        translateI18nText(locale, "acceptanceSemanticValidationBody"),
        JSON.stringify(pendingData.payload || {}, null, 2),
      ].join("\n"),
  });
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
      targetReport.semanticValidation = parseSemanticValidationResult(responseText);
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
  const prompt = [
    locale === LOCALE.EN_US
      ? "Validate semantic consistency between the task checklist, acceptance report, tool signals, and final output. Return JSON only."
      : "请验证任务清单、规则验收报告、工具信号与最终输出之间的语义一致性。只返回 JSON。",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "acceptance_semantic_validation",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      model: resolveCapabilityModelName(meta, {
        purpose: "acceptance_semantic_validation",
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      }),
      locale,
      prompt,
      messages: resolveCapabilityModelMessages(meta, {
        ctx,
        purpose: "acceptance_semantic_validation",
        messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      }),
      ctx,
      baseReport,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "acceptance_semantic_validation"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "acceptance_semantic_validation_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    purpose: "acceptance_semantic_validation",
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  baseReport.semanticValidation = parseSemanticValidationResult(responseText);
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "acceptance_semantic_validation_completed",
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}
