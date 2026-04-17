/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import { mergeConfig } from "../config/index.js";
import { emitEvent } from "../event/index.js";

function buildRuntimeSystemPrompt(agentContext) {
  const runtime = agentContext?.runtime || {};
  const sys = runtime.systemRuntime || {};
  const runtimeEnv = {
    cwd: sys.cwd || agentContext?.cwd || runtime.cwd || "",
    basePath: sys.basePath || agentContext?.basePath || runtime.basePath || "",
    sessionId: sys.sessionId || "",
    caller: sys.caller || runtime.caller || "",
    parentSessionId: sys.parentSessionId || runtime.parentSessionId || "",
    platform: sys.platform || agentContext?.platform || runtime.platform || "",
    arch: sys.arch || agentContext?.arch || runtime.arch || "",
    nodeVersion:
      sys.nodeVersion || agentContext?.nodeVersion || runtime.nodeVersion || "",
    now: sys.now || "",
    timezone: sys.timezone || agentContext?.timezone || runtime.timezone || "",
    dialogProcessId: sys.dialogProcessId || runtime.dialogProcessId || "",
    workspaceDirectories:
      sys.workspaceDirectories ||
      agentContext?.workspaceDirectories ||
      runtime.workspaceDirectories ||
      [],
    sessionTree: sys.sessionTree || runtime.sessionTree || {},
  };
  return `# 系统运行环境（非配置）\n${JSON.stringify(runtimeEnv, null, 2)}`;
}

function buildContextMessages(agentContext) {
  function toLangChainToolCalls(toolCalls = []) {
    return (toolCalls || [])
      .map((tc) => {
        if (!tc) return null;
        if (tc.name) {
          return {
            id: tc.id || "",
            name: tc.name,
            args: tc.args || {},
            type: "tool_call",
          };
        }
        const fn = tc.function || {};
        let args = {};
        try {
          args =
            typeof fn.arguments === "string"
              ? JSON.parse(fn.arguments || "{}")
              : fn.arguments || {};
        } catch {
          args = {};
        }
        if (!fn.name) return null;
        return {
          id: tc.id || "",
          name: fn.name,
          args,
          type: "tool_call",
        };
      })
      .filter(Boolean);
  }

  function buildHumanMessageContent(msg = {}) {
    const textContent = String(msg?.content || "");
    const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
    if (!attachments.length) return textContent;

    const attachmentLines = attachments.map((attachmentItem, index) => {
      const attachmentId = String(attachmentItem?.attachmentId || "").trim();
      const name = String(attachmentItem?.name || "").trim();
      const mimeType = String(
        attachmentItem?.mimeType || "application/octet-stream",
      ).trim();
      const size = Number(attachmentItem?.size || 0);
      return `- [${index + 1}] id=${attachmentId || "unknown"}, name=${name || "unknown"}, mimeType=${mimeType}, size=${size}`;
    });

    const attachmentSection = [
      "[附件信息]",
      ...attachmentLines,
      "[/附件信息]",
    ].join("\n");

    if (!textContent.trim()) return attachmentSection;
    return `${textContent}\n\n${attachmentSection}`;
  }

  const out = [];
  for (const content of agentContext?.systemMessages || []) {
    out.push(new SystemMessage(content));
  }
  out.push(new SystemMessage(buildRuntimeSystemPrompt(agentContext)));
  for (const msg of agentContext?.conversationMessages || []) {
    const role = msg.role || "";
    if (role === "assistant") {
      const toolCalls = toLangChainToolCalls(msg.tool_calls || []);
      if (toolCalls.length) {
        out.push(
          new AIMessage({
            content: msg.content || "",
            tool_calls: toolCalls,
          }),
        );
      } else {
        out.push(new AIMessage(msg.content || ""));
      }
      continue;
    }

    if (role === "tool") {
      out.push(
        new ToolMessage({
          tool_call_id: msg.tool_call_id || "",
          content: msg.content || "",
        }),
      );
      continue;
    }

    out.push(new HumanMessage(buildHumanMessageContent(msg)));
  }
  return out;
}

