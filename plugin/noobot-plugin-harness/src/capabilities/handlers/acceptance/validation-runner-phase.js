/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { resolveModelMessages } from "../../../core/message-store.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  invokeCapabilityModel,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  readCapabilityModelInvoker,
  shouldUseSeparateModel,
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
import { text } from "@noobot/shared/value";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

export function maybeInjectPhaseAcceptancePrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.pending.phaseAcceptance !== true) return false;
  const messages = resolveModelMessages(ctx);
  if (!messages) return false;
  const locale = state.locale || LOCALE.ZH_CN;
  const { scenario, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(ctx);
  const {
    summaryReportsContents,
    planContextContent,
    phaseReportsContents,
    requestContent,
    protocolContent,
  } = buildAcceptancePromptParts({
    bucket,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
    ctx,
  });
  pushRoleMessage(ctx, messages, "system", protocolContent);
  for (const content of summaryReportsContents) {
    pushRoleMessage(ctx, messages, "user", content);
  }
  pushRoleMessage(ctx, messages, "user", planContextContent);
  for (const content of phaseReportsContents) {
    pushRoleMessage(ctx, messages, "user", content);
  }
  pushRoleMessage(ctx, messages, "user", requestContent);
  pushRoleMessage(
    ctx,
    messages,
    "user",
    buildWorkflowResponsibilityConstraintUserPrompt(locale, "phase_acceptance", {
      scenario,
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
      const normalizedText = text(responseText);
      if (!normalizedText)
        return { applied: false, detail: { reason: "empty_phase_acceptance_output" } };
      appendPhaseAcceptanceReport(bucket, normalizedText);
      state.flags.phaseAcceptanceTriggeredThisTurn = true;
      return {
        applied: true,
        detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
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
  if (!shouldUseSeparateModel(meta)) {
    return forceRun === true ? false : maybeInjectPhaseAcceptancePrompt(ctx);
  }
  const invoker = readCapabilityModelInvoker(meta);
  const locale = state.locale || LOCALE.ZH_CN;
  const scenarioPolicy = resolveScenarioPolicyFlagsFromContext(ctx);
  const {
    summaryReportsContents,
    planContextContent,
    phaseReportsContents,
    requestContent,
    protocolContent,
  } = buildAcceptancePromptParts({
    bucket,
    locale,
    phase: true,
    requestPayload: buildPhaseAcceptanceRequestPayload({ bucket, state }),
    ctx,
    includeWorkflowPolicy: false,
  });
  const agentMessages = filterHistoricalSummaryRelayMessages(
    resolveCapabilityModelMessages(meta, {
      ctx,
      purpose: "phase_acceptance",
    }),
  );
  if (shouldRunFromPending) {
    setPendingStateWithMeta(state, "phaseAcceptance", false);
  }
  let response = null;
  try {
    response = await invokeCapabilityModel({
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
          agentMessages,
          summaryReportsContents,
          planContextContent,
          phaseReportsContents,
          requestContent,
          protocolContent,
          workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, scenarioPolicy),
          scenario: scenarioPolicy.scenario,
          dynamicPolicyPrompt: scenarioPolicy.dynamicPolicyPrompt,
        }),
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "phase_acceptance"),
      },
      purpose: "phase_acceptance",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, {
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
  if (response === null) return false;
  const responseText = text(response.output.text);
  appendPhaseAcceptanceReport(bucket, responseText);
  state.flags.phaseAcceptanceTriggeredThisTurn = true;
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
    toolNameBindings: response.toolNameBindings,
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
  if (state.flags.phaseAcceptanceTriggeredThisTurn === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceSkippedBeforeFinalOutputSameTurn,
      detail: {
        reason: "phase_acceptance_already_triggered_this_turn",
        phaseAcceptanceCount: bucket.phaseAcceptanceReports.length,
      },
    });
    return false;
  }
  const locale = state.locale || LOCALE.ZH_CN;
  const scenarioPolicy = resolveScenarioPolicyFlagsFromContext(ctx);
  const requestPayload = buildPhaseAcceptanceRequestPayload({ bucket, state });
  const {
    summaryReportsContents,
    planContextContent,
    phaseReportsContents,
    requestContent,
    protocolContent,
  } = buildAcceptancePromptParts({
    bucket,
    locale,
    phase: true,
    requestPayload,
    ctx,
    includeWorkflowPolicy: false,
  });
  if (!shouldUseSeparateModel(meta)) {
    const fallbackText = buildFinalOutputFallbackPhaseAcceptanceText(locale, bucket, state);
    appendPhaseAcceptanceReport(bucket, fallbackText);
    state.flags.phaseAcceptanceTriggeredThisTurn = true;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.phaseAcceptanceGeneratedBeforeFinalOutputFallback,
      detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
    });
    return true;
  }
  const invoker = readCapabilityModelInvoker(meta);
  let response = null;
  try {
    response = await invokeCapabilityModel({
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
          agentMessages: filterHistoricalSummaryRelayMessages(
            resolveCapabilityModelMessages(meta, {
              ctx,
              purpose: "phase_acceptance_before_final",
            }),
          ),
          summaryReportsContents,
          planContextContent,
          phaseReportsContents,
          requestContent,
          protocolContent,
          workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, scenarioPolicy),
          scenario: scenarioPolicy.scenario,
          dynamicPolicyPrompt: scenarioPolicy.dynamicPolicyPrompt,
        }),
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "phase_acceptance_before_final"),
      },
      purpose: "phase_acceptance_before_final",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, {
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
  if (response === null) return false;
  appendPhaseAcceptanceReport(bucket, text(response.output.text));
  state.flags.phaseAcceptanceTriggeredThisTurn = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.phaseAcceptanceGeneratedBeforeFinalOutput,
    detail: { phaseAcceptanceCount: bucket.phaseAcceptanceReports.length },
  });
  return true;
}
