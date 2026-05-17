/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { tSystem } from "../i18n/system-text.js";

export function buildMcpToolDescription(toolSpec = {}) {
  const description = String(toolSpec?.description || "").trim();
  const inputSchema = toolSpec?.inputSchema || {};
  const schemaText = JSON.stringify(inputSchema || {}, null, 2);
  if (!description) {
    return `${tSystem("mcp.toolDescriptionDefault")}\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
  }
  return `${description}\n\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
}

export function normalizeMcpToolResult(result = {}) {
  const contentItems = Array.isArray(result?.content) ? result.content : [];
  const text = contentItems
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (item.type === "text") return String(item.text || "");
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  return JSON.stringify(result || {});
}

export function buildLangChainMcpTools({ mcpTools = [], client }) {
  return (mcpTools || [])
    .map((toolSpec) => {
      const toolName = String(toolSpec?.name || "").trim();
      if (!toolName) return null;
      return new DynamicStructuredTool({
        name: toolName,
        description: buildMcpToolDescription(toolSpec),
        schema: z.object({}).passthrough(),
        func: async (args = {}) => {
          const callResult = await client.callTool({ name: toolName, args });
          return normalizeMcpToolResult(callResult);
        },
      });
    })
    .filter(Boolean);
}
