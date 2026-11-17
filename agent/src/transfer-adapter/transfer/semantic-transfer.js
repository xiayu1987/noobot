/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import {
  SEMANTIC_TRANSFER_REGISTRATION,
  TRANSFER_SOURCE,
  assertSemanticTransferRegistration,
  resolveTransferIntent,
} from "@noobot/semantic-transfer-protocol";
import { createDirectTransferEnvelope } from "../storage/attachment-adapter.js";
import { transferToolInput, transferToolOutput } from "./tool-transfer.js";
import { normalizeToolResultOverflow } from "./tool-result-overflow.js";
import { transferBotPluginSubagentResult } from "./subagent-transfer.js";
import {
  composeAgentPluginFinalMessage,
  transferAgentPluginStageMessage,
} from "./plugin-stage-transfer.js";
import { resolveLocaleFromRuntime } from "noobot-i18n/shared";

const SEMANTIC_TRANSFER_SCENARIO = SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS;
const TOOL_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.TOOL_STRATEGIES;
const WORKFLOW_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.WORKFLOW_STRATEGIES;
const HARNESS_STRATEGY = SEMANTIC_TRANSFER_REGISTRATION.HARNESS_STRATEGIES;

function normalizeScenario(value = "") {
  return text(value).toLowerCase();
}

function normalizeStrategy(value = "") {
  return text(value).toLowerCase();
}

function createDirectTextTransfer({
  text: inputText = "",
  scenario = "",
  strategy = "",
  identity,
  meta = {},
} = {}) {
  const normalizedText = String(inputText || "");
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

async function transferToolStrategy({ strategy = "", runtime = {}, ...options } = {}) {
  if (strategy === TOOL_STRATEGY.RESULT_TEXT) {
    return normalizeToolResultOverflow({
      ...options,
      runtime,
      identity: options.identity,
    });
  }
  if (strategy === TOOL_STRATEGY.INPUT) {
    return transferToolInput({ ...options, runtime });
  }
  if (strategy === TOOL_STRATEGY.OUTPUT) {
    return transferToolOutput({ ...options, runtime });
  }
  throw new Error(`semantic_transfer_strategy_unhandled:tool:${strategy}`);
}

async function transferBotPluginStrategy({ strategy = "", runtime = {}, ...options } = {}) {
  if (strategy === WORKFLOW_STRATEGY.SUB_AGENT || strategy === WORKFLOW_STRATEGY.FINAL_PLAN) {
    return transferBotPluginSubagentResult({
      ...options,
      runtime,
    });
  }
  throw new Error(`semantic_transfer_strategy_unhandled:workflow:${strategy}`);
}

async function transferAgentPluginStrategy({ strategy = "", runtime = {}, ...options } = {}) {
  if (Object.values(HARNESS_STRATEGY).includes(strategy) && options.detail !== undefined) {
    return transferAgentPluginStageMessage({
      ...options,
      strategy,
      category: options.category,
      businessPoint: options.businessPoint,
      runtime,
    });
  }
  if (strategy === HARNESS_STRATEGY.SUMMARY) {
    const finalMessage = composeAgentPluginFinalMessage({
      ...options,
      locale: resolveLocaleFromRuntime(runtime),
    });
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
  ...options
} = {}) {
  const normalizedScenario = normalizeScenario(scenario);
  const normalizedStrategy = normalizeStrategy(strategy);
  assertSemanticTransferRegistration({
    scenario: normalizedScenario,
    strategy: normalizedStrategy,
  });

  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.TOOL) {
    return transferToolStrategy({
      ...options,
      strategy: normalizedStrategy,
      runtime,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.WORKFLOW) {
    return transferBotPluginStrategy({
      ...options,
      strategy: normalizedStrategy,
      runtime,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS) {
    return transferAgentPluginStrategy({
      ...options,
      strategy: normalizedStrategy,
      runtime,
    });
  }
  throw new Error(`semantic_transfer_scenario_unhandled:${normalizedScenario}`);
}