function resolveLlmForTurn(modelState) {
  const { runtime, globalConfig, userConfig, defaultModelSpec, eventListener } =
    modelState;
  const runtimeModel = String(runtime?.runtimeModel || "").trim();

  if (runtimeModel) {
    const runtimeSpec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (
      runtimeSpec?.model &&
      runtimeSpec.model !== modelState.activeModelName
    ) {
      modelState.llm = createChatModelByName(runtimeModel, {
        globalConfig,
        userConfig,
        streaming: Boolean(eventListener?.onEvent),
      });
      modelState.activeModelName = runtimeSpec.model;
      emitEvent(eventListener, "model_switched", {
        alias: runtimeSpec?.alias || "",
        model: runtimeSpec?.model || "",
      });
    }
    return;
  }

  if (
    defaultModelSpec?.model &&
    defaultModelSpec.model !== modelState.activeModelName
  ) {
    modelState.llm = createChatModel({
      globalConfig,
      userConfig,
      streaming: Boolean(eventListener?.onEvent),
    });
    modelState.activeModelName = String(defaultModelSpec.model || "");
    emitEvent(eventListener, "model_switched", {
      alias: defaultModelSpec?.alias || "",
      model: defaultModelSpec?.model || "",
    });
  }
}

async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
  const { tools, messages, traces, turnMessages, dialogProcessId, maxTurns } =
    loopState;
  const { eventListener, runtime, globalConfig, userConfig, defaultModelSpec } =
    modelState;

  if (turn > maxTurns) {
    const limitMsg = `工具调用轮次已达到上限(${maxTurns})，自动结束。`;
    traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
    emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
    return { output: limitMsg, traces, turnMessages };
  }

  resolveLlmForTurn(modelState);

  const toolMap = new Map(
    tools.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );
  emitEvent(eventListener, "llm_call_start", { turn });
  const llmCallbacks = eventListener?.onEvent
    ? [
        {
          handleLLMNewToken: (token) =>
            emitEvent(eventListener, "llm_delta", {
              text: String(token || ""),
            }),
        },
      ]
    : undefined;

  const ai = await modelState.llm.bindTools(tools).invoke(messages, {
    callbacks: llmCallbacks,
  });
  messages.push(ai);
  const calls = ai.tool_calls || [];
  turnMessages.push({
    role: "assistant",
    content: String(ai.content || ""),
    type: calls.length ? "tool_call" : "message",
    dialogProcessId,
    tool_calls: calls.length
      ? calls.map((call) => ({
          id: call.id || "",
          type: "function",
          function: {
            name: call.name || "",
            arguments: JSON.stringify(call.args || {}),
          },
        }))
      : [],
  });
  emitEvent(eventListener, "llm_call_end", {
    turn,
    hasToolCalls: Boolean(calls.length),
  });

  if (!calls.length)
    return { output: String(ai.content || ""), traces, turnMessages };

  emitEvent(eventListener, "tool_calls_detected", {
    turn,
    count: calls.length,
  });
  for (const call of calls) {
    emitEvent(eventListener, "tool_call_start", {
      turn,
      tool: call.name,
      args: call.args || {},
    });
    const tool = toolMap.get(call.name);
    if (!tool) {
      const notFoundMsg = `tool not found: ${call.name}`;
      traces.push({
        tool: call.name,
        args: call.args || {},
        result: notFoundMsg,
      });
      messages.push(
        new ToolMessage({ tool_call_id: call.id, content: notFoundMsg }),
      );
      turnMessages.push({
        role: "tool",
        content: String(notFoundMsg),
        type: "tool_result",
        dialogProcessId,
        tool_call_id: call.id || "",
      });
      continue;
    }

    let toolResultText = "";
    try {
      const result = await tool.invoke(call.args || {});
      toolResultText =
        typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      toolResultText = `tool invoke error: ${error?.message || String(error)}`;
    }

    traces.push({
      tool: call.name,
      args: call.args || {},
      result: String(toolResultText).slice(0, 1000),
    });
    emitEvent(eventListener, "tool_call_end", {
      turn,
      tool: call.name,
      result: String(toolResultText).slice(0, 200),
    });
    messages.push(
      new ToolMessage({
        tool_call_id: call.id,
        content: String(toolResultText),
      }),
    );
    turnMessages.push({
      role: "tool",
      content: String(toolResultText),
      type: "tool_result",
      dialogProcessId,
      tool_call_id: call.id || "",
    });
  }

  return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
}

