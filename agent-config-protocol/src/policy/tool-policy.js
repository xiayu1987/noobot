/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PROGRAMMING_REQUIRED_TOOL_NAMES } from "./scenario-policy.js";
import { normalizeStringList } from "../utils.js";

const normalizeStringArrayFallback = (input = []) => normalizeStringList(input);

/**
 * Authoritative allow/deny conflict resolution: a denied tool name can never
 * survive in the allow list. Exported so every caller resolves the conflict
 * through this single implementation.
 */
export function removeDeniedToolNamesFromAllow({
  toolPolicy = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const policy = toolPolicy && typeof toolPolicy === "object" ? toolPolicy : {};
  const normalize =
    typeof normalizeStringArray === "function"
      ? normalizeStringArray
      : normalizeStringArrayFallback;
  const allowToolNames = normalize(policy?.allowToolNames);
  if (!allowToolNames.length) return policy;
  const denySet = new Set([...normalize(policy?.denyToolNames)]);
  if (!denySet.size) return policy;
  return {
    ...policy,
    allowToolNames: allowToolNames.filter((toolName) => !denySet.has(toolName)),
  };
}

export function mergeToolPolicyDenyToolNames({
  toolPolicy = {},
  appendToolNames = [],
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const basePolicy = toolPolicy && typeof toolPolicy === "object" ? toolPolicy : {};
  const normalize =
    typeof normalizeStringArray === "function"
      ? normalizeStringArray
      : normalizeStringArrayFallback;
  const mergedDenyToolNames = Array.from(
    new Set([...normalize(basePolicy?.denyToolNames), ...normalize(appendToolNames)]),
  );
  const policyWithMergedDeny = {
    ...basePolicy,
    denyToolNames: mergedDenyToolNames,
  };
  return removeDeniedToolNamesFromAllow({
    toolPolicy: policyWithMergedDeny,
    normalizeStringArray: normalize,
  });
}

export function mergeToolPolicyPatch({
  baseToolPolicy = {},
  toolPolicyPatch = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const basePolicy = baseToolPolicy && typeof baseToolPolicy === "object" ? baseToolPolicy : {};
  const patchPolicy = toolPolicyPatch && typeof toolPolicyPatch === "object" ? toolPolicyPatch : {};
  const normalize =
    typeof normalizeStringArray === "function"
      ? normalizeStringArray
      : normalizeStringArrayFallback;
  const merged = {
    ...basePolicy,
    ...patchPolicy,
  };
  const appendToolNames = [
    ...normalize(basePolicy?.denyToolNames),
    ...normalize(patchPolicy?.denyToolNames),
  ];
  delete merged.denyToolNames;
  return mergeToolPolicyDenyToolNames({
    toolPolicy: merged,
    appendToolNames,
    normalizeStringArray: normalize,
  });
}

export function hasToolPolicyPatchContent({
  toolPolicyPatch = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const patch = toolPolicyPatch && typeof toolPolicyPatch === "object" ? toolPolicyPatch : {};
  const normalize =
    typeof normalizeStringArray === "function"
      ? normalizeStringArray
      : normalizeStringArrayFallback;
  const hasPatchDenyToolNames = normalize(patch?.denyToolNames).length > 0;
  const hasOtherPatchKeys = Object.keys(patch).some((key) => key !== "denyToolNames");
  return hasPatchDenyToolNames || hasOtherPatchKeys;
}

export function resolveToolBindings({ sourceTools = [], runConfig = {} } = {}) {
  const source = Array.isArray(sourceTools) ? sourceTools : [];
  const policy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object" ? runConfig.toolPolicy : {};
  const normalize = normalizeStringArrayFallback;
  const mode = String(policy.mode || "")
    .trim()
    .toLowerCase();
  const customTools = Array.isArray(policy.customTools)
    ? policy.customTools.filter(
        (item) => item && typeof item === "object" && String(item.name || "").trim(),
      )
    : [];
  const includedNames = new Set(normalize(policy.includeToolNames));
  if (runConfig.allowUserInteraction !== false && policy.forceIncludeUserInteraction !== false) {
    includedNames.add("user_interaction");
  }
  const included = source.filter((item) => includedNames.has(String(item?.name || "")));
  let tools = source;
  if (mode === "custom_only") tools = [...customTools, ...included];
  else if (mode === "append_custom") tools = [...source, ...customTools];
  const allow = new Set(normalize(policy.allowToolNames));
  // Activated plugin contributions are part of the runtime tool surface. A
  // scenario may restrict built-in tools, but must not silently hide a tool
  // contributed by an enabled plugin; denyToolNames remains authoritative.
  if (Array.isArray(runConfig?.pluginTools)) {
    for (const contribution of runConfig.pluginTools) {
      const name = String(contribution?.name || "").trim();
      if (name) allow.add(name);
    }
  }
  const scenario = String(runConfig.scenario || runConfig.scenarioProfile?.key || "")
    .trim()
    .toLowerCase();
  if (mode !== "custom_only" && (scenario === "coding" || scenario === "programming")) {
    for (const name of PROGRAMMING_REQUIRED_TOOL_NAMES) allow.add(name);
  }
  if (allow.size) tools = tools.filter((item) => allow.has(String(item?.name || "")));
  const deny = new Set(normalize(policy.denyToolNames));
  if (deny.size) tools = tools.filter((item) => !deny.has(String(item?.name || "")));
  const result = [];
  const seen = new Set();
  for (const item of tools) {
    const name = String(item?.name || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(item);
    }
  }
  return result;
}

export function createPluginPolicyApi({
  baseToolPolicy = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const normalize =
    typeof normalizeStringArray === "function"
      ? normalizeStringArray
      : normalizeStringArrayFallback;
  const toolPolicyPatch = {};
  const applyToolPolicyPatch = (patch = {}) => {
    const nextPatch = patch && typeof patch === "object" ? patch : {};
    const accumulatedDenyToolNames = [
      ...normalize(toolPolicyPatch?.denyToolNames),
      ...normalize(nextPatch?.denyToolNames),
    ];
    Object.assign(toolPolicyPatch, nextPatch);
    if (Object.prototype.hasOwnProperty.call(nextPatch, "denyToolNames")) {
      toolPolicyPatch.denyToolNames = Array.from(new Set(accumulatedDenyToolNames));
    }
  };
  return {
    patch: (patch = {}) => {
      applyToolPolicyPatch(patch);
      return mergeToolPolicyPatch({
        baseToolPolicy,
        toolPolicyPatch,
        normalizeStringArray: normalize,
      });
    },
    snapshot: () => ({ ...toolPolicyPatch }),
  };
}
