/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createChatModel, createChatModelByName, normalizeToolCalls } from "../model/index.js";
import { recoverableToolError } from "../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { getMcpServerByName, createMcpClient } from "./client-factory.js";
import { buildLangChainMcpTools } from "./tool-adapter.js";

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
    toolNames: mcpTools
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean),
  };
}

export async function executeMcpTask({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  task = "",
  modelName = "",
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

  const llm = modelName
    ? createChatModelByName(modelName, { globalConfig, userConfig, streaming: false })
    : createChatModel({ globalConfig, userConfig, streaming: false });
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
  const maxTurns = 12;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const ai = await llm.bindTools(langchainTools).invoke(messages, {
      signal: signal || undefined,
    });
    messages.push(ai);
    const { calls } = normalizeToolCalls(ai);
    if (!calls.length) {
      return {
        ok: true,
        mcpName: server.name,
        tools: toolNames,
        answer: toText(ai?.content || ""),
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
        result: String(resultText).slice(0, 1000),
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
