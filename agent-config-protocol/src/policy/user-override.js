/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeKnownConfigKeys, SNAKE_TO_CANONICAL_KEY_MAP } from "../normalization/keys.js";
import { sanitizeScenarioConfig } from "./scenario-policy.js";
import { isPlainObject } from "../utils.js";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_PATH_REPRESENTATION,
  USER_CONFIG_MERGE_MODE,
} from "../contract/repair.js";
import {
  CONFIG_STRUCTURE,
  listConfigNodePathsByPolicy,
  structureAllowsScope,
} from "../contract/config-structure.js";
const USER_CONFIG_SYSTEM_OWNED_PATHS = listConfigNodePathsByPolicy({
  policy: CONFIG_NODE_POLICY.GLOBAL_ONLY,
  representation: CONFIG_PATH_REPRESENTATION.RUNTIME,
});

/**
 * Which top-level keys a user document may carry is a structural fact, so it is
 * derived from the scope declarations instead of restated as a key list here.
 * This module only decides HOW an allowed key merges.
 */
const USER_OVERRIDABLE_TOP_LEVEL_KEYS = Object.freeze(
  Object.entries(CONFIG_STRUCTURE.fields)
    .filter(([, child]) => structureAllowsScope(child, CONFIG_DOCUMENT_SCOPE.USER))
    .map(([key]) => SNAKE_TO_CANONICAL_KEY_MAP[key] || key),
);

const USER_OVERRIDE_TOP_LEVEL_DENY_KEYS = new Set(
  USER_CONFIG_SYSTEM_OWNED_PATHS.filter((path) => !path.includes(".")),
);
const USER_OVERRIDE_DENY_PATHS = new Set(
  USER_CONFIG_SYSTEM_OWNED_PATHS.filter((path) => path.includes(".")),
);

function stripDeniedPaths(rootKey = "", value) {
  if (!isPlainObject(value)) return value;
  const root = String(rootKey || "").trim();
  if (!root) return value;
  const deniedChildren = Array.from(USER_OVERRIDE_DENY_PATHS)
    .filter((item) => item.startsWith(`${root}.`))
    .map((item) => item.slice(root.length + 1))
    .filter(Boolean);
  if (!deniedChildren.length) return value;

  const out = { ...value };
  for (const relativePath of deniedChildren) {
    const parts = relativePath.split(".").filter(Boolean);
    if (!parts.length) continue;
    let node = out;
    for (let partIndex = 0; partIndex < parts.length - 1; partIndex += 1) {
      const segment = parts[partIndex];
      if (!isPlainObject(node?.[segment])) {
        node = null;
        break;
      }
      node = node[segment];
    }
    if (!node || !isPlainObject(node)) continue;
    delete node[parts[parts.length - 1]];
  }
  return out;
}

function cloneAllowedValue(key, value) {
  if (USER_OVERRIDE_TOP_LEVEL_DENY_KEYS.has(String(key || ""))) {
    return undefined;
  }
  const mode = USER_CONFIG_MERGE_MODE[key] || "deep";
  if (mode === "replace") {
    return typeof value === "string" ? value : undefined;
  }
  if (mode === "scenarios") {
    const sanitizedScenarios = sanitizeScenarioConfig(value);
    return Object.keys(sanitizedScenarios).length ? sanitizedScenarios : undefined;
  }
  return isPlainObject(value) ? stripDeniedPaths(key, { ...value }) : undefined;
}

export function sanitizeUserConfig(input = {}) {
  const src = normalizeKnownConfigKeys(isPlainObject(input) ? input : {});
  const out = {};
  for (const key of USER_OVERRIDABLE_TOP_LEVEL_KEYS) {
    const value = cloneAllowedValue(key, src[key]);
    if (value === undefined) continue;
    if (isPlainObject(value) && !Object.keys(value).length) continue;
    out[key] = value;
  }
  return out;
}
