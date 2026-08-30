/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function mergeDuplicationIgnoreGlobs(
  configuredIgnoreGlobs = [],
  sourceIgnoreGlobs = [],
) {
  const configured = Array.isArray(configuredIgnoreGlobs) ? configuredIgnoreGlobs : [];
  const source = Array.isArray(sourceIgnoreGlobs) ? sourceIgnoreGlobs : [];
  return [...new Set([...configured, ...source])];
}
