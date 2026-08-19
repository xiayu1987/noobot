/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function defaultReportDiagnostic(diagnostic) {
  console.warn("[best-effort] operation failed", diagnostic);
}

export async function runBestEffort(
  operation,
  { operationName, context = {}, reportDiagnostic = defaultReportDiagnostic } = {},
) {
  if (typeof operation !== "function") {
    throw new TypeError("runBestEffort operation must be a function");
  }
  const normalizedOperationName = String(operationName || "").trim();
  if (!normalizedOperationName) {
    throw new TypeError("runBestEffort operationName is required");
  }
  if (typeof reportDiagnostic !== "function") {
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
