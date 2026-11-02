/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { interopZodTransformInputSchema, isZodSchemaV4 } from "@langchain/core/utils/types";
import { text } from "@noobot/shared/value";

const inputViewCache = new WeakMap();

function exportInputViewParameters(schema) {
  const cached = inputViewCache.get(schema);
  if (cached) return cached;
  const inputSchema = interopZodTransformInputSchema(schema, true);
  const parameters = z.toJSONSchema(inputSchema, { io: "input" });
  inputViewCache.set(schema, parameters);
  return parameters;
}

export function projectToolsForModel(tools = [], { strict = false } = {}) {
  if (!Array.isArray(tools) || strict === true) return tools;
  return tools.map((toolItem) => {
    if (!isZodSchemaV4(toolItem?.schema) || !text(toolItem?.name)) return toolItem;
    return {
      type: "function",
      function: {
        name: text(toolItem.name),
        description: String(toolItem.description || ""),
        parameters: exportInputViewParameters(toolItem.schema),
      },
    };
  });
}