function filterAgentCollabToolsByDepth({
  agentContext,
  effectiveConfig,
  eventListener,
}) {
  const tools = Array.isArray(agentContext?.tools) ? agentContext.tools : [];
  const runtime = agentContext?.runtime || {};
  const parentSessionId = String(runtime?.parentSessionId || "").trim();
  const userId = String(runtime?.userId || "").trim();
  const sessionManager = runtime?.sessionManager || null;
  const configuredMaxParentDepth = Number(
    effectiveConfig?.async?.maxSubAgentDepth ??
      effectiveConfig?.async?.delegateToolParentMaxDepth ??
      0,
  );
  const maxParentDepth =
    Number.isFinite(configuredMaxParentDepth) && configuredMaxParentDepth > 0
      ? configuredMaxParentDepth
      : 1;

  if (
    !parentSessionId ||
    !sessionManager ||
    !userId
  ) {
    return tools;
  }

  let parentDepth = 0;
  try {
    parentDepth = Number(
      sessionManager.getSessionDepth({
        userId,
        sessionId: parentSessionId,
      }) || 0,
    );
  } catch {
    parentDepth = 0;
  }

  if (parentDepth < maxParentDepth) return tools;

  const blockedToolNames = new Set([
    "delegate_task_async",
    "wait_async_task_result",
    "delegateTaskAsync",
    "waitAsyncTaskResult",
  ]);
  const filteredTools = tools.filter(
    (toolDefinition) =>
      !blockedToolNames.has(String(toolDefinition?.name || "")),
  );

  if (filteredTools.length !== tools.length) {
    emitEvent(eventListener, "agent_collab_tools_disabled_by_depth", {
      parentSessionId,
      parentDepth,
      maxParentDepth,
      disabledTools: Array.from(blockedToolNames),
    });
  }
  return filteredTools;
}

export async function runAgentTurn({ agentContext, userMessage }) {
  const runtime = agentContext?.runtime || {};
  const sys = runtime.systemRuntime || {};
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const eventListener = runtime.eventListener || null;
  const dialogProcessId = sys.dialogProcessId || "";
  const tools = filterAgentCollabToolsByDepth({
    agentContext,
    effectiveConfig,
    eventListener,
  });

  const selectedModelSpec = resolveDefaultModelSpec({
    globalConfig,
    userConfig,
  });
  const maxToolLoopTurns = Number(effectiveConfig?.maxToolLoopTurns || 30);
  const llm = createChatModel({
    globalConfig,
    userConfig,
    streaming: Boolean(eventListener?.onEvent),
  });
  emitEvent(eventListener, "model_selected", {
    alias: selectedModelSpec?.alias || "",
    model: selectedModelSpec?.model || "",
  });

  const messages = [
    ...buildContextMessages(agentContext),
    new HumanMessage(userMessage),
  ];

  const modelState = {
    llm,
    activeModelName: selectedModelSpec?.model || "",
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec: selectedModelSpec,
  };
  const loopState = {
    tools,
    messages,
    traces: [],
    turnMessages: [],
    dialogProcessId,
    maxTurns:
      Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
        ? maxToolLoopTurns
        : 30,
  };
  return await runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
