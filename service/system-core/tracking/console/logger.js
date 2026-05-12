/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Unified console logger powered by Pino.
 */
import pino from "pino";

const DEFAULT_LEVEL = String(
  process.env.NOOBOT_LOG_LEVEL || process.env.NB_LOG_LEVEL || "error",
)
  .trim()
  .toLowerCase();

const pinoLogger = pino({
  level: DEFAULT_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: "noobot-service",
  },
});

export function setLogLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (normalized) {
    pinoLogger.level = normalized;
  }
}

function writeLog(level, message, ...args) {
  if (typeof message === "object" && message !== null) {
    pinoLogger[level](message);
    return;
  }
  if (!args.length) {
    pinoLogger[level](String(message || ""));
    return;
  }
  const firstArg = args[0];
  if (args.length === 1 && firstArg && typeof firstArg === "object") {
    pinoLogger[level](firstArg, String(message || ""));
    return;
  }
  pinoLogger[level]({ args }, String(message || ""));
}

export function logDebug(message, ...args) {
  writeLog("debug", message, ...args);
}

export function logInfo(message, ...args) {
  writeLog("info", message, ...args);
}

export function logWarn(message, ...args) {
  writeLog("warn", message, ...args);
}

export function logError(message, ...args) {
  writeLog("error", message, ...args);
}

export const logger = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError,
  setLogLevel,
  raw: pinoLogger,
};

