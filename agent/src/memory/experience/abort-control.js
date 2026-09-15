/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { assertNotAborted, isAbortError } from "../../shared/utils/error-utils.js";

export function isAbortLikeError(error = {}) {
  return isAbortError(error);
}

export function throwIfAborted(abortSignal = null) {
  assertNotAborted(abortSignal);
}
