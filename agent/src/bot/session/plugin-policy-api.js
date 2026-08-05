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
  const normalize = typeof normalizeStringArray === "function"
    ? normalizeStringArray
    : normalizeStringArrayFallback;
  const hasPatchDenyToolNames =
    normalize(patch?.denyToolNames).length > 0;
  const hasOtherPatchKeys = Object.keys(patch).some(
    (key) => key !== "denyToolNames",
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
    const accumulatedDenyToolNames = [
      ...normalize(toolPolicyPatch?.denyToolNames),
      ...normalize(nextPatch?.denyToolNames),
    ];
    Object.assign(toolPolicyPatch, nextPatch);
    if (
      Object.prototype.hasOwnProperty.call(nextPatch, "denyToolNames")
    ) {
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
