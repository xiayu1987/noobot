/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortReason,
} from "@noobot/session-protocol/execution-abort";

const PRIMARY_IDENTITY_FIELDS = Object.freeze(["code", "statusCode", "type", "stopType"]);

function readPrimaryMessage(error) {
  if (error instanceof Error) return error.message;
  if (resolveExecutionAbortReason({ error })) return resolveExecutionAbortMessage({ error });
  throw new TypeError("ExecutionFailure primary error must be an Error or execution abort reason");
}

function buildFailureCause(primaryError, followUpErrors) {
  if (!Array.isArray(followUpErrors)) {
    throw new TypeError("ExecutionFailure followUpErrors must be an array");
  }
  if (!followUpErrors.length) return primaryError;
  return new AggregateError([primaryError, ...followUpErrors], readPrimaryMessage(primaryError), {
    cause: primaryError,
  });
}

class ExecutionFailure extends Error {
  constructor(primaryError, lifecycle, followUpErrors) {
    super(readPrimaryMessage(primaryError), {
      cause: buildFailureCause(primaryError, followUpErrors),
    });
    this.name = "ExecutionFailure";
    this.lifecycle = lifecycle;
    for (const field of PRIMARY_IDENTITY_FIELDS) {
      if (primaryError?.[field] !== undefined) this[field] = primaryError[field];
    }
  }
}

export function createExecutionFailure(primaryError, lifecycle = null, followUpErrors = []) {
  return new ExecutionFailure(primaryError, lifecycle, followUpErrors);
}
