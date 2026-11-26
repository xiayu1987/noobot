/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { addHit, EXEMPTION_KINDS } from "./check-protocol.mjs";
import {
  matchingLineHits,
  offsetLine,
  readRepositoryText,
  repositoryPathExists,
} from "./repository-files.mjs";
import { parseSource } from "./source-ast.mjs";

export function addPatternLineHits({ measurement, file, source, pattern, message }) {
  for (const hit of matchingLineHits(file, source, (text) => pattern.test(text), message)) {
    addHit(measurement, hit);
  }
}

export function addExemptablePatternLineHits({
  usage,
  rule,
  measurement,
  file,
  source,
  pattern,
  message,
}) {
  for (const hit of matchingLineHits(file, source, (text) => pattern.test(text), message)) {
    if (!usage.exempts(rule, EXEMPTION_KINDS.PATH_PREFIX, file)) addHit(measurement, hit);
  }
}

export function addPatternOffsetHits({ measurement, file, source, pattern, message }) {
  for (const match of source.matchAll(pattern)) {
    addHit(measurement, { file, line: offsetLine(source, match.index), message });
  }
}

export function addExemptablePatternOffsetHits({
  usage,
  rule,
  measurement,
  file,
  source,
  pattern,
  message,
}) {
  for (const match of source.matchAll(pattern)) {
    if (usage.exempts(rule, EXEMPTION_KINDS.PATH_PREFIX, file)) continue;
    addHit(measurement, { file, line: offsetLine(source, match.index), message });
  }
}

export async function addRemovedPathHits(measurement, removedPaths, message) {
  for (const file of removedPaths) {
    if (await repositoryPathExists(file)) addHit(measurement, { file, message });
  }
}

export async function addMissingMarkerHits(measurement, file, markers) {
  const source = await readRepositoryText(file);
  for (const marker of markers) {
    if (!source.includes(marker)) addHit(measurement, { file, message: `missing ${marker}` });
  }
}

export async function addMissingConsumerHits(measurement, consumers) {
  for (const [file, marker] of consumers) {
    if (!(await readRepositoryText(file)).includes(marker)) {
      addHit(measurement, { file, message: `must consume ${marker}` });
    }
  }
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportedFunctionRanges(source, file) {
  const ranges = new Map();
  for (const node of parseSource(source, file).body) {
    if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "FunctionDeclaration"
    ) {
      ranges.set(node.declaration.id.name, node.range);
    }
  }
  return ranges;
}

function resolveContractScope(source, scope, functionRanges) {
  if (scope.fn) {
    const range = functionRanges.get(scope.fn);
    if (!range) return null;
    const [start, end] = range;
    return { text: source.slice(start, end), start };
  }
  const index = source.indexOf(scope.around);
  if (index < 0) return null;
  const start = Math.max(0, index - scope.before);
  return {
    text: source.slice(start, index + scope.after),
    start,
  };
}

function addSectionHits({ measured, file, source, section, start }) {
  for (const [name, pattern] of section.required ?? []) {
    if (!pattern.test(section.text)) addHit(measured.missingMarker, { file, message: name });
  }
  for (const [name, pattern] of section.forbidden ?? []) {
    const match = pattern.exec(section.text);
    if (match) {
      const line = offsetLine(source, start + match.index);
      addHit(measured.forbiddenPattern, { file, line, message: name });
    }
  }
}

export function addContractHits({ measured, file, source, contract }) {
  addSectionHits({ measured, file, source, section: { ...contract, text: source }, start: 0 });
  const sections = contract.scoped ?? [];
  const functionRanges = sections.some(({ scope }) => scope.fn)
    ? exportedFunctionRanges(source, file)
    : null;
  for (const scoped of sections) {
    const scope = resolveContractScope(source, scoped.scope, functionRanges);
    if (!scope) {
      addHit(measured.missingMarker, {
        file,
        message: `missing scope ${JSON.stringify(scoped.scope)}`,
      });
      continue;
    }
    const section = { ...scoped, text: scope.text };
    addSectionHits({ measured, file, source, section, start: scope.start });
  }
}
