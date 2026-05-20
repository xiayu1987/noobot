/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendJsonlBuffered } from "../lib/store.js";
import { createRunPaths, ensureRunDir } from "../runtime-context.js";

export function createRunTraceSink(ctx = {}, options = {}) {
  return async (record = {}) => {
    const paths = createRunPaths(ctx, options);
    if (!paths) return;
    await ensureRunDir(paths);
    await appendJsonlBuffered(
      paths.capabilityTraces,
      record,
      options.jsonlFlushStrategy || options.jsonlBatchSize,
      options.jsonlFlushIntervalMs,
    );
  };
}
