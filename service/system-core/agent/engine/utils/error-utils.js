/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { isAbortError } from "../../utils/error-utils.js";

export function assertNotAborted(signal = null) {
  if (!signal?.aborted) return;
  const error = new Error("dialog stopped by user");
  error.name = "AbortError";
  throw error;
}
