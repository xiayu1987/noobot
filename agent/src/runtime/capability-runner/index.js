/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveDefaultModelSpec,
  resolveModelSpecByName,
  adaptToolsForBinding,
  normalizeToolCalls,
} from "../../models/index.js";
import { executeToolCallInTurn } from "../tool-execution/tool-runner.js";
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromRuntime,
  getToolsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";
import { PLUGIN_MODEL_HEADER_KEY } from "../../models/headers/plugin-headers.js";
import { resolveHookClientEmitter } from "../../extensions/hooks/index.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { emitMessageEvent } from "../../events/message-event-stream.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  requireModelContextSequencePolicy,
  validateModelResponse,
} from "@noobot/model-protocol";
import { validateConfigSnapshot } from "@noobot/agent-config-protocol";

export const MAX_MINI_RUNNER_TOOL_TURNS = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;
export const GUIDANCE_ANALYSIS_RESPONSE_EVENT = "guidance_analysis_response";

function normalizeTextContent(content = "") {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

function compactToolMessagesForMiniRunner(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((messageItem = {}) => {
    const role = String(messageItem?.role || messageItem?.lc_kwargs?.role || "")
      .trim()
      .toLowerCase();
    if (role !== "tool") return messageItem;
    return {
      ...messageItem,
      content: compactToolResultTextForModel(
        messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "",
      ),
    };
  });
}

function resolveRuntime(ctx = {}) {
  return getRuntimeFromAgentContext(ctx?.agentContext || {});
}

function resolveSessionMeta(ctx = {}, runtime = {}) {
  const identity = getSessionIdsFromAgentContext(ctx.agentContext);
  return {
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
  };
}

function resolveAllowPolicy(input = []) {
  const normalized = (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const allowAll = normalized.includes("*");
  return {
    allowAll,
    allowSet: new Set(allowAll ? normalized.filter((item) => item !== "*") : normalized),
  };
}

function resolveToolsFromContext(ctx = {}, allowPolicy = { allowAll: false, allowSet: new Set() }) {
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

function buildPluginCapabilityLogBase({
  purpose = "",
  domain = "",
  pluginFlow = "",
  chain = "",
  modelName = "",
  sessionMeta = {},
  ctx = {},
} = {}) {
  const runtime = resolveRuntime(ctx);
  const normalizedPluginFlow = String(pluginFlow || "").trim();
  const normalizedChain = String(chain || "").trim();
  return {
    category: "system",
    type: "system",
    purpose: String(purpose || "").trim(),
    domain: String(domain || "").trim(),
    ...(normalizedPluginFlow ? { pluginFlow: normalizedPluginFlow } : {}),
    ...(normalizedChain ? { chain: normalizedChain } : {}),
    model: String(modelName || "").trim(),
    sessionId: String(sessionMeta?.sessionId || ""),
    parentSessionId: String(sessionMeta?.parentSessionId || ""),
    dialogProcessId: String(ctx?.dialogProcessId || runtime?.dialogProcessId || ""),
  };
}

async function emitPluginCapabilityRealtimeLog({
  ctx = {},
  event = "",
  text = "",
  data = {},
} = {}) {
  const normalizedText = String(text || "").trim();
  if (!event) return;
  const isWorkflowSemanticResponse =
    event === "plugin_capability_response" &&
    String(data?.purpose || "").trim() === "workflow_semantic" &&
    String(data?.domain || "").trim() === "workflow";
  const isGuidanceAnalysisResponse =
    event === "plugin_capability_response" &&
    String(data?.purpose || "").trim() === "guidance" &&
    String(data?.pluginFlow || "").trim() === "analysis" &&
    String(data?.chain || "").trim() === "auxiliary";
  if (event === "plugin_capability_response") {
    if (!isGuidanceAnalysisResponse && !isWorkflowSemanticResponse) return;
  }
  if (isGuidanceAnalysisResponse || isWorkflowSemanticResponse) {
    const canonicalOutput = String(data?.output || "").trim();
    if (!canonicalOutput) {
      throw new Error("guidance analysis response is missing canonical output");
    }
    const runtime = resolveRuntime(ctx);
    const sessionMeta = resolveSessionMeta(ctx, runtime);
    const activityKind = isGuidanceAnalysisResponse ? "guidance_analysis" : "workflow_semantic";
    const activityEvent = isGuidanceAnalysisResponse
      ? GUIDANCE_ANALYSIS_RESPONSE_EVENT
      : "workflow_semantic_response";
    await emitMessageEvent(runtime?.eventListener, runtime, MESSAGE_EVENT_TYPE.THINKING, {
      event: activityEvent,
      type: activityKind,
      category: "system",
      text: canonicalOutput,
      purpose: String(data?.purpose || "").trim(),
      pluginFlow: String(data?.pluginFlow || "").trim(),
      chain: String(data?.chain || "").trim(),
      activityKind,
      rawEvent: "plugin_capability_response",
      ...sessionMeta,
      dialogProcessId: String(ctx?.dialogProcessId || runtime?.dialogProcessId || "").trim(),
    });
    return;
  }
  if (!normalizedText) return;
  const emitClientEvent = resolveHookClientEmitter(ctx);
  if (!emitClientEvent) return;
  emitClientEvent(event, {
    ...data,
    event,
    text: normalizedText,
  });
}

export function createAgentCapabilityModelInvoker({
  maxTurns = MAX_MINI_RUNNER_TOOL_TURNS,
  toolAllowlist = [],
  enableToolBinding = false,
  headerNamespace = "plugin",
  flowPrefix = "",
  configSnapshot,
  resolveDefaultModelSpecFn = resolveDefaultModelSpec,
  resolveModelSpecByNameFn = resolveModelSpecByName,
  adaptToolsForBindingFn = adaptToolsForBinding,
  executeToolCallFn = executeToolCallInTurn,
} = {}) {
  const effectiveConfig = validateConfigSnapshot(configSnapshot).config;
  const baseAllowPolicy = resolveAllowPolicy(toolAllowlist);
  const maxTurnCount =
    Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0
      ? Math.min(Number(maxTurns), MAX_MINI_RUNNER_TOOL_TURNS)
      : MAX_MINI_RUNNER_TOOL_TURNS;

  return async function capabilityModelInvoker({
    purpose = "",
    domain = "",
    pluginFlow = "",
    chain = "",
    model: modelName = "",
    locale = "zh-CN",
    prompt = "",
    messages = [],
    ctx = {},
    toolAllowlist: toolAllowlistOverride = undefined,
    headerNamespace: headerNamespaceOverride = "",
    flowPrefix: flowPrefixOverride = "",
    contextSequencePolicy = MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
  } = {}) {
    const runtime = resolveRuntime(ctx);
    const sessionMeta = resolveSessionMeta(ctx, runtime);
    const runMessages = compactToolMessagesForMiniRunner(filterForModelContext(messages));
    if (prompt) {
      runMessages.unshift({ role: "system", content: String(prompt) });
    }

    const normalizedModelName = String(modelName || "").trim();
    const pluginCapabilityLogBase = buildPluginCapabilityLogBase({
      purpose,
      domain,
      pluginFlow,
      chain,
      modelName: normalizedModelName,
      sessionMeta,
      ctx,
    });
    const normalizedPurpose = normalizeHeaderValue(purpose || "unknown");
    const normalizedDomain = normalizeHeaderValue(domain || "unknown");
    const normalizedContextSequencePolicy =
      requireModelContextSequencePolicy(contextSequencePolicy);
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
    const modelSpec = normalizedModelName
      ? resolveModelSpecByNameFn({
          modelName: normalizedModelName,
          globalConfig: effectiveConfig,
          userConfig: {},
        })
      : resolveDefaultModelSpecFn({ globalConfig: effectiveConfig, userConfig: {} });
    const modelPort = runtime?.modelPort;
    if (!modelPort || typeof modelPort.invoke !== "function") {
      throw new TypeError("capability model execution requires the host ModelPort");
    }

    if (enableToolBinding !== true) {
      const ai = validateModelResponse(
        await modelPort.invoke({
          model: modelSpec,
          messages: runMessages,
          options: {
            streaming: false,
            signal: runtime?.abortSignal || null,
            headers: additionalHeaders,
          },
          invocation: {
            flow: flowValue,
            purpose: normalizedPurpose,
            domain: normalizedDomain,
            contextSequencePolicy: normalizedContextSequencePolicy,
          },
        }),
      );
      const text = String(ai?.output?.text || "");
      await emitPluginCapabilityRealtimeLog({
        ctx,
        event: "plugin_capability_response",
        text: `Plugin 模型返回 / ${purpose || "unknown"}${text ? `\n${text}` : ""}`,
        data: {
          ...pluginCapabilityLogBase,
          output: text,
          finishedReason: "tool_binding_disabled",
          turn: 1,
        },
      });
      return ai;
    }

    const effectiveAllowPolicy = Array.isArray(toolAllowlistOverride)
      ? resolveAllowPolicy(toolAllowlistOverride)
      : baseAllowPolicy;
    const tools = resolveToolsFromContext(ctx, effectiveAllowPolicy);
    const adapted = adaptToolsForBindingFn(tools, {
      globalConfig: effectiveConfig,
      userConfig: {},
    });
    const boundTools = Array.isArray(adapted?.tools) ? adapted.tools : [];
    const bindOptions =
      adapted?.bindOptions && typeof adapted.bindOptions === "object" ? adapted.bindOptions : {};
    const toolMap = new Map(
      boundTools
        .map((tool) => [String(tool?.name || "").trim(), tool])
        .filter(([name]) => Boolean(name)),
    );

    for (let turn = 1; turn <= maxTurnCount; turn += 1) {
      const ai = validateModelResponse(
        await modelPort.invoke({
          model: modelSpec,
          messages: runMessages,
          tools: boundTools,
          options: {
            streaming: false,
            signal: runtime?.abortSignal || null,
            headers: additionalHeaders,
            toolBinding: bindOptions,
          },
          invocation: {
            flow: flowValue,
            purpose: normalizedPurpose,
            domain: normalizedDomain,
            contextSequencePolicy: normalizedContextSequencePolicy,
          },
        }),
      );
      const text = String(ai?.output?.text || "");
      const { calls } = normalizeToolCalls(ai.output);
      if (text || calls.length) {
        runMessages.push({
          role: "assistant",
          content: text,
          tool_calls: ai.output.toolCalls || [],
        });
      }
      if (!calls.length) {
        await emitPluginCapabilityRealtimeLog({
          ctx,
          event: "plugin_capability_response",
          text: `Plugin 模型返回 / ${purpose || "unknown"}${text ? `\n${text}` : ""}`,
          data: {
            ...pluginCapabilityLogBase,
            output: text,
            finishedReason: "no_tool_call",
            turn,
          },
        });
        return ai;
      }

      for (const call of calls) {
        if (
          effectiveAllowPolicy?.allowAll !== true &&
          effectiveAllowPolicy?.allowSet?.size &&
          !effectiveAllowPolicy.allowSet.has(call.name)
        ) {
          runMessages.push({
            role: "tool",
            tool_call_id: call.id || "",
            content: JSON.stringify({ ok: false, error: `tool not allowed: ${call.name}` }),
          });
          continue;
        }
        const tool = toolMap.get(call.name) || null;
        if (!tool) {
          runMessages.push({
            role: "tool",
            tool_call_id: call.id || "",
            content: JSON.stringify({ ok: false, error: `tool not found: ${call.name}` }),
          });
          continue;
        }
        const result = await executeToolCallFn({
          call,
          tool,
          executionScope: "auxiliary",
          abortSignal: runtime?.abortSignal || null,
          eventListener: runtime?.eventListener || null,
          turn,
          errorLogger: null,
          userId: sessionMeta.userId,
          sessionId: sessionMeta.sessionId,
          parentSessionId: sessionMeta.parentSessionId,
          runtime,
          agentContext: ctx?.agentContext || null,
        });
        runMessages.push({
          role: "tool",
          tool_call_id: call.id || "",
          content: String(result?.toolResultText || ""),
        });
      }
    }

    const finalizePrompt =
      locale === "en-US"
        ? "Based on the above tool results, provide the final planning answer now."
        : "请基于以上工具结果，立即给出最终规划答案。";
    const finalAi = validateModelResponse(
      await modelPort.invoke({
        model: modelSpec,
        messages: [{ role: "system", content: finalizePrompt }, ...runMessages],
        options: {
          streaming: false,
          signal: runtime?.abortSignal || null,
          headers: additionalHeaders,
        },
        invocation: {
          flow: flowValue,
          purpose: normalizedPurpose,
          domain: normalizedDomain,
          contextSequencePolicy: normalizedContextSequencePolicy,
        },
      }),
    );
    const finalizedText = String(finalAi.output.text || "");

    await emitPluginCapabilityRealtimeLog({
      ctx,
      event: "plugin_capability_response",
      text: `Plugin 模型返回 / ${purpose || "unknown"}${finalizedText ? `\n${finalizedText}` : ""}`,
      data: {
        ...pluginCapabilityLogBase,
        output: finalizedText,
        finishedReason: "max_turn_reached_finalized",
        turn: maxTurnCount,
        toolTurnLimitReached: true,
      },
    });

    return finalAi;
  };
}
