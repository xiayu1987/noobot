/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function resolveDirectivePriority(value, fallback = 0) {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : fallback;
}

function getNestedValue(source = {}, key = "") {
  if (!source || typeof source !== "object" || !key) return undefined;
  const segments = String(key)
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

const BASE_TAKEOVER_PRIORITY_PIPELINE = Object.freeze([
  ({ kind }) => `${kind}Takeover.priority`,
  () => "takeoverPriority",
  () => "priority",
]);

function resolveProfileTakeoverPriority(kind = "", profile = {}) {
  for (const keyResolver of BASE_TAKEOVER_PRIORITY_PIPELINE) {
    const key = keyResolver({ kind });
    const value = getNestedValue(profile, key);
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

export function resolveTakeoverPriority({
  kind = "",
  point = "",
  ctx = {},
  directive = {},
  profile = {},
  sequence = 0,
} = {}) {
  const profilePriority = resolveProfileTakeoverPriority(kind, profile);
  const directPriority = resolveDirectivePriority(directive?.priority, profilePriority);
  if (kind !== "memory") return { priority: directPriority, sequence };

  const commitType = String(ctx?.commitType || "").trim();
  if (point !== "before_state_commit" || !commitType) {
    return { priority: directPriority, sequence };
  }

  const profileByCommitType = getNestedValue(profile, "memoryTakeover.priorityByCommitType");
  const directiveByCommitType = getNestedValue(directive, "priorityByCommitType");
  const profileByCommitTypeSafe =
    profileByCommitType && typeof profileByCommitType === "object" ? profileByCommitType : {};
  const directiveByCommitTypeSafe =
    directiveByCommitType && typeof directiveByCommitType === "object" ? directiveByCommitType : {};

  const commitPriority = resolveDirectivePriority(
    directiveByCommitTypeSafe[commitType] ?? profileByCommitTypeSafe[commitType],
    directPriority,
  );
  return { priority: commitPriority, sequence };
}

export function sortTakeovers(items = []) {
  return items.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sequence - b.sequence;
  });
}
