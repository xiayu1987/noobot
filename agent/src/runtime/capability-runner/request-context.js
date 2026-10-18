/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getRuntimeFromAgentContext,
  getToolsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import {
  resolveContextMessageRole,
  resolveContextMessageContent,
} from "@noobot/context-protocol/message/codec";
import { PLUGIN_MODEL_HEADER_KEY } from "../../models/headers/plugin-headers.js";
import { requireModelContextSequencePolicy } from "@noobot/model-protocol";
import { text } from "@noobot/shared/value";
import { requireAbortSignal } from "@noobot/session-protocol/execution-abort";

function compactToolMessagesForMiniRunner(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((messageItem = {}) => {
    const role = resolveContextMessageRole(messageItem);
    if (role !== "tool") return messageItem;
    return {
      ...messageItem,
      content: compactToolResultTextForModel(resolveContextMessageContent(messageItem)),
    };
  });
}

export function resolveCapabilityExecution(ctx, signal) {
  requireAbortSignal(signal, "capability model invocation");
  const runtime = getRuntimeFromAgentContext(ctx.agentContext);
  return {
    runtime,
    executionScope: "auxiliary",
    abortSignal: signal,
    errorLogger: null,
    agentContext: ctx.agentContext,
  };
}

export function resolveAllowPolicy(input = []) {
  const normalized = (Array.isArray(input) ? input : []).map((item) => text(item)).filter(Boolean);
  const allowAll = normalized.includes("*");
  return {
    allowAll,
    allowSet: new Set(allowAll ? normalized.filter((item) => item !== "*") : normalized),
  };
}

export function resolveToolsFromContext(
  ctx = {},
  allowPolicy = { allowAll: false, allowSet: new Set() },
) {
  const registry = getToolsFromAgentContext(ctx.agentContext);
  const tools = registry.filter((tool) => text(tool?.name));
  if (allowPolicy?.allowAll === true) return tools;
  if (!allowPolicy?.allowSet?.size) return [];
  return tools.filter((tool) => allowPolicy.allowSet.has(text(tool?.name)));
}

function normalizeHeaderValue(input = "") {
  return text(input)
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function requireCapabilityFlowPrefix(pluginId) {
  const flowPrefix = normalizeHeaderValue(pluginId);
  if (!flowPrefix) throw new TypeError("capability model invoker requires pluginId");
  return flowPrefix;
}

export function prepareCapabilityMessages(messages, prompt) {
  const result = compactToolMessagesForMiniRunner(filterForModelContext(messages));
  if (prompt) result.unshift({ role: "system", content: String(prompt) });
  return result;
}

export function createCapabilityRequestIdentity({
  purpose,
  domain,
  pluginFlow,
  contextSequencePolicy,
  flowPrefix,
  sessionId,
}) {
  const normalizedPurpose = normalizeHeaderValue(purpose || "unknown");
  const normalizedDomain = normalizeHeaderValue(domain || "unknown");
  const normalizedContextSequencePolicy = requireModelContextSequencePolicy(contextSequencePolicy);
  const normalizedFlowName = normalizeHeaderValue(pluginFlow || purpose || "unknown");
  const flowValue = `${flowPrefix}.${normalizedFlowName}`;
  const resolvedSessionId = text(sessionId);
  const additionalHeaders = {
    [PLUGIN_MODEL_HEADER_KEY.FLOW]: flowValue,
    [PLUGIN_MODEL_HEADER_KEY.PURPOSE]: normalizedPurpose,
    [PLUGIN_MODEL_HEADER_KEY.DOMAIN]: normalizedDomain,
    ...(resolvedSessionId ? { [PLUGIN_MODEL_HEADER_KEY.SESSION_ID]: resolvedSessionId } : {}),
  };
  return {
    headers: additionalHeaders,
    invocation: {
      flow: flowValue,
      purpose: normalizedPurpose,
      domain: normalizedDomain,
      contextSequencePolicy: normalizedContextSequencePolicy,
    },
  };
}
