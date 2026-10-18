/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveDefaultModelSpec,
  resolveModelSpecByName,
  adaptToolsForBinding,
} from "../../models/index.js";
import { executeToolCallInTurn } from "../tool-execution/tool-runner.js";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { validateConfigSnapshot } from "@noobot/agent-config-protocol";
import {
  createCapabilityRequestIdentity,
  prepareCapabilityMessages,
  requireCapabilityFlowPrefix,
  resolveAllowPolicy,
  resolveCapabilityExecution,
  resolveToolsFromContext,
} from "./request-context.js";
import { createCapabilityModelStep } from "./model-step.js";
import { createCapabilityToolBinding, runCapabilityToolTurns } from "./tool-turns.js";
import { text } from "@noobot/shared/value";

export const MAX_MINI_RUNNER_TOOL_TURNS = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;

export function createAgentCapabilityModelInvoker({
  maxTurns = MAX_MINI_RUNNER_TOOL_TURNS,
  toolAllowlist = [],
  enableToolBinding = false,
  pluginId,
  configSnapshot,
  resolveDefaultModelSpecFn = resolveDefaultModelSpec,
  resolveModelSpecByNameFn = resolveModelSpecByName,
  adaptToolsForBindingFn = adaptToolsForBinding,
  executeToolCallFn = executeToolCallInTurn,
} = {}) {
  const flowPrefix = requireCapabilityFlowPrefix(pluginId);
  const effectiveConfig = validateConfigSnapshot(configSnapshot).config;
  const baseAllowPolicy = resolveAllowPolicy(toolAllowlist);
  const maxTurnCount =
    Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0
      ? Math.min(Number(maxTurns), MAX_MINI_RUNNER_TOOL_TURNS)
      : MAX_MINI_RUNNER_TOOL_TURNS;

  return async function capabilityModelInvoker({
    purpose,
    domain,
    pluginFlow = "",
    chain = "",
    relayCorrelationId = "",
    model: modelName,
    locale = "zh-CN",
    prompt = "",
    messages = [],
    ctx = {},
    toolAllowlist: toolAllowlistOverride,
    signal,
    activity = null,
    contextSequencePolicy = MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
  } = {}) {
    const execution = resolveCapabilityExecution(ctx, signal);
    const runMessages = prepareCapabilityMessages(messages, prompt);
    const identity = createCapabilityRequestIdentity({
      purpose,
      domain,
      pluginFlow,
      contextSequencePolicy,
      flowPrefix,
      sessionId: getSessionIdsFromAgentContext(ctx.agentContext).sessionId,
    });
    const normalizedModelName = text(modelName);
    const modelSpec = normalizedModelName
      ? resolveModelSpecByNameFn({
          modelName: normalizedModelName,
          globalConfig: effectiveConfig,
          userConfig: {},
        })
      : resolveDefaultModelSpecFn({ globalConfig: effectiveConfig, userConfig: {} });
    const invokeStep = createCapabilityModelStep({
      runtime: execution.runtime,
      model: modelSpec,
      identity,
      signal: execution.abortSignal,
      activity,
      metadata: { purpose: identity.invocation.purpose, pluginFlow, chain, relayCorrelationId },
    });
    if (enableToolBinding !== true) {
      const step = await invokeStep(runMessages);
      return step.complete();
    }
    const allowPolicy = Array.isArray(toolAllowlistOverride)
      ? resolveAllowPolicy(toolAllowlistOverride)
      : baseAllowPolicy;
    const tools = resolveToolsFromContext(ctx, allowPolicy);
    const binding = createCapabilityToolBinding(adaptToolsForBindingFn(tools, modelSpec));
    return runCapabilityToolTurns({
      invokeStep,
      messages: runMessages,
      binding,
      allowPolicy,
      maxTurns: maxTurnCount,
      executeToolCall: executeToolCallFn,
      locale,
      execution,
    });
  };
}
