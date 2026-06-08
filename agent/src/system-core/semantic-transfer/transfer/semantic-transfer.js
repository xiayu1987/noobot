/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { transferToolMessage } from "./tool-transfer.js";
import { transferSubAgentMessages } from "./subagent-transfer.js";
import { composeFinalMessage, processStageMessage } from "./harness-transfer.js";

export const SEMANTIC_TRANSFER_SCENARIO = {
  TOOL: "tool",
  SUBAGENT: "subagent",
  HARNESS_STAGE: "harness_stage",
  HARNESS_FINAL: "harness_final",
};

function normalizeScenario(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case SEMANTIC_TRANSFER_SCENARIO.TOOL:
      return SEMANTIC_TRANSFER_SCENARIO.TOOL;
    case SEMANTIC_TRANSFER_SCENARIO.SUBAGENT:
      return SEMANTIC_TRANSFER_SCENARIO.SUBAGENT;
    case SEMANTIC_TRANSFER_SCENARIO.HARNESS_STAGE:
      return SEMANTIC_TRANSFER_SCENARIO.HARNESS_STAGE;
    case SEMANTIC_TRANSFER_SCENARIO.HARNESS_FINAL:
      return SEMANTIC_TRANSFER_SCENARIO.HARNESS_FINAL;
    default:
      return "";
  }
}

function buildInvalidScenarioResult() {
  return {
    transferResult: {
      ok: false,
      status: "failed",
      error: {
        code: "SEMANTIC_TRANSFER_INVALID_SCENARIO",
        message: "scenario must be one of tool/subagent/harness_stage/harness_final",
      },
    },
    transferEnvelope: null,
    transferEnvelopes: [],
  };
}

export function transferSemanticContentSync({
  scenario = "",
  ...options
} = {}) {
  const normalizedScenario = normalizeScenario(scenario);
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS_FINAL) {
    return composeFinalMessage(options || {});
  }
  return buildInvalidScenarioResult();
}

export async function transferSemanticContent({
  scenario = "",
  runtime = {},
  agentContext = null,
  ...options
} = {}) {
  const normalizedScenario = normalizeScenario(scenario);
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.TOOL) {
    return transferToolMessage({
      ...options,
      runtime,
      agentContext,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.SUBAGENT) {
    return transferSubAgentMessages({
      ...options,
      runtime,
      agentContext,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS_STAGE) {
    return processStageMessage({
      ...options,
      runtime,
      agentContext,
    });
  }
  if (normalizedScenario === SEMANTIC_TRANSFER_SCENARIO.HARNESS_FINAL) {
    return transferSemanticContentSync({
      scenario: normalizedScenario,
      ...options,
    });
  }
  return buildInvalidScenarioResult();
}
