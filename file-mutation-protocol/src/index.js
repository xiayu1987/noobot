/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_MUTATION_PROTOCOL = "noobot.file-mutation-result";
export const FILE_MUTATION_VERSION = 2;

function linesOf(value = "") {
  const lines = String(value).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createFileDiff(before = "", after = "") {
  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  const width = newLines.length + 1;
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(width));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1)
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1)
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ type: "context", oldLine: oldIndex + 1, newLine: newIndex + 1, text: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])) {
      rows.push({ type: "added", oldLine: null, newLine: newIndex + 1, text: newLines[newIndex++] });
    } else {
      rows.push({ type: "removed", oldLine: oldIndex + 1, newLine: null, text: oldLines[oldIndex++] });
    }
  }
  const additions = rows.filter((row) => row.type === "added").length;
  const deletions = rows.filter((row) => row.type === "removed").length;
  return { format: "git-lines-v1", additions, deletions, changedLines: additions + deletions, lines: rows };
}

export function createFileMutationResult({
  id,
  operation,
  path,
  fileName,
  before,
  after,
  diff,
  aggregate = null,
  sessionScope = null,
  updatedAt,
}) {
  const { lines: _lines, ...diffSummary } = diff || {};
  const mutation = {
    id,
    operation,
    path,
    fileName,
    before,
    after,
    diff: diff ? diffSummary : null,
    aggregate: aggregate || null,
    ...(sessionScope && typeof sessionScope === "object" ? { sessionScope } : {}),
    updatedAt: updatedAt || new Date().toISOString(),
  };
  return {
    protocol: FILE_MUTATION_PROTOCOL,
    version: FILE_MUTATION_VERSION,
    ok: true,
    mutations: [mutation],
  };
}

export function assertFileMutationResult(value) {
  const mutations = value?.mutations;
  if (
    !value ||
    value.protocol !== FILE_MUTATION_PROTOCOL ||
    value.version !== FILE_MUTATION_VERSION ||
    !Array.isArray(mutations) ||
    !mutations.length ||
    mutations.some((mutation) => {
      if (!mutation?.id) return true;
      const aggregate = mutation.aggregate;
      if (aggregate === null || aggregate === undefined) return false;
      return (
        !aggregate ||
        !String(aggregate.scopeId || "").trim() ||
        !String(aggregate.path || "").trim() ||
        !Number.isInteger(aggregate.revision) ||
        aggregate.revision < 1 ||
        !Number.isInteger(aggregate.diffCount) ||
        aggregate.diffCount < 1
      );
    })
  ) {
    throw new TypeError("invalid file mutation result");
  }
  return value;
}

function canonicalMutation(value) {
  assertFileMutationResult(value);
  return value.mutations[0];
}

export function createFileMutationDiffPreview(value) {
  const mutation = canonicalMutation(value);
  return {
    ok: true,
    protocol: value.protocol,
    version: value.version,
    mutationId: mutation.id,
    path: mutation.path,
    diff: value.snapshots?.diff || null,
  };
}

export function createFileMutationFilePreview(value) {
  const mutation = canonicalMutation(value);
  const after = value.snapshots?.after;
  const afterMeta = mutation.after || {};
  return {
    ok: true,
    protocol: value.protocol,
    version: value.version,
    mutationId: mutation.id,
    path: mutation.path,
    isText: afterMeta.isText === true,
    size: afterMeta.size ?? 0,
    content: typeof after === "string" ? after : "",
  };
}
