/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

export const TOOL_DEFINITION_TEMPLATE = Symbol("toolDefinitionTemplate");

const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const SCHEMA_KEYS = new Set([
  "items",
  "prefixItems",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "allOf",
  "anyOf",
  "oneOf",
  "contentSchema",
]);

function projectSchema(schema, binding) {
  if (Array.isArray(schema)) return schema.map((item) => projectSchema(item, binding));
  if (!isPlainObject(schema)) return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (key === "description" || key === "title") return [key, binding.renderReferences(value)];
      if (SCHEMA_MAP_KEYS.has(key) && isPlainObject(value))
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([name, child]) => [name, projectSchema(child, binding)]),
          ),
        ];
      if (SCHEMA_KEYS.has(key)) return [key, projectSchema(value, binding)];
      return [key, value];
    }),
  );
}

export function projectToolDefinitionNames(tool, binding) {
  if (tool.function)
    return { ...tool, function: projectToolDefinitionNames(tool.function, binding) };
  const projected = Object.assign(Object.create(Object.getPrototypeOf(tool)), tool);
  delete projected[TOOL_DEFINITION_TEMPLATE];
  if (tool.name) projected.name = binding.toActiveBindingName(tool.name);
  if (tool[TOOL_DEFINITION_TEMPLATE] !== true) return projected;
  if (typeof tool.description === "string")
    projected.description = binding.renderReferences(tool.description);
  for (const key of ["parameters", "schema", "input_schema"])
    if (isPlainObject(tool[key])) projected[key] = projectSchema(tool[key], binding);
  return projected;
}
