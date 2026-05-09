/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Unified console logger - replaces scattered console.* calls.
 * Provides structured logging with optional file output.
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let _currentLevel = LOG_LEVELS.info;

export function setLogLevel(level) {
  _currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

function formatMessage(level, message, ...args) {
  const ts = new Date().toISOString();
  const prefix = `[${level.toUpperCase()}][${ts}]`;
  return [prefix, message, ...args];
}

export function logDebug(message, ...args) {
  if (_currentLevel <= LOG_LEVELS.debug) {
    // eslint-disable-next-line no-console
    console.debug(...formatMessage("debug", message, ...args));
  }
}

export function logInfo(message, ...args) {
  if (_currentLevel <= LOG_LEVELS.info) {
    // eslint-disable-next-line no-console
    console.info(...formatMessage("info", message, ...args));
  }
}

export function logWarn(message, ...args) {
  if (_currentLevel <= LOG_LEVELS.warn) {
    // eslint-disable-next-line no-console
    console.warn(...formatMessage("warn", message, ...args));
  }
}

export function logError(message, ...args) {
  if (_currentLevel <= LOG_LEVELS.error) {
    // eslint-disable-next-line no-console
    console.error(...formatMessage("error", message, ...args));
  }
}

// Default export as a logger object
export const logger = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError,
  setLogLevel,
};
