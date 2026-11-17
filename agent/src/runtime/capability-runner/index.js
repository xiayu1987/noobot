/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveEffectiveProvider, adaptToolsForBinding } from "../../models/index.js";
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

export function createAgentCapabilityModelInvoker({
  maxTurns,
  toolAllowlist = [],
  enableToolBinding = false,
  pluginId,
  configSnapshot,
  resolveEffectiveProviderFn = resolveEffectiveProvider,
  adaptToolsForBindingFn = adaptToolsForBinding,
  executeToolCallFn = executeToolCallInTurn,
} = {}) {
  const flowPrefix = requireCapabilityFlowPrefix(pluginId);
  const effectiveConfig = validateConfigSnapshot(configSnapshot).config;
  const baseAllowPolicy = resolveAllowPolicy(toolAllowlist);
  const turnCap = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;
  const maxTurnCount =
    Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0
      ? Math.min(Number(maxTurns), turnCap)
      : turnCap;

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
    streaming,
    streamingRequired,
    bindTools = enableToolBinding,
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
    const modelSpec = resolveEffectiveProviderFn(
      text(modelName) || effectiveConfig.defaultProvider,
      effectiveConfig,
    );
    const invokeStep = createCapabilityModelStep({
      runtime: execution.runtime,
      model: modelSpec,
      identity,
      signal: execution.abortSignal,
      streaming: streaming === undefined ? execution.runtime.runConfig.streaming : streaming,
      streamingRequired,
      activity,
      metadata: { purpose: identity.invocation.purpose, pluginFlow, chain, relayCorrelationId },
    });
    if (bindTools !== true) {
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
