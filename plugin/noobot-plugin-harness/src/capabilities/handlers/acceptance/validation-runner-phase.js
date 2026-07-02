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
  saveCapabilityOutputAsTransferArtifacts,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
} from "./deps.js";
import { captureInjectedResult } from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  buildPhaseAcceptanceMessages,
  buildAcceptancePromptParts,
  buildFinalOutputFallbackPhaseAcceptanceText,
  buildPhaseAcceptanceRequestPayload,
  appendPhaseAcceptanceReport,
  filterHistoricalSummaryRelayMessages,
  pushRoleMessage,
} from "./validation-runner-prompts.js";
import {
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildScenarioPolicyPromptText,
  resolveScenarioPolicyFlagsFromContext,
} from "../shared/workflow/prompts.js";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

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
    pushRoleMessage(ctx, messages, "system", content);
  }
  pushRoleMessage(ctx, messages, "system", planContextContent);
  for (const content of phaseReportsContents) {
    pushRoleMessage(ctx, messages, "system", content);
  }
  pushRoleMessage(ctx, messages, "user", requestContent);
  pushRoleMessage(
    ctx,
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
  const agentMessages = filterHistoricalSummaryRelayMessages(resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "phase_acceptance",
  }));
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
  const attachments = await saveCapabilityOutputAsTransferArtifacts(ctx, {
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
    attachments,
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
            agentMessages: filterHistoricalSummaryRelayMessages(resolveCapabilityModelMessages(meta, {
              ctx,
              purpose: "phase_acceptance_before_final",
            })),
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

