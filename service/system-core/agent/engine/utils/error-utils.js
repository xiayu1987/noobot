/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { tEngine } from "../i18n-adapter.js";

export { isAbortError } from "../../../utils/error-utils.js";

export function assertNotAborted(signal = null, runtime = {}) {
  if (!signal?.aborted) return;
  const msg = tEngine(runtime, "abortError");
  const error = new Error(msg);
  error.name = "AbortError";
  throw error;
}
