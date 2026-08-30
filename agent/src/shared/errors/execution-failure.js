/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveFailureMessage(error) {
  if (typeof error === "string") return error.trim();
  return String(
    error?.message || error?.reason || error?.code || error || "execution failed",
  ).trim();
}

export class ExecutionFailure extends Error {
  constructor(error, lifecycle = null) {
    super(resolveFailureMessage(error), { cause: error });
    this.name = "ExecutionFailure";
    this.lifecycle = lifecycle;
    if (error?.code !== undefined) this.code = error.code;
    if (error?.type !== undefined) this.type = error.type;
    if (error?.stopType !== undefined) this.stopType = error.stopType;
  }
}

export function createExecutionFailure(error, lifecycle = null) {
  return new ExecutionFailure(error, lifecycle);
}
