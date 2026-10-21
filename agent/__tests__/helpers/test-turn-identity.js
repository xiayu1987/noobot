/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

const IDENTITY_KEYS = Object.freeze([
  "userId",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
  "runId",
  "presentationMessageId",
]);

const SYSTEM_RUNTIME_IDENTITY_KEYS = Object.freeze([
  "userId",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
]);

const RUN_CONFIG_IDENTITY_KEYS = Object.freeze([
  "turnScopeId",
  "executionId",
  "presentationMessageId",
]);

export function createTestTurnIdentity(label) {
  return Object.freeze({
    userId: `user-${label}`,
    sessionId: `session-${label}`,
    rootSessionId: `session-${label}`,
    parentSessionId: "",
    dialogProcessId: `dialog-${label}`,
    turnScopeId: `turn-${label}`,
    runId: `run-${label}`,
    presentationMessageId: `presentation-${label}`,
  });
}

export function overrideTestTurnIdentity(identity, overrides) {
  const unknown = Object.keys(overrides).filter((key) => !IDENTITY_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`unknown test turn identity keys: ${unknown.join(", ")}`);
  }
  return Object.freeze({ ...identity, ...overrides });
}

function assertCompleteIdentity(identity) {
  const keys = Object.keys(identity).sort();
  if (keys.join(",") !== [...IDENTITY_KEYS].sort().join(",")) {
    throw new TypeError(`test turn identity must have exactly: ${IDENTITY_KEYS.join(", ")}`);
  }
}

export function applyTestIdentityToRuntime(runtime, identity) {
  if (!isPlainObject(runtime.systemRuntime) || !isPlainObject(runtime.runConfig)) {
    throw new TypeError("test runtime requires plain systemRuntime and runConfig objects");
  }
  assertCompleteIdentity(identity);
  const preset = [
    ...SYSTEM_RUNTIME_IDENTITY_KEYS.filter((key) => key in runtime.systemRuntime),
    ...RUN_CONFIG_IDENTITY_KEYS.filter((key) => key in runtime.runConfig),
  ];
  if (preset.length > 0) {
    throw new TypeError(
      `identity must be passed via the identity option, not runtime: ${preset.join(", ")}`,
    );
  }
  for (const key of SYSTEM_RUNTIME_IDENTITY_KEYS) {
    runtime.systemRuntime[key] = identity[key];
  }
  runtime.runConfig = {
    ...runtime.runConfig,
    turnScopeId: identity.turnScopeId,
    executionId: identity.runId,
    presentationMessageId: identity.presentationMessageId,
  };
  return identity;
}
