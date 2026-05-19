/*
 * Capability mini-runner for harness external model calls.
 * Independent entry + reuse existing Noobot model/tool core.
 */
import { createChatModel, adaptToolsForBinding } from "../../../model/index.js";
import { executeToolCall } from "../execution/tool-runner.js";

function normalizeToolCalls(ai = {}) {
  const rawCalls = Array.isArray(ai?.tool_calls)
    ? ai.tool_calls
    : Array.isArray(ai?.toolCalls)
      ? ai.toolCalls
      : Array.isArray(ai?.additional_kwargs?.tool_calls)
        ? ai.additional_kwargs.tool_calls
        : [];
  return rawCalls
    .map((call = {}) => ({
      id: String(
        call?.id ??
          call?.tool_call_id ??
          call?.toolCallId ??
          call?.call_id ??
          "",
      ).trim(),
      name: String(
        call?.name ??
          call?.tool_name ??
          call?.toolName ??
          call?.function?.name ??
          "",
      ).trim(),
      args: normalizeToolArgs(call?.args ?? call?.function?.arguments),
    }))
    .filter((call) => call.name);
}

function normalizeToolArgs(args = {}) {
  if (args && typeof args === "object" && !Array.isArray(args)) return args;
  if (typeof args !== "string") return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || {};
}

function resolveSessionMeta(ctx = {}, runtime = {}) {
  const systemRuntime =
    runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : {};
  return {
    userId: String(ctx?.userId || runtime?.userId || systemRuntime?.userId || "").trim(),
    sessionId: String(ctx?.sessionId || runtime?.sessionId || systemRuntime?.sessionId || "").trim(),
    parentSessionId: String(ctx?.parentSessionId || systemRuntime?.parentSessionId || "").trim(),
  };
}

function resolveToolsFromContext(ctx = {}, allowSet = new Set()) {
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return [];
  const tools = registry.filter((tool) => String(tool?.name || "").trim());
  if (!allowSet.size) return tools;
  return tools.filter((tool) => allowSet.has(String(tool?.name || "").trim()));
}

export function createAgentCapabilityModelInvoker({
  maxTurns = 4,
  toolAllowlist = [],
  createChatModelFn = createChatModel,
  adaptToolsForBindingFn = adaptToolsForBinding,
  executeToolCallFn = executeToolCall,
} = {}) {
  const allowSet = new Set(
    (Array.isArray(toolAllowlist) ? toolAllowlist : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  const maxTurnCount =
    Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0 ? Number(maxTurns) : 4;

  return async function capabilityModelInvoker({
    purpose = "",
    domain = "",
    locale = "zh-CN",
    prompt = "",
    messages = [],
    ctx = {},
  } = {}) {
    const runtime = resolveRuntime(ctx);
    const sessionMeta = resolveSessionMeta(ctx, runtime);
    const traces = [];
    const runMessages = Array.isArray(messages) ? [...messages] : [];
    if (prompt) {
      runMessages.unshift({ role: "system", content: String(prompt) });
    }

    const globalConfig = runtime?.globalConfig || {};
    const userConfig = runtime?.userConfig || {};
    const llm = createChatModelFn({
      globalConfig,
      userConfig,
      streaming: false,
    });

    const tools = resolveToolsFromContext(ctx, allowSet);
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

    for (let turn = 1; turn <= maxTurnCount; turn += 1) {
      const ai = await model.invoke(runMessages, {
        signal: runtime?.abortSignal || null,
      });
      const text = normalizeTextContent(ai?.content);
      const calls = normalizeToolCalls(ai);
      traces.push({
        turn,
        purpose,
        domain,
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
        };
      }

      for (const call of calls) {
        if (allowSet.size && !allowSet.has(call.name)) {
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

    return {
      content: "",
      output: "",
      traces,
      turn: maxTurnCount,
      finishedReason: "max_turn_reached",
    };
  };
}
