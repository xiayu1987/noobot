/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { tSystem } from "noobot-i18n/agent/system-text";

export function buildMcpToolDescription(toolSpec = {}) {
  const description = String(toolSpec?.description || "").trim();
  const inputSchema = toolSpec?.inputSchema || {};
  const schemaText = JSON.stringify(inputSchema || {}, null, 2);
  if (!description) {
    return `${tSystem("mcp.toolDescriptionDefault")}\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
  }
  return `${description}\n\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonObject(value = {}) {
  if (!isPlainObject(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

export function normalizeMcpInputSchema(inputSchema = {}) {
  const schema = cloneJsonObject(inputSchema);
  if (!Object.keys(schema).length) {
    return { type: "object", properties: {} };
  }
  if (!schema.type) schema.type = "object";
  if (schema.type !== "object") {
    return {
      type: "object",
      properties: { value: schema },
      required: ["value"],
    };
  }
  if (!isPlainObject(schema.properties)) schema.properties = {};
  if (Array.isArray(schema.required)) {
    schema.required = schema.required
      .map((item) => String(item || "").trim())
      .filter((item, index, list) => item && list.indexOf(item) === index);
  } else {
    delete schema.required;
  }
  return schema;
}

export function normalizeMcpToolCallArgs(args = {}) {
  if (typeof args === "string") {
    const rawText = args.trim();
    if (!rawText) return {};
    try {
      const parsed = JSON.parse(rawText);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!isPlainObject(args)) return {};
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
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
        schema: normalizeMcpInputSchema(toolSpec?.inputSchema || {}),
        func: async (args = {}) => {
          const callResult = await client.callTool({
            name: toolName,
            args: normalizeMcpToolCallArgs(args),
          });
          return normalizeMcpToolResult(callResult);
        },
      });
    })
    .filter(Boolean);
}
