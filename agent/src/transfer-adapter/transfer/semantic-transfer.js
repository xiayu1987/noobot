/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SEMANTIC_TRANSFER_REGISTRATION,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  assertSemanticTransferRegistration,
  resolveTransferIntent,
} from "@noobot/semantic-transfer-protocol";
import { firstNormalizedString, normalizeString } from "../core/compact.js";
import { createDirectTransferEnvelope } from "../storage/attachment-adapter.js";
import { transferToolInput, transferToolOutput } from "./tool-transfer.js";
import { normalizeToolResultOverflow } from "./tool-result-overflow.js";
import { transferBotPluginSubagentResult } from "./subagent-transfer.js";
import {
  composeAgentPluginFinalMessage,
  transferAgentPluginStageMessage,
} from "./plugin-stage-transfer.js";
import { isPlainObject } from "../../shared/utils/shared-utils.js";

const SEMANTIC_TRANSFER_SCENARIO = SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS;
const TOOL_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.TOOL_STRATEGIES;
const WORKFLOW_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.WORKFLOW_STRATEGIES;
const HARNESS_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.HARNESS_STRATEGIES;

function normalizeScenario(value = "") {
  return normalizeString(value).toLowerCase();
}

function normalizeStrategy(value = "") {
  return normalizeString(value).toLowerCase();
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

function createDirectTextTransfer({
  text = "",
  scenario = "",
  strategy = "",
  identity,
  meta = {},
} = {}) {
  const normalizedText = String(text || "");
  const envelope = createDirectTransferEnvelope({
    identity,
    content: normalizedText,
    intent: {
      ...resolveTransferIntent({ source: meta?.source, reason: meta?.reason }),
      scenario,
      strategy,
    },
    meta,
  });
  const transferEnvelopes = [envelope];
  return {
    transferEnvelopes,
  };
}

async function transferToolStrategy({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  if (strategy === TOOL_STRATEGY.RESULT_TEXT) {
    return normalizeToolResultOverflow({
      ...options,
      runtime,
      agentContext,
      identity: options.identity,
      toolResultText: options.toolResultText ?? options.text ?? options.content ?? "",
    });
  }
  if (strategy === TOOL_STRATEGY.INPUT) {
    return transferToolInput({ ...options, runtime, agentContext });
  }
  if (strategy === TOOL_STRATEGY.OUTPUT) {
    return transferToolOutput({ ...options, runtime, agentContext });
  }
  throw new Error(`semantic_transfer_strategy_unhandled:tool:${strategy}`);
}

async function transferBotPluginStrategy({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  if (strategy === WORKFLOW_STRATEGY.SUB_AGENT || strategy === WORKFLOW_STRATEGY.FINAL_PLAN) {
    return transferBotPluginSubagentResult({
      ...options,
      runtime,
      agentContext,
    });
  }
  throw new Error(`semantic_transfer_strategy_unhandled:workflow:${strategy}`);
}

async function transferAgentPluginSummaryInjection({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  const injectMode =
    normalizeString(options?.injectMode || options?.summaryInjectMode || "full").toLowerCase() ===
    "summary"
      ? "summary"
      : "full";
  const fullText = firstNormalizedString(
    options?.fullText,
    options?.rawSummaryText,
    options?.summaryFullText,
    options?.content,
    options?.text,
  );
  const summaryText = firstNormalizedString(
    options?.summary,
    options?.summaryText,
    options?.overviewText,
    fullText,
  );
  const detailText = firstNormalizedString(options?.detail, options?.detailText);
  const injectionMessage =
    injectMode === "summary" ? summaryText : firstNormalizedString(fullText, summaryText);
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
      ...resolveTransferIntent({
        source: options?.source,
        reason: options?.reason,
        fallbackSource: TRANSFER_SOURCE.PLUGIN,
        fallbackReason: TRANSFER_REASON.HARNESS_SUMMARY,
      }),
      meta: options?.meta || {},
    });
  }
  const direct = createDirectTextTransfer({
    text: injectionMessage,
    scenario: SEMANTIC_TRANSFER_SCENARIO.HARNESS,
    strategy,
    identity: options.identity,
    meta: {
      ...(options?.meta || {}),
      injectMode,
      summary: summaryText,
      detail: detailText,
    },
  });
  const detailEnvelopes = Array.isArray(detailTransfer?.transferEnvelopes)
    ? detailTransfer.transferEnvelopes
    : [];
  const transferEnvelopes = [...detailEnvelopes, ...direct.transferEnvelopes];
  return { transferEnvelopes };
}

async function transferAgentPluginStrategy({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  if (
    Object.values(HARNESS_STRATEGY).includes(strategy) &&
    options.detail !== undefined &&
    options.fullText === undefined &&
    options.summaryText === undefined
  ) {
    return transferAgentPluginStageMessage({
      ...options,
      strategy,
      category: options.category,
      businessPoint: options.businessPoint,
      runtime,
      agentContext,
    });
  }
  if (
    strategy === HARNESS_STRATEGY.SUMMARY &&
    (options.fullText !== undefined || options.summaryText !== undefined)
  ) {
    return transferAgentPluginSummaryInjection({
      ...options,
      runtime,
      agentContext,
      strategy,
    });
  }
  if (strategy === HARNESS_STRATEGY.SUMMARY) {
    const finalMessage = composeAgentPluginFinalMessage(options || {});
    return {
      ...createDirectTextTransfer({
        text: finalMessage,
        scenario: SEMANTIC_TRANSFER_SCENARIO.HARNESS,
        strategy,
        identity: options.identity,
        meta: {
          source: TRANSFER_SOURCE.PLUGIN,
          reason: "harness_summary",
        },
      }),
    };
  }
  throw new Error(`semantic_transfer_strategy_unhandled:harness:${strategy}`);
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
  assertSemanticTransferRegistration({
    scenario: normalizedScenario,
    strategy: normalizedStrategy,
  });

  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.TOOL) {
    return transferToolStrategy({
      ...merged,
      strategy: normalizedStrategy,
      runtime,
      agentContext,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.WORKFLOW) {
    return transferBotPluginStrategy({
      ...merged,
      strategy: normalizedStrategy,
      runtime,
      agentContext,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS) {
    return transferAgentPluginStrategy({
      ...merged,
      strategy: normalizedStrategy,
      runtime,
      agentContext,
    });
  }
  throw new Error(`semantic_transfer_scenario_unhandled:${normalizedScenario}`);
}
