/*
 * Capability mini-runner for plugin-side external model calls.
 * Independent entry + reuse existing Noobot model/tool core.
 */
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
  adaptToolsForBinding,
  normalizeToolCalls,
} from "../../../model/index.js";
import { executeToolCall } from "../execution/tool-runner.js";
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../../context/parent-session-id-resolver.js";
import { compactToolResultTextForModel } from "../../../semantic-transfer/core/compact.js";
import {
  PLUGIN_MODEL_HEADER_KEY,
} from "../../../model/headers/plugin-headers.js";
import { resolveBoundToolModelRequestOverrides } from "../turn/tool-choice-strategy.js";

export const MAX_MINI_RUNNER_TOOL_TURNS = 5;

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
    const role = String(messageItem?.role || messageItem?.lc_kwargs?.role || "").trim().toLowerCase();
    if (role !== "tool") return messageItem;
    return {
      ...messageItem,
      content: compactToolResultTextForModel(messageItem?.content ?? messageItem?.lc_kwargs?.content ?? ""),
    };
  });
}

function resolveRuntime(ctx = {}) {
  return getRuntimeFromAgentContext(ctx?.agentContext || {});
}

function resolveSessionMeta(ctx = {}, runtime = {}) {
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  return {
    userId: String(ctx?.userId || runtime?.userId || systemRuntime?.userId || "").trim(),
    sessionId: String(ctx?.sessionId || runtime?.sessionId || systemRuntime?.sessionId || "").trim(),
    parentSessionId: resolveParentSessionId({
      context: ctx,
      runtime,
      parentSessionId: ctx?.parentSessionId,
    }),
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
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return [];
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

export function createAgentCapabilityModelInvoker({
  maxTurns = MAX_MINI_RUNNER_TOOL_TURNS,
  toolAllowlist = [],
  enableToolBinding = false,
  headerNamespace = "plugin",
  flowPrefix = "",
  fallbackGlobalConfig = null,
  fallbackUserConfig = null,
  createChatModelFn = createChatModel,
  createChatModelByNameFn = createChatModelByName,
  resolveDefaultModelSpecFn = resolveDefaultModelSpec,
  resolveModelSpecByNameFn = resolveModelSpecByName,
  adaptToolsForBindingFn = adaptToolsForBinding,
  executeToolCallFn = executeToolCall,
} = {}) {
  const baseAllowPolicy = resolveAllowPolicy(toolAllowlist);
  const maxTurnCount =
    Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0
      ? Math.min(Number(maxTurns), MAX_MINI_RUNNER_TOOL_TURNS)
      : MAX_MINI_RUNNER_TOOL_TURNS;

  function buildDefaultCapabilityOutput({ targetLocale = "zh-CN", targetPurpose = "" } = {}) {
    const isEn = String(targetLocale || "").trim().toLowerCase() === "en-us";
    const purposeValue = String(targetPurpose || "").trim().toLowerCase();
    if (purposeValue.includes("planning")) {
      return JSON.stringify(
        {
          taskOwner: "primary_task_owner",
          taskChecklist: isEn
            ? [
                { index: 1, task: "Clarify scope and constraints", owner: "primary_task_owner", subOwners: [] },
                { index: 2, task: "Implement minimal safe solution", owner: "primary_task_owner", subOwners: [] },
                { index: 3, task: "Validate and summarize next actions", owner: "primary_task_owner", subOwners: [] },
              ]
            : [
                { index: 1, task: "澄清范围与约束", owner: "primary_task_owner", subOwners: [] },
                { index: 2, task: "实现最小可行且安全的方案", owner: "primary_task_owner", subOwners: [] },
                { index: 3, task: "完成验证并给出后续建议", owner: "primary_task_owner", subOwners: [] },
              ],
          meta: {
            source: "mini_runner_default",
            reason: "tool_turn_limit_reached",
            maxToolTurns: MAX_MINI_RUNNER_TOOL_TURNS,
          },
        },
        null,
        0,
      );
    }
    return isEn
      ? `Tool turn limit reached (${MAX_MINI_RUNNER_TOOL_TURNS}). Please proceed with a conservative answer and clear next-step suggestions.`
      : `已达到工具调用轮数上限（${MAX_MINI_RUNNER_TOOL_TURNS}）。请基于当前信息给出保守结论与下一步建议。`;
  }

  return async function capabilityModelInvoker({
    purpose = "",
    domain = "",
    model: modelName = "",
    locale = "zh-CN",
    prompt = "",
    messages = [],
    ctx = {},
    toolAllowlist: toolAllowlistOverride = undefined,
    headerNamespace: headerNamespaceOverride = "",
    flowPrefix: flowPrefixOverride = "",
  } = {}) {
    const runtime = resolveRuntime(ctx);
    const sessionMeta = resolveSessionMeta(ctx, runtime);
    const traces = [];
    const runMessages = compactToolMessagesForMiniRunner(filterForModelContext(messages));
    if (prompt) {
      runMessages.unshift({ role: "system", content: String(prompt) });
    }

    const globalConfig =
      runtime?.globalConfig && typeof runtime.globalConfig === "object"
        ? runtime.globalConfig
        : fallbackGlobalConfig && typeof fallbackGlobalConfig === "object"
          ? fallbackGlobalConfig
          : {};
    const userConfig =
      runtime?.userConfig && typeof runtime.userConfig === "object"
        ? runtime.userConfig
        : fallbackUserConfig && typeof fallbackUserConfig === "object"
          ? fallbackUserConfig
          : {};
    const normalizedModelName = String(modelName || "").trim();
    const normalizedPurpose = normalizeHeaderValue(purpose || "unknown");
    const normalizedDomain = normalizeHeaderValue(domain || "unknown");
    const resolvedHeaderNamespace = normalizeHeaderValue(
      headerNamespaceOverride || headerNamespace || "plugin",
    ).toLowerCase() || "plugin";
    const resolvedFlowPrefix = normalizeHeaderValue(
      flowPrefixOverride || flowPrefix || resolvedHeaderNamespace,
    ).toLowerCase() || resolvedHeaderNamespace;
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
    const flowValue = `${resolvedFlowPrefix}.${normalizedPurpose}`;
    const resolvedSessionId = String(sessionMeta?.sessionId || "").trim();
    const additionalHeaders = {
      [customFlowHeaderKey]: flowValue,
      [customPurposeHeaderKey]: normalizedPurpose,
      [customDomainHeaderKey]: normalizedDomain,
      ...(resolvedSessionId ? { [customSessionHeaderKey]: resolvedSessionId } : {}),
    };
    const llm = normalizedModelName
      ? createChatModelByNameFn(normalizedModelName, {
          globalConfig,
          userConfig,
          streaming: false,
          context: {
            runtime,
            agentContext: ctx?.agentContext || null,
            sessionId: resolvedSessionId,
          },
          additionalHeaders,
        })
      : createChatModelFn({
          globalConfig,
          userConfig,
          streaming: false,
          context: {
            runtime,
            agentContext: ctx?.agentContext || null,
            sessionId: resolvedSessionId,
          },
          additionalHeaders,
        });
    const modelSpec = normalizedModelName
      ? resolveModelSpecByNameFn({
          modelName: normalizedModelName,
          globalConfig,
          userConfig,
          fallbackToDefault: false,
        })
      : resolveDefaultModelSpecFn({ globalConfig, userConfig });

    if (enableToolBinding !== true) {
      const ai = await llm.invoke(runMessages, {
        signal: runtime?.abortSignal || null,
      });
      const text = normalizeTextContent(ai?.content);
      return {
        content: text,
        output: text,
        traces: [],
        turn: 1,
        finishedReason: "tool_binding_disabled",
        toolTurnLimitReached: false,
      };
    }

    const effectiveAllowPolicy = Array.isArray(toolAllowlistOverride)
      ? resolveAllowPolicy(toolAllowlistOverride)
      : baseAllowPolicy;
    const tools = resolveToolsFromContext(ctx, effectiveAllowPolicy);
    const adapted = adaptToolsForBindingFn(tools, {
      globalConfig,
      userConfig,
    });
    const boundTools = Array.isArray(adapted?.tools) ? adapted.tools : [];
    const bindOptions =
      adapted?.bindOptions && typeof adapted.bindOptions === "object"
        ? adapted.bindOptions
        : {};
    const model = boundTools.length
      ? Object.keys(bindOptions).length
        ? llm.bindTools(boundTools, bindOptions)
        : llm.bindTools(boundTools)
      : llm;
    const toolMap = new Map(
      boundTools
        .map((tool) => [String(tool?.name || "").trim(), tool])
        .filter(([name]) => Boolean(name)),
    );

    let lastAssistantText = "";
    let toolTurnLimitReached = false;
    for (let turn = 1; turn <= maxTurnCount; turn += 1) {
      const ai = await model.invoke(runMessages, {
        signal: runtime?.abortSignal || null,
        ...(boundTools.length ? resolveBoundToolModelRequestOverrides(modelSpec || {}) : {}),
      });
      const text = normalizeTextContent(ai?.content);
      lastAssistantText = text;
      const { calls } = normalizeToolCalls(ai);
      traces.push({
        turn,
        purpose,
        domain,
        model: normalizedModelName || undefined,
        locale,
        toolCalls: calls.map((call) => ({ name: call.name, id: call.id || "", status: "pending" })),
      });
      const currentTrace = traces[traces.length - 1];
      if (text || calls.length) {
        runMessages.push(ai);
      }
      if (!calls.length) {
        return {
          content: text,
          output: text,
          traces,
          turn,
          finishedReason: "no_tool_call",
          toolTurnLimitReached: false,
        };
      }

      for (const call of calls) {
        if (
          effectiveAllowPolicy?.allowAll !== true &&
          effectiveAllowPolicy?.allowSet?.size &&
          !effectiveAllowPolicy.allowSet.has(call.name)
        ) {
          currentTrace.toolCalls = currentTrace.toolCalls.map((item) =>
            item.name === call.name && item.id === (call.id || "")
              ? { ...item, status: "rejected", error: `tool not allowed: ${call.name}` }
              : item,
          );
          runMessages.push({
            role: "tool",
            tool_call_id: call.id || "",
            content: JSON.stringify({ ok: false, error: `tool not allowed: ${call.name}` }),
          });
          continue;
        }
        const tool = toolMap.get(call.name) || null;
        if (!tool) {
          currentTrace.toolCalls = currentTrace.toolCalls.map((item) =>
            item.name === call.name && item.id === (call.id || "")
              ? { ...item, status: "not_found", error: `tool not found: ${call.name}` }
              : item,
          );
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
        currentTrace.toolCalls = currentTrace.toolCalls.map((item) =>
          item.name === call.name && item.id === (call.id || "")
            ? { ...item, status: "executed" }
            : item,
        );
        runMessages.push({
          role: "tool",
          tool_call_id: call.id || "",
          content: String(result?.toolResultText || ""),
        });
      }
    }
    toolTurnLimitReached = true;
    if (traces.length) {
      traces[traces.length - 1] = {
        ...traces[traces.length - 1],
        toolTurnLimitReached: true,
      };
    }

    let finalizedText = lastAssistantText;
    if (!finalizedText) {
      const finalizePrompt =
        locale === "en-US"
          ? "Based on the above tool results, provide the final planning answer now."
          : "请基于以上工具结果，立即给出最终规划答案。";
      try {
        const finalAi = await llm.invoke(
          [{ role: "system", content: finalizePrompt }, ...runMessages],
          { signal: runtime?.abortSignal || null },
        );
        finalizedText = normalizeTextContent(finalAi?.content);
      } catch {
        finalizedText = "";
      }
    }
    if (!finalizedText) {
      finalizedText = buildDefaultCapabilityOutput({
        targetLocale: locale,
        targetPurpose: purpose,
      });
    }

    return {
      content: finalizedText,
      output: finalizedText,
      traces,
      turn: maxTurnCount,
      finishedReason: finalizedText ? "max_turn_reached_finalized" : "max_turn_reached",
      toolTurnLimitReached,
    };
  };
}
