/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PROGRAMMING_REQUIRED_TOOL_NAMES } from "./scenario-policy.js";
import { normalizeStringList } from "../utils.js";
import { isPlainObject, text } from "@noobot/shared/value";

export function removeDeniedToolNamesFromAllow({ toolPolicy = {} } = {}) {
  const policy = isPlainObject(toolPolicy) ? toolPolicy : {};
  const allowToolNames = normalizeStringList(policy?.allowToolNames);
  if (!allowToolNames.length) return policy;
  const denySet = new Set([...normalizeStringList(policy?.denyToolNames)]);
  if (!denySet.size) return policy;
  return {
    ...policy,
    allowToolNames: allowToolNames.filter((toolName) => !denySet.has(toolName)),
  };
}

function mergeToolPolicyDenyToolNames({ toolPolicy = {}, appendToolNames = [] } = {}) {
  const basePolicy = isPlainObject(toolPolicy) ? toolPolicy : {};
  const mergedDenyToolNames = Array.from(
    new Set([
      ...normalizeStringList(basePolicy?.denyToolNames),
      ...normalizeStringList(appendToolNames),
    ]),
  );
  const policyWithMergedDeny = {
    ...basePolicy,
    denyToolNames: mergedDenyToolNames,
  };
  return removeDeniedToolNamesFromAllow({
    toolPolicy: policyWithMergedDeny,
  });
}

export function mergeToolPolicyPatch({ baseToolPolicy = {}, toolPolicyPatch = {} } = {}) {
  const basePolicy = isPlainObject(baseToolPolicy) ? baseToolPolicy : {};
  const patchPolicy = isPlainObject(toolPolicyPatch) ? toolPolicyPatch : {};
  const merged = {
    ...basePolicy,
    ...patchPolicy,
  };
  const appendToolNames = [
    ...normalizeStringList(basePolicy?.denyToolNames),
    ...normalizeStringList(patchPolicy?.denyToolNames),
  ];
  delete merged.denyToolNames;
  return mergeToolPolicyDenyToolNames({
    toolPolicy: merged,
    appendToolNames,
  });
}

export function hasToolPolicyPatchContent({ toolPolicyPatch = {} } = {}) {
  const patch = isPlainObject(toolPolicyPatch) ? toolPolicyPatch : {};
  const hasPatchDenyToolNames = normalizeStringList(patch?.denyToolNames).length > 0;
  const hasOtherPatchKeys = Object.keys(patch).some((key) => key !== "denyToolNames");
  return hasPatchDenyToolNames || hasOtherPatchKeys;
}

export function resolveToolBindings({ sourceTools = [], runConfig = {} } = {}) {
  const source = Array.isArray(sourceTools) ? sourceTools : [];
  const policy = isPlainObject(runConfig?.toolPolicy) ? runConfig.toolPolicy : {};
  const mode = text(policy.mode).toLowerCase();
  const customTools = Array.isArray(policy.customTools)
    ? policy.customTools.filter((item) => isPlainObject(item) && text(item.name))
    : [];
  const includedNames = new Set(normalizeStringList(policy.includeToolNames));
  if (runConfig.allowUserInteraction !== false && policy.forceIncludeUserInteraction !== false) {
    includedNames.add("user_interaction");
  }
  const included = source.filter((item) => includedNames.has(String(item?.name || "")));
  let tools = source;
  if (mode === "custom_only") tools = [...customTools, ...included];
  else if (mode === "append_custom") tools = [...source, ...customTools];
  const allow = new Set(normalizeStringList(policy.allowToolNames));

  if (Array.isArray(runConfig?.pluginTools)) {
    for (const contribution of runConfig.pluginTools) {
      const name = text(contribution?.name);
      if (name) allow.add(name);
    }
  }
  const scenario = text(runConfig.scenario || runConfig.scenarioProfile?.key).toLowerCase();
  if (mode !== "custom_only" && (scenario === "coding" || scenario === "programming")) {
    for (const name of PROGRAMMING_REQUIRED_TOOL_NAMES) allow.add(name);
  }
  if (allow.size) tools = tools.filter((item) => allow.has(String(item?.name || "")));
  const deny = new Set(normalizeStringList(policy.denyToolNames));
  if (deny.size) tools = tools.filter((item) => !deny.has(String(item?.name || "")));
  const result = [];
  const seen = new Set();
  for (const item of tools) {
    const name = text(item?.name);
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(item);
    }
  }
  return result;
}

export function createPluginPolicyApi({ baseToolPolicy = {} } = {}) {
  const toolPolicyPatch = {};
  const applyToolPolicyPatch = (patch = {}) => {
    const nextPatch = isPlainObject(patch) ? patch : {};
    const accumulatedDenyToolNames = [
      ...normalizeStringList(toolPolicyPatch?.denyToolNames),
      ...normalizeStringList(nextPatch?.denyToolNames),
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
      });
    },
    snapshot: () => ({ ...toolPolicyPatch }),
  };
}
