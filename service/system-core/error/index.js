/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ERROR_CODE } from "./constants.js";
export class NoobotError extends Error {
  constructor(
    message = "",
    {
      code = ERROR_CODE.NOOBOT_ERROR,
      level = "recoverable",
      cause = undefined,
      details = {},
    } = {},
  ) {
    super(String(message || ""));
    this.name = "NoobotError";
    this.code = String(code || ERROR_CODE.NOOBOT_ERROR);
    this.level = level === "fatal" ? "fatal" : "recoverable";
    this.fatal = this.level === "fatal";
    this.details = details && typeof details === "object" ? details : {};
    if (cause !== undefined) this.cause = cause;
  }
}

export function fatalSystemError(message, options = {}) {
  return new NoobotError(message, {
    ...options,
    level: "fatal",
    code: options?.code || ERROR_CODE.FATAL_SYSTEM_ERROR,
  });
}

export function recoverableToolError(message, options = {}) {
  return new NoobotError(message, {
    ...options,
    level: "recoverable",
    code: options?.code || ERROR_CODE.RECOVERABLE_TOOL_ERROR,
  });
}

export function isFatalError(error) {
  return Boolean(
    error?.fatal ||
      String(error?.level || "").toLowerCase() === "fatal" ||
      String(error?.code || "").startsWith("FATAL_"),
  );
}

export * from "./constants.js";
