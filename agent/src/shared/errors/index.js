/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "@noobot/shared/value";

export const ERROR_LEVEL = Object.freeze({
  FATAL: "fatal",
  RECOVERABLE: "recoverable",
});

const ERROR_LEVELS = new Set(Object.values(ERROR_LEVEL));

export class NoobotError extends Error {
  constructor(message, { code, level, cause, details } = {}) {
    if (typeof code !== "string" || !code.trim()) {
      throw new TypeError("NoobotError code must be a non-empty string");
    }
    if (!ERROR_LEVELS.has(level)) {
      throw new TypeError(`NoobotError level must be one of: ${[...ERROR_LEVELS].join(", ")}`);
    }
    if (details !== undefined && !isPlainObject(details)) {
      throw new TypeError("NoobotError details must be a plain object");
    }
    super(String(message));
    this.name = "NoobotError";
    this.code = code;
    this.level = level;
    this.fatal = level === ERROR_LEVEL.FATAL;
    this.details = details === undefined ? {} : details;
    if (cause !== undefined) this.cause = cause;
  }
}

export function fatalSystemError(message, options) {
  return new NoobotError(message, { ...options, level: ERROR_LEVEL.FATAL });
}

export function recoverableToolError(message, options) {
  return new NoobotError(message, { ...options, level: ERROR_LEVEL.RECOVERABLE });
}

export function isFatalError(error) {
  return error instanceof NoobotError && error.fatal;
}

export * from "./execution-failure.js";
export * from "./constants.js";
