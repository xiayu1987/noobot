/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAbortError } from "../utils/error-utils.js";

export function classifyEngineError(error = null) {
  if (isAbortError(error) || isAbortError(error?.cause)) {
    return "abort";
  }

  const status = Number(
    error?.status ??
      error?.statusCode ??
      error?.response?.status ??
      error?.cause?.status ??
      error?.cause?.statusCode,
  );

  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) {
    return "retryable";
  }

  return "fatal";
}
