/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text as clean } from "@noobot/shared/value";

export function normalizeTurnFailure(failure = null) {
  if (!isPlainObject(failure)) return null;
  return {
    code: clean(failure.code),
    message: clean(failure.message),
    retryable: failure.retryable === true,
  };
}
