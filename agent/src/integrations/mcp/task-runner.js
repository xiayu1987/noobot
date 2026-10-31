/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ERROR_CODE, recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { getMcpServerByName, createMcpClient } from "./client-factory.js";
import { buildLangChainMcpTools } from "./tool-adapter.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { ACTIVITY_KIND, MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { createModelActivity } from "../../models/runtime/model-manager.js";
import { requireRuntimeModelHost } from "../../runtime/model-port-host.js";
import { text } from "@noobot/shared/value";
import { decodeToolResultText, encodeToolResultObject } from "@noobot/event-protocol/tool-result";

export async function createMcpAgentTools({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  signal = null,
  fetchImpl = null,
}) {
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(`${tSystem("mcp.serverNotFoundOrInactive")}: ${mcpName}`, {
      code: ERROR_CODE.RECOVERABLE_MCP_SERVER_NOT_FOUND,
    });
  }
  const client = createMcpClient({ server, signal, fetchImpl });
  await client.initialize();
  const mcpTools = await client.listTools();
  const tools = buildLangChainMcpTools({ mcpTools, client });
  return {
    mcpName: server.name,
    server,
    tools,
    toolNames: tools.map((tool) => tool.name),
    close: () => client.close(),
  };
}

export async function executeMcpTask({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  task = "",
  runtime = {},
  signal = null,
  fetchImpl = null,
}) {
  const normalizedTask = text(task);
  if (!normalizedTask) {
    throw recoverableToolError(tSystem("common.taskRequired"), {
      code: ERROR_CODE.RECOVERABLE_MCP_TASK_REQUIRED,
    });
  }
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(`${tSystem("mcp.serverNotFoundOrInactive")}: ${mcpName}`, {
      code: ERROR_CODE.RECOVERABLE_MCP_SERVER_NOT_FOUND,
    });
  }

  const { tools: langchainTools, toolNames } = await createMcpAgentTools({
    globalConfig,
    userConfig,
    mcpName: server.name,
    signal,
    fetchImpl,
  });
  if (!toolNames.length) {
    return {
      ok: true,
      mcpName: server.name,
      tools: [],
      answer: tSystem("mcp.noToolsAvailable"),
      traces: [],
    };
  }

  const { modelPort, modelSpec } = requireRuntimeModelHost(runtime);
  const toolMap = new Map(langchainTools.map((tool) => [tool.name, tool]));

  const messages = [
    new SystemMessage(
      [
        tSystem("mcp.systemPromptLine1"),
        tSystem("mcp.systemPromptLine2"),
        tSystem("mcp.systemPromptLine3"),
      ].join("\n"),
    ),
    new HumanMessage(normalizedTask),
  ];

  const traces = [];
  const maxTurns = TURN_THRESHOLDS.subTasks.mcpTaskMaxTurns;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const { streaming } = runtime.runConfig;
    const modelActivity = createModelActivity(runtime.eventListener, runtime, {
      activityKind: ACTIVITY_KIND.MCP_MODEL_ANALYSIS,
      activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      purpose: "mcp_tool_execution",
      streaming,
    });
    const ai = await modelPort.invoke({
      model: modelSpec,
      messages,
      tools: langchainTools,
      options: {
        streaming,
        callbacks: modelActivity.callbacks,
        signal: signal || undefined,
      },
      invocation: {
        flow: "mcp.task",
        purpose: "mcp_tool_execution",
        domain: "mcp",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
      },
    });
    const output = ai.output;
    await modelActivity.complete(output.text);
    messages.push({ role: "assistant", content: output.text, tool_calls: output.toolCalls });
    const calls = output.toolCalls;
    if (!calls.length) {
      return {
        ok: true,
        mcpName: server.name,
        tools: toolNames,
        answer: String(output.text || ""),
        traces,
      };
    }
    for (const call of calls) {
      const tool = toolMap.get(text(call?.name));
      if (!tool) {
        const notFoundMsg = `${tSystem("mcp.toolNotFound")}: ${String(call?.name || "")}`;
        const notFoundResult = encodeToolResultObject({
          ok: false,
          code: ERROR_CODE.RECOVERABLE_MCP_TOOL_NOT_FOUND,
          error: notFoundMsg,
        });
        traces.push({ tool: call?.name || "", args: call?.args || {}, result: notFoundResult });
        messages.push(new ToolMessage({ tool_call_id: call?.id || "", content: notFoundResult }));
        continue;
      }
      const result = await tool.invoke(call?.args || {}, {
        signal: signal || undefined,
      });
      decodeToolResultText(result);
      traces.push({
        tool: call?.name || "",
        args: call?.args || {},
        result: result.slice(0, LENGTH_THRESHOLDS.display.mcpTaskResultPreviewChars),
      });
      messages.push(
        new ToolMessage({
          tool_call_id: call?.id || "",
          content: result,
        }),
      );
    }
  }

  return {
    ok: true,
    mcpName: server.name,
    tools: toolNames,
    answer: tSystem("mcp.toolCallTurnLimitReached"),
    traces,
  };
}
