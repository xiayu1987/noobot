/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tool as structuredTool } from "@langchain/core/tools";
import { tSystem } from "noobot-i18n/agent/system-text";
import { TOOL_BINDING_NAME_MAX_LENGTH } from "../../models/tool/binding-adapter.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

export function buildMcpToolDescription(toolSpec = {}) {
  const description = text(toolSpec?.description);
  const inputSchema = toolSpec?.inputSchema || {};
  const schemaText = JSON.stringify(inputSchema || {}, null, 2);
  if (!description) {
    return `${tSystem("mcp.toolDescriptionDefault")}\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
  }
  return `${description}\n\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
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
      .map((item) => text(item))
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
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}

export function normalizeMcpToolResult(result = {}) {
  const contentItems = Array.isArray(result?.content) ? result.content : [];
  const inputText = contentItems
    .map((item) => {
      if (!isObjectLike(item)) return "";
      if (item.type === "text") return String(item.text || "");
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
  if (inputText) return inputText;
  return JSON.stringify(result || {});
}

function resolveMcpToolBindingName(toolName = "", usedNames = new Set()) {
  const base =
    text(toolName)
      .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, TOOL_BINDING_NAME_MAX_LENGTH) || "mcp_tool";
  let candidate = base;
  for (let index = 2; usedNames.has(candidate); index += 1) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, TOOL_BINDING_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
  }
  usedNames.add(candidate);
  return candidate;
}

export function buildLangChainMcpTools({ mcpTools = [], client }) {
  const usedNames = new Set();
  return (mcpTools || [])
    .map((toolSpec) => {
      const toolName = text(toolSpec?.name);
      if (!toolName) return null;
      return structuredTool(
        async (args = {}) => {
          const callResult = await client.callTool({
            name: toolName,
            args: normalizeMcpToolCallArgs(args),
          });
          return normalizeMcpToolResult(callResult);
        },
        {
          name: resolveMcpToolBindingName(toolName, usedNames),
          description: buildMcpToolDescription(toolSpec),
          schema: normalizeMcpInputSchema(toolSpec?.inputSchema || {}),
        },
      );
    })
    .filter(Boolean);
}
