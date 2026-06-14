/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON, TRANSFER_SOURCE } from "../core/constants.js";
import { compactTransferPayloadForModel, firstNormalizedString } from "../core/compact.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import { directOutput } from "../envelope/envelope.js";
import { transferToolInput, transferToolOutput } from "./tool-transfer.js";
import { normalizeToolResultOverflow } from "./tool-result-overflow.js";
import { transferWorkflowSubagentResult } from "./subagent-transfer.js";
import { composeHarnessFinalMessage, transferHarnessStageMessage } from "./harness-transfer.js";

export const SEMANTIC_TRANSFER_SCENARIO = {
  TOOL: "tool",
  WORKFLOW: "workflow",
  HARNESS: "harness",
};

export const SEMANTIC_TRANSFER_STRATEGY = {
  TOOL_INPUT: "tool_input",
  TOOL_OUTPUT: "tool_output",
  TOOL_RESULT_TEXT: "tool_result_text",
  WORKFLOW_SUBAGENT_RESULT: "workflow_subagent_result",
  WORKFLOW_UPSTREAM_INJECTION: "workflow_upstream_injection",
  WORKFLOW_FINAL_RETURN: "workflow_final_return",
  WORKFLOW_FAILURE_PROPAGATION: "workflow_failure_propagation",
  HARNESS_STAGE_MESSAGE: "harness_stage_message",
  HARNESS_SUMMARY_INJECTION: "harness_summary_injection",
  HARNESS_FINAL_MESSAGE: "harness_final_message",
};

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeScenario(value = "") {
  const normalized = normalizeString(value).toLowerCase();
  switch (normalized) {
    case SEMANTIC_TRANSFER_SCENARIO.TOOL:
      return SEMANTIC_TRANSFER_SCENARIO.TOOL;
    case SEMANTIC_TRANSFER_SCENARIO.WORKFLOW:
      return SEMANTIC_TRANSFER_SCENARIO.WORKFLOW;
    case SEMANTIC_TRANSFER_SCENARIO.HARNESS:
      return SEMANTIC_TRANSFER_SCENARIO.HARNESS;
    default:
      return "";
  }
}

function normalizeStrategy(value = "") {
  return normalizeString(value).toLowerCase();
}

function buildInvalidResult({ code = "SEMANTIC_TRANSFER_INVALID_SCENARIO", message = "invalid semantic-transfer request" } = {}) {
  return {
    transferResult: createTransferResult({
      ok: false,
      status: TRANSFER_RESULT_STATUS.FAILED,
      error: { code, message },
    }),
    transferEnvelopes: [],
    compactTransferPayload: {},
  };
}

function normalizePayloadAndOptions(options = {}) {
  const payload = isPlainObject(options?.payload) ? options.payload : {};
  const context = isPlainObject(options?.context) ? options.context : {};
  return {
    ...options,
    ...payload,
    ...(isPlainObject(context) ? { context } : {}),
  };
}

function createDirectTextTransfer({ text = "", scenario = "", strategy = "", meta = {} } = {}) {
  const normalizedText = String(text || "");
  const envelope = directOutput(normalizedText, {
    ...meta,
    source: meta?.source || TRANSFER_SOURCE.SERVICE,
    reason: meta?.reason || TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
    scenario,
    strategy,
  });
  const transferResult = createTransferResult({
    ok: true,
    status: TRANSFER_RESULT_STATUS.DIRECT,
    envelope,
  });
  const transferEnvelopes = [envelope];
  return {
    transferResult,
    transferEnvelope: envelope,
    transferEnvelopes,
    compactTransferPayload: compactTransferPayloadForModel({ transferResult, transferEnvelopes }),
  };
}

async function transferToolStrategy({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.TOOL_RESULT_TEXT) {
    return normalizeToolResultOverflow({
      ...options,
      runtime,
      agentContext,
      toolResultText: options.toolResultText ?? options.text ?? options.content ?? "",
    });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.TOOL_INPUT) {
    return transferToolInput({ ...options, runtime, agentContext });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.TOOL_OUTPUT) {
    return transferToolOutput({ ...options, runtime, agentContext });
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "tool scenario requires strategy tool_input/tool_output/tool_result_text",
  });
}

