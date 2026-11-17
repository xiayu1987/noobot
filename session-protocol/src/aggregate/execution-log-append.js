/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTION_LOG_APPEND_OUTCOME = Object.freeze({
  WRITTEN: "written",
  UNKNOWN: "unknown",
  NOT_WRITTEN: "not_written",
});

export function executionLogAppendFailure(cause, records, outcomes) {
  if (
    !Array.isArray(records) ||
    !records.length ||
    !Array.isArray(outcomes) ||
    outcomes.length !== records.length
  )
    throw new TypeError("Execution append requires one source outcome per record");
  for (const outcome of outcomes)
    if (!Object.values(EXECUTION_LOG_APPEND_OUTCOME).includes(outcome))
      throw new TypeError("Invalid execution append source outcome");

  if (outcomes.every((outcome) => outcome === EXECUTION_LOG_APPEND_OUTCOME.NOT_WRITTEN))
    return cause;
  let commitState = "partial";
  if (outcomes.includes(EXECUTION_LOG_APPEND_OUTCOME.UNKNOWN)) commitState = "unknown";
  else if (outcomes.every((outcome) => outcome === EXECUTION_LOG_APPEND_OUTCOME.WRITTEN))
    commitState = "committed";
  return Object.assign(
    new Error("Execution source append failed; inspect source before retry", {
      cause,
    }),
    {
      code: "EXECUTION_LOG_APPEND_FAILED",
      commitState,
      append: { records, outcomes: [...outcomes] },
    },
  );
}
