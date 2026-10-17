/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isFunction } from "./value.js";
function defaultReportDiagnostic(diagnostic) {
  console.warn("[best-effort] operation failed", diagnostic);
}

export async function runBestEffort(
  operation,
  { operationName, context = {}, reportDiagnostic = defaultReportDiagnostic } = {},
) {
  if (!isFunction(operation)) {
    throw new TypeError("runBestEffort operation must be a function");
  }
  const normalizedOperationName = text(operationName);
  if (!normalizedOperationName) {
    throw new TypeError("runBestEffort operationName is required");
  }
  if (!isFunction(reportDiagnostic)) {
    throw new TypeError("runBestEffort reportDiagnostic must be a function");
  }

  try {
    return await operation();
  } catch (error) {
    reportDiagnostic({
      event: "best_effort_operation_failed",
      operation: normalizedOperationName,
      context: context && typeof context === "object" ? context : {},
      error,
    });
    return undefined;
  }
}
