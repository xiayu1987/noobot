/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SCRIPT_TERMINATION = Object.freeze({
  EXITED: "exited",
  SIGNALED: "signaled",
  TIMEOUT: "timeout",
  ABORTED: "aborted",
  OUTPUT_LIMIT: "output_limit",
  SPAWN_FAILED: "spawn_failed",
  PROTOCOL_ERROR: "protocol_error",
});

export const SCRIPT_FAILURE_CODE = Object.freeze({
  LEGACY_TERMINATION_UNKNOWN: "LEGACY_SCRIPT_TERMINATION_UNKNOWN",
  [SCRIPT_TERMINATION.EXITED]: "RECOVERABLE_SCRIPT_NON_ZERO_EXIT",
  [SCRIPT_TERMINATION.SIGNALED]: "RECOVERABLE_SCRIPT_SIGNALED",
  [SCRIPT_TERMINATION.TIMEOUT]: "RECOVERABLE_SCRIPT_TIMEOUT",
  [SCRIPT_TERMINATION.ABORTED]: "RECOVERABLE_SCRIPT_ABORTED",
  [SCRIPT_TERMINATION.OUTPUT_LIMIT]: "RECOVERABLE_SCRIPT_OUTPUT_LIMIT_EXCEEDED",
  [SCRIPT_TERMINATION.SPAWN_FAILED]: "RECOVERABLE_SCRIPT_SPAWN_FAILED",
  [SCRIPT_TERMINATION.PROTOCOL_ERROR]: "RECOVERABLE_SCRIPT_PROTOCOL_ERROR",
});

const TERMINATIONS = new Set(Object.values(SCRIPT_TERMINATION));

const MESSAGE_REQUIRED = new Set([
  SCRIPT_TERMINATION.TIMEOUT,
  SCRIPT_TERMINATION.ABORTED,
  SCRIPT_TERMINATION.OUTPUT_LIMIT,
  SCRIPT_TERMINATION.SPAWN_FAILED,
  SCRIPT_TERMINATION.PROTOCOL_ERROR,
]);

const RUNNER_FACT_FLAGS = Object.freeze([
  "timedOut",
  "aborted",
  "outputLimitExceeded",
  "spawnFailed",
  "protocolViolated",
]);

function assertFacts(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("script outcome facts must be an object");
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`script outcome fact ${key} is required`);
  }
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertExitCode(exitCode) {
  if (!Number.isInteger(exitCode)) {
    throw new TypeError("script outcome exitCode must be an integer");
  }
}

function failureMessage({ termination, exitCode, signal, message }) {
  if (MESSAGE_REQUIRED.has(termination)) {
    if (!isNonEmptyText(message)) {
      throw new TypeError(`script outcome ${termination} requires a message`);
    }
    return message;
  }
  if (termination === SCRIPT_TERMINATION.SIGNALED) return `script terminated by signal ${signal}`;
  return `script exited with code ${exitCode}`;
}

export function projectScriptOutcome(input) {
  assertFacts(input, ["termination", "exitCode", "signal"]);
  const { termination, exitCode, signal, message } = input;
  if (!TERMINATIONS.has(termination)) {
    throw new TypeError(`unsupported script termination: ${String(termination)}`);
  }
  if (exitCode !== null) assertExitCode(exitCode);
  if (signal !== null && !isNonEmptyText(signal)) {
    throw new TypeError("script outcome signal must be a non-empty string");
  }
  if (termination === SCRIPT_TERMINATION.EXITED && exitCode === null) {
    throw new TypeError("script outcome exited requires exitCode");
  }
  if (termination === SCRIPT_TERMINATION.SIGNALED && signal === null) {
    throw new TypeError("script outcome signaled requires signal");
  }
  const ok = termination === SCRIPT_TERMINATION.EXITED && exitCode === 0;
  return {
    ok,
    termination,
    ...(exitCode !== null ? { exitCode } : {}),
    ...(signal !== null ? { signal } : {}),
    ...(ok
      ? {}
      : {
          code: SCRIPT_FAILURE_CODE[termination],
          error: failureMessage({ termination, exitCode, signal, message }),
        }),
  };
}

export function resolveScriptTermination(facts) {
  assertFacts(facts, [...RUNNER_FACT_FLAGS, "exitCode", "signal"]);
  for (const flag of RUNNER_FACT_FLAGS) {
    if (typeof facts[flag] !== "boolean") {
      throw new TypeError(`script runner fact ${flag} must be boolean`);
    }
  }
  const {
    timedOut,
    aborted,
    outputLimitExceeded,
    spawnFailed,
    protocolViolated,
    exitCode,
    signal,
  } = facts;
  if (spawnFailed) return SCRIPT_TERMINATION.SPAWN_FAILED;
  if (protocolViolated) return SCRIPT_TERMINATION.PROTOCOL_ERROR;
  if (outputLimitExceeded) return SCRIPT_TERMINATION.OUTPUT_LIMIT;
  if (timedOut) return SCRIPT_TERMINATION.TIMEOUT;
  if (aborted) return SCRIPT_TERMINATION.ABORTED;
  if (Number.isInteger(exitCode)) return SCRIPT_TERMINATION.EXITED;
  if (isNonEmptyText(signal)) return SCRIPT_TERMINATION.SIGNALED;
  throw new TypeError("script process ended without exit code or signal");
}
