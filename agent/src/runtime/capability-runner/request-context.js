/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
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

export function resolveCapabilityExecution(ctx = {}, signal = null) {
  const runtime = getRuntimeFromAgentContext(ctx.agentContext || {});
  const identity = getSessionIdsFromAgentContext(ctx.agentContext);
  return {
    runtime,
    executionScope: "auxiliary",
    abortSignal: signal || runtime?.abortSignal || null,
    eventListener: runtime?.eventListener || null,
    errorLogger: null,
    agentContext: ctx.agentContext || null,
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
  };
}

export function resolveAllowPolicy(input = []) {
  const normalized = (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
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
  const tools = registry.filter((tool) => String(tool?.name || "").trim());
  if (allowPolicy?.allowAll === true) return tools;
  if (!allowPolicy?.allowSet?.size) return [];
  return tools.filter((tool) => allowPolicy.allowSet.has(String(tool?.name || "").trim()));
}

function normalizeHeaderValue(input = "") {
  return String(input || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
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
  headerNamespaceOverride,
  headerNamespace,
  flowPrefixOverride,
  flowPrefix,
  sessionMeta,
}) {
  const normalizedPurpose = normalizeHeaderValue(purpose || "unknown");
  const normalizedDomain = normalizeHeaderValue(domain || "unknown");
  const normalizedContextSequencePolicy = requireModelContextSequencePolicy(contextSequencePolicy);
  const normalizedFlowName = normalizeHeaderValue(pluginFlow || purpose || "unknown");
  const resolvedHeaderNamespace =
    normalizeHeaderValue(headerNamespaceOverride || headerNamespace || "plugin").toLowerCase() ||
    "plugin";
  const resolvedFlowPrefix =
    normalizeHeaderValue(flowPrefixOverride || flowPrefix || resolvedHeaderNamespace) ||
    resolvedHeaderNamespace;
  const isCanonicalPluginNamespace = resolvedHeaderNamespace === "plugin";
  const namespaceHeaderKeys = isCanonicalPluginNamespace
    ? PLUGIN_MODEL_HEADER_KEY
    : {
        FLOW: `X-${resolvedHeaderNamespace}-Flow`,
        PURPOSE: `X-${resolvedHeaderNamespace}-Purpose`,
        DOMAIN: `X-${resolvedHeaderNamespace}-Domain`,
        SESSION_ID: `X-${resolvedHeaderNamespace}-Session-Id`,
      };
  const customFlowHeaderKey = namespaceHeaderKeys.FLOW;
  const customPurposeHeaderKey = namespaceHeaderKeys.PURPOSE;
  const customDomainHeaderKey = namespaceHeaderKeys.DOMAIN;
  const customSessionHeaderKey = namespaceHeaderKeys.SESSION_ID;
  const flowValue = `${resolvedFlowPrefix}.${normalizedFlowName}`;
  const resolvedSessionId = String(sessionMeta?.sessionId || "").trim();
  const additionalHeaders = {
    [customFlowHeaderKey]: flowValue,
    [customPurposeHeaderKey]: normalizedPurpose,
    [customDomainHeaderKey]: normalizedDomain,
    ...(resolvedSessionId ? { [customSessionHeaderKey]: resolvedSessionId } : {}),
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
