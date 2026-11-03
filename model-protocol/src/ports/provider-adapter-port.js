/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isFunction } from "@noobot/shared/value";

export function requireProviderAdapter(adapter) {
  if (!text(adapter?.id)) throw new TypeError("provider adapter.id is required");
  for (const key of [
    "createClient",
    "classifyError",
    "bindTools",
    "prepareMessages",
    "resolveResponseSource",
  ])
    if (!isFunction(adapter?.[key])) throw new TypeError(`provider adapter.${key} is required`);

  const operationKeys = ["executeOperation", "resolveOperationStreamingModes"];
  const declared = operationKeys.filter((key) => adapter[key] !== undefined);
  if (declared.length && declared.length !== operationKeys.length) {
    throw new TypeError(`provider adapter must declare ${operationKeys.join(" and ")} together`);
  }
  for (const key of declared) {
    if (!isFunction(adapter[key]))
      throw new TypeError(`provider adapter.${key} must be a function`);
  }
  return adapter;
}

export function requireOperationStreamingModes(modes) {
  if (
    !Array.isArray(modes) ||
    !modes.length ||
    !modes.every((mode) => typeof mode === "boolean") ||
    new Set(modes).size !== modes.length
  ) {
    throw new TypeError("operation streaming modes must be a non-empty list of distinct booleans");
  }
  return modes;
}
