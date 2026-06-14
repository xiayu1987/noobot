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
import { transferBotPluginSubagentResult } from "./subagent-transfer.js";
import { composeAgentPluginFinalMessage, transferAgentPluginStageMessage } from "./plugin-stage-transfer.js";

export const SEMANTIC_TRANSFER_SCENARIO = {
  TOOL: "tool",
  BOT_PLUGIN: "bot_plugin",
  AGENT_PLUGIN: "agent_plugin",
};

export const SEMANTIC_TRANSFER_STRATEGY = {
  TOOL_INPUT: "tool_input",
  TOOL_OUTPUT: "tool_output",
  TOOL_RESULT_TEXT: "tool_result_text",
  BOT_PLUGIN_SUBAGENT_RESULT: "bot_plugin_subagent_result",
  BOT_PLUGIN_UPSTREAM_INJECTION: "bot_plugin_upstream_injection",
  BOT_PLUGIN_FINAL_RETURN: "bot_plugin_final_return",
  BOT_PLUGIN_FAILURE_PROPAGATION: "bot_plugin_failure_propagation",
  AGENT_PLUGIN_STAGE_MESSAGE: "agent_plugin_stage_message",
  AGENT_PLUGIN_SUMMARY_INJECTION: "agent_plugin_summary_injection",
  AGENT_PLUGIN_FINAL_MESSAGE: "agent_plugin_final_message",
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
    case SEMANTIC_TRANSFER_SCENARIO.BOT_PLUGIN:
      return SEMANTIC_TRANSFER_SCENARIO.BOT_PLUGIN;
    case SEMANTIC_TRANSFER_SCENARIO.AGENT_PLUGIN:
      return SEMANTIC_TRANSFER_SCENARIO.AGENT_PLUGIN;
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

async function transferBotPluginStrategy({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  if (
    strategy === SEMANTIC_TRANSFER_STRATEGY.BOT_PLUGIN_SUBAGENT_RESULT ||
    strategy === SEMANTIC_TRANSFER_STRATEGY.BOT_PLUGIN_FINAL_RETURN
  ) {
    return transferBotPluginSubagentResult({ ...options, runtime, agentContext });
  }
  if (
    strategy === SEMANTIC_TRANSFER_STRATEGY.BOT_PLUGIN_UPSTREAM_INJECTION ||
    strategy === SEMANTIC_TRANSFER_STRATEGY.BOT_PLUGIN_FAILURE_PROPAGATION
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
      ...createDirectTextTransfer({ text: content, scenario: "bot_plugin", strategy, meta: options?.meta || {} }),
      injectionMessage: content,
    };
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "bot plugin scenario requires a bot_plugin_* strategy",
  });
}

async function transferAgentPluginSummaryInjection({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
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
    detailTransfer = await transferAgentPluginStageMessage({
      runtime,
      agentContext,
      summary: summaryText,
      detail: detailText,
      name: options?.name || "agent-plugin-summary-detail.md",
      mimeType: options?.mimeType,
      attachmentSource: options?.attachmentSource,
      generationSource: options?.generationSource || "agent_plugin_summary_detail",
      source: options?.source || "plugin",
      reason: options?.reason || "agent_plugin_summary_injection",
      meta: options?.meta || {},
    });
  }
  const direct = createDirectTextTransfer({
    text: injectionMessage,
    scenario: "agent_plugin",
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

async function transferAgentPluginStrategy({ strategy = "", runtime = {}, agentContext = null, ...options } = {}) {
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.AGENT_PLUGIN_STAGE_MESSAGE) {
    return transferAgentPluginStageMessage({ ...options, runtime, agentContext });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.AGENT_PLUGIN_SUMMARY_INJECTION) {
    return transferAgentPluginSummaryInjection({ ...options, runtime, agentContext, strategy });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.AGENT_PLUGIN_FINAL_MESSAGE) {
    const finalMessage = composeAgentPluginFinalMessage(options || {});
    return {
      ...createDirectTextTransfer({
        text: finalMessage,
        scenario: "agent_plugin",
        strategy,
        meta: { source: TRANSFER_SOURCE.PLUGIN, reason: "agent_plugin_final_message" },
      }),
      finalMessage,
      message: finalMessage,
    };
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "agent plugin scenario requires an agent_plugin_* strategy",
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
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.BOT_PLUGIN) {
    return transferBotPluginStrategy({ ...merged, strategy: normalizedStrategy, runtime, agentContext });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.AGENT_PLUGIN) {
    return transferAgentPluginStrategy({ ...merged, strategy: normalizedStrategy, runtime, agentContext });
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_SCENARIO",
    message: "scenario must be one of tool/bot_plugin/agent_plugin",
  });
}
