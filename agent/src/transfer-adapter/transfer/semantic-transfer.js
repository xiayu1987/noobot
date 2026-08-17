/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON } from "../core/constants.js";
import { TRANSFER_SOURCE } from "@noobot/semantic-transfer-protocol";
import { firstNormalizedString } from "../core/compact.js";
import { createDirectTransferEnvelope } from "../storage/attachment-adapter.js";
import { transferToolInput, transferToolOutput } from "./tool-transfer.js";
import { normalizeToolResultOverflow } from "./tool-result-overflow.js";
import { transferBotPluginSubagentResult } from "./subagent-transfer.js";
import {
  composeAgentPluginFinalMessage,
  transferAgentPluginStageMessage,
} from "./plugin-stage-transfer.js";
import {
  SEMANTIC_TRANSFER_REGISTRATION,
  assertSemanticTransferRegistration,
} from "@noobot/semantic-transfer-protocol";

export const SEMANTIC_TRANSFER_SCENARIO =
  SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS;

export const SEMANTIC_TRANSFER_STRATEGY = {
  TOOL_INPUT: "tool_input",
  TOOL_OUTPUT: "tool_output",
  TOOL_RESULT_TEXT: "tool_result_text",
  WORKFLOW_SUBAGENT: "workflow_subagent",
  WORKFLOW_FINAL_PLAN: "workflow_final_plan",
  HARNESS_SUMMARY: "harness_summary",
  HARNESS_PLANNING: "harness_planning",
  HARNESS_ACCEPTANCE: "harness_acceptance",
};

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeScenario(value = "") {
  return normalizeString(value).toLowerCase();
}

function normalizeStrategy(value = "") {
  return normalizeString(value).toLowerCase();
}

function buildInvalidResult({
  code = "SEMANTIC_TRANSFER_INVALID_SCENARIO",
  message = "invalid semantic-transfer request",
} = {}) {
  return {
    transferEnvelopes: [],
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
      source: meta?.source || TRANSFER_SOURCE.SERVICE,
      reason: meta?.reason || TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
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
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.TOOL_RESULT_TEXT) {
    return normalizeToolResultOverflow({
      ...options,
      runtime,
      agentContext,
      identity: options.identity,
      toolResultText:
        options.toolResultText ?? options.text ?? options.content ?? "",
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
    message:
      "tool scenario requires strategy tool_input/tool_output/tool_result_text",
  });
}

async function transferBotPluginStrategy({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  if (
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_SUBAGENT ||
    strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_FINAL_PLAN
  ) {
    return transferBotPluginSubagentResult({
      ...options,
      runtime,
      agentContext,
    });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.WORKFLOW_SUBAGENT) {
    const content = firstNormalizedString(
      options?.content,
      options?.message,
      options?.text,
    );
    if (!content) {
      return {
        transferEnvelopes: [],
      };
    }
    return {
      ...createDirectTextTransfer({
        text: content,
        scenario: SEMANTIC_TRANSFER_SCENARIO.WORKFLOW,
        strategy,
        identity: options.identity,
        meta: { ...(options?.meta || {}), injectionMessage: content },
      }),
    };
  }
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message:
      "workflow scenario requires workflow_subagent or workflow_final_plan strategy",
  });
}

async function transferAgentPluginSummaryInjection({
  strategy = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  const injectMode =
    normalizeString(
      options?.injectMode || options?.summaryInjectMode || "full",
    ).toLowerCase() === "summary"
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
  const detailText = firstNormalizedString(
    options?.detail,
    options?.detailText,
  );
  const injectionMessage =
    injectMode === "summary"
      ? summaryText
      : firstNormalizedString(fullText, summaryText);
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
      generationSource:
        options?.generationSource || "agent_plugin_summary_detail",
      source: options?.source || "plugin",
      reason: options?.reason || "harness_summary",
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
    [SEMANTIC_TRANSFER_STRATEGY.HARNESS_SUMMARY, SEMANTIC_TRANSFER_STRATEGY.HARNESS_PLANNING, SEMANTIC_TRANSFER_STRATEGY.HARNESS_ACCEPTANCE].includes(strategy) &&
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
    strategy === SEMANTIC_TRANSFER_STRATEGY.HARNESS_SUMMARY &&
    (options.fullText !== undefined || options.summaryText !== undefined)
  ) {
    return transferAgentPluginSummaryInjection({
      ...options,
      runtime,
      agentContext,
      strategy,
    });
  }
  if (strategy === SEMANTIC_TRANSFER_STRATEGY.HARNESS_SUMMARY) {
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
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_STRATEGY",
    message: "harness scenario requires harness_summary strategy",
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
  return buildInvalidResult({
    code: "SEMANTIC_TRANSFER_INVALID_SCENARIO",
    message: "scenario is not registered",
  });
}
