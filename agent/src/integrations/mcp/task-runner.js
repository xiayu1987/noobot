/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { normalizeToolCalls } from "../../models/index.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { getMcpServerByName, createMcpClient } from "./client-factory.js";
import { buildLangChainMcpTools } from "./tool-adapter.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

function toText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item?.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content === null || content === undefined) return "";
  return JSON.stringify(content);
}

export async function createMcpAgentTools({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  signal = null,
  fetchImpl = null,
}) {
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(
      `${tSystem("mcp.serverNotFoundOrInactive")}: ${String(mcpName || "")}`,
    );
  }
  const client = createMcpClient({ server, signal, fetchImpl });
  await client.initialize();
  const mcpTools = await client.listTools();
  const tools = buildLangChainMcpTools({ mcpTools, client });
  return {
    mcpName: server.name,
    server,
    tools,
    toolNames: mcpTools.map((item) => String(item?.name || "").trim()).filter(Boolean),
  };
}

export async function executeMcpTask({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  task = "",
  modelName = "",
  runtime = {},
  signal = null,
  fetchImpl = null,
}) {
  const normalizedTask = String(task || "").trim();
  if (!normalizedTask) {
    throw recoverableToolError(tSystem("common.taskRequired"));
  }
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(
      `${tSystem("mcp.serverNotFoundOrInactive")}: ${String(mcpName || "")}`,
    );
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

  const modelPort = runtime?.modelPort;
  const modelSpec = runtime?.modelSpec;
  if (!modelPort || typeof modelPort.invoke !== "function" || !modelSpec) {
    throw new TypeError("MCP model execution requires the host ModelPort and resolved modelSpec");
  }
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
    const ai = await modelPort.invoke({
      model: modelSpec,
      messages,
      tools: langchainTools,
      options: { streaming: false, signal: signal || undefined },
      invocation: {
        flow: "mcp.task",
        purpose: "mcp_tool_execution",
        domain: "mcp",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
      },
    });
    const output = ai.output;
    messages.push({ role: "assistant", content: output.text, tool_calls: output.toolCalls || [] });
    const calls = Array.isArray(output.toolCalls) ? output.toolCalls : [];
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
      const tool = toolMap.get(String(call?.name || "").trim());
      if (!tool) {
        const notFoundMsg = `${tSystem("mcp.toolNotFound")}: ${String(call?.name || "")}`;
        traces.push({ tool: call?.name || "", args: call?.args || {}, result: notFoundMsg });
        messages.push(new ToolMessage({ tool_call_id: call?.id || "", content: notFoundMsg }));
        continue;
      }
      const result = await tool.invoke(call?.args || {}, {
        signal: signal || undefined,
      });
      const resultText = typeof result === "string" ? result : JSON.stringify(result);
      traces.push({
        tool: call?.name || "",
        args: call?.args || {},
        result: String(resultText).slice(0, LENGTH_THRESHOLDS.display.mcpTaskResultPreviewChars),
      });
      messages.push(
        new ToolMessage({
          tool_call_id: call?.id || "",
          content: String(resultText),
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