async function transferWorkflowStrategy({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  if (
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_SUBAGENT_RESULT ||
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_FINAL_RETURN
  ) {
    return transferWorkflowSubagentResult({ ...options, runtime, agentContext });
  }
  if (
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_UPSTREAM_INJECTION ||
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_FAILURE_PROPAGATION
  ) {
    const content = firstNormalizedString(options?.content, options?.message, options?.text);
    if (!content) {
      return {
        transferResult: createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.SKIPPED }),
        transferEnvelopes: [],
        injectionMessage: "",
        compactTransferPayload: {},
      };
    }
    return {
      ...createDirectTextTransfer({ text: content, scenario: "workflow", strategy, meta: options?.meta || {} }),
      injectionMessage: content,
    };
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "workflow scenario requires a workflow_* strategy",
  });
}

async function transferHarnessSummaryInjection({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  const injectMode = normalizeString(options?.injectMode || options?.summaryInjectMode || "full").toLowerCase() === "summary"
    ? "summary"
    : "full";
  const fullText = firstNormalizedString(
    options?.fullText,
    options?.rawSummaryText,
    options?.summaryFullText,
    options?.content,
    options?.text,
  );
  const summaryText = firstNormalizedString(options?.summary, options?.summaryText, options?.overviewText, fullText);
  const detailText = firstNormalizedString(options?.detail, options?.detailText);
  const injectionMessage = injectMode === "summary" ? summaryText : firstNormalizedString(fullText, summaryText);
  let detailTransfer = null;
  if (detailText && options?.saveDetailToAttachment === true) {
    detailTransfer = await transferHarnessStageMessage({
      runtime,
      agentContext,
      summary: summaryText,
      detail: detailText,
      name: options?.name || "harness-summary-detail.md",
      mimeType: options?.mimeType,
      attachmentSource: options?.attachmentSource,
      generationSource: options?.generationSource || "harness_summary_detail",
      source: options?.source || "plugin",
      reason: options?.reason || "harness_summary_injection",
      meta: options?.meta || {},
    });
  }
  const direct = createDirectTextTransfer({
    text: injectionMessage,
    scenario: "harness",
    strategy,
    meta: { ...(options?.meta || {}), injectMode },
  });
  const detailEnvelopes = Array.isArray(detailTransfer?.transferEnvelopes) ? detailTransfer.transferEnvelopes : [];
  const transferEnvelopes = [...detailEnvelopes, ...direct.transferEnvelopes];
  return {
    ...direct,
    transferEnvelopes,
    detailTransferResult: detailTransfer?.transferResult || null,
    injectionMessage,
    injectMode,
    summary: summaryText,
  };
}

async function transferHarnessStrategy({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.HARNESS_STAGE_MESSAGE) {
    return transferHarnessStageMessage({ ...options, runtime, agentContext });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.HARNESS_SUMMARY_INJECTION) {
    return transferHarnessSummaryInjection({ ...options, runtime, agentContext, strategy });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.HARNESS_FINAL_MESSAGE) {
    const finalMessage = composeHarnessFinalMessage(options || {});
    return {
      ...createDirectTextTransfer({
        text: finalMessage,
        scenario: "harness",
        strategy,
        meta: { source: TRANSFER_SOURCE.PLUGIN, reason: "harness_final_message" },
      }),
      finalMessage,
      message: finalMessage,
    };
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "harness scenario requires a harness_* strategy",
  });
}

export async function transferSemanticContent({
  scenario = "",
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  const merged = normalizePayloadAndOptions(options);
  const normalizedScenario = normalizeScenario(scenario);
  const normalizedStrategy = normalizeStrategy(strategy);

  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.TOOL) {
    return transferToolStrategy({ ...merged, strategy: normalizedStrategy, runtime, agentContext });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.WORKFLOW) {
    return transferWorkflowStrategy({ ...merged, strategy: normalizedStrategy, runtime, agentContext });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS) {
    return transferHarnessStrategy({ ...merged, strategy: normalizedStrategy, runtime, agentContext });
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_SCENARIO",
    message: "scenario must be one of tool/workflow/harness",
  });
}
