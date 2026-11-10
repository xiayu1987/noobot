/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAbortError } from "../../shared/utils/error-utils.js";
import { isFatalError, NoobotError } from "../../shared/errors/index.js";

export function classifyEngineError(error = null, abortSignal = null) {
  if (abortSignal?.aborted || isAbortError(error) || isAbortError(error?.cause)) {
    return "abort";
  }
  return error instanceof NoobotError && !isFatalError(error) ? "recoverable" : "fatal";
}
