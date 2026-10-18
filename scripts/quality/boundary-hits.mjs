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
