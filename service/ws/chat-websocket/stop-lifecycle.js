/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EXECUTION_ABORT_TYPE,
  isExecutionAbortError,
  isExecutionUserStop,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";

export function isAbortLikeError(error) {
  return isExecutionAbortError({ error });
}

export function isUserStopRunAbort(abortSignal = null) {
  return isExecutionUserStop({ abortSignal });
}

export function isSocketCloseRunAbort(abortSignal = null) {
  return resolveExecutionAbortType({ abortSignal }) === EXECUTION_ABORT_TYPE.SOCKET_CLOSE;
}
