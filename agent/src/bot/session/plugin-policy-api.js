/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeStringArrayFallback(input = []) {
  return Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function removeDeniedToolNamesFromAllow({
  toolPolicy = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const policy = toolPolicy && typeof toolPolicy === "object" ? toolPolicy : {};
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const allowToolNames = normalize(policy?.allowToolNames);
  if (!allowToolNames.length) return policy;
  const denySet = new Set([
    ...normalize(policy?.denyToolNames),
    ...normalize(policy?.deny_tool_names),
  ]);
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
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const mergedDenyToolNames = Array.from(
    new Set([
      ...normalize(basePolicy?.denyToolNames),
      ...normalize(basePolicy?.deny_tool_names),
      ...normalize(appendToolNames),
    ]),
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
  const basePolicy =
    baseToolPolicy && typeof baseToolPolicy === "object" ? baseToolPolicy : {};
  const patchPolicy =
    toolPolicyPatch && typeof toolPolicyPatch === "object" ? toolPolicyPatch : {};
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const merged = {
    ...basePolicy,
    ...patchPolicy,
  };
  const appendToolNames = [
    ...normalize(basePolicy?.denyToolNames),
    ...normalize(basePolicy?.deny_tool_names),
    ...normalize(patchPolicy?.denyToolNames),
    ...normalize(patchPolicy?.deny_tool_names),
  ];
  delete merged.denyToolNames;
  delete merged.deny_tool_names;
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
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const hasPatchDenyToolNames =
    normalize(patch?.denyToolNames).length > 0 ||
    normalize(patch?.deny_tool_names).length > 0;
  const hasOtherPatchKeys = Object.keys(patch).some(
    (key) => key !== "denyToolNames" && key !== "deny_tool_names",
  );
  return hasPatchDenyToolNames || hasOtherPatchKeys;
}

export function createPluginPolicyApi({
  baseToolPolicy = {},
  normalizeStringArray = normalizeStringArrayFallback,
} = {}) {
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const toolPolicyPatch = {};
  const applyToolPolicyPatch = (patch = {}) => {
    const nextPatch = patch && typeof patch === "object" ? patch : {};
    Object.assign(toolPolicyPatch, nextPatch);
    if (
      Object.prototype.hasOwnProperty.call(nextPatch, "denyToolNames") ||
      Object.prototype.hasOwnProperty.call(nextPatch, "deny_tool_names")
    ) {
      const merged = mergeToolPolicyDenyToolNames({
        toolPolicy: {
          ...toolPolicyPatch,
          denyToolNames: undefined,
        },
        appendToolNames: [
          ...normalize(toolPolicyPatch?.denyToolNames),
          ...normalize(toolPolicyPatch?.deny_tool_names),
        ],
        normalizeStringArray: normalize,
      });
      delete merged.deny_tool_names;
      Object.assign(toolPolicyPatch, merged);
    }
  };
  return {
    setToolPolicy: (patch = {}) => {
      applyToolPolicyPatch(patch);
      return mergeToolPolicyPatch({
        baseToolPolicy,
        toolPolicyPatch,
        normalizeStringArray: normalize,
      });
    },
    appendDenyToolNames: (toolNames = []) => {
      const nextDenyToolNames = [
        ...normalize(toolPolicyPatch?.denyToolNames),
        ...normalize(toolPolicyPatch?.deny_tool_names),
        ...normalize(toolNames),
      ];
      applyToolPolicyPatch({
        ...toolPolicyPatch,
        denyToolNames: Array.from(new Set(nextDenyToolNames)),
      });
      return mergeToolPolicyPatch({
        baseToolPolicy,
        toolPolicyPatch,
        normalizeStringArray: normalize,
      });
    },
    getToolPolicy: () =>
      mergeToolPolicyPatch({
        baseToolPolicy,
        toolPolicyPatch,
        normalizeStringArray: normalize,
      }),
    getToolPolicyPatch: () => ({ ...toolPolicyPatch }),
  };
}
