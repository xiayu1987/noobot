/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const NATIVE_SCRIPT_IPC_CHANNEL = Object.freeze({
  BROWSER_SESSION_REQUEST: "native-script/browser-session-request",
  BROWSER_SESSION_RESULT: "native-script/browser-session-result",
  BROWSER_SESSION_CLOSE_REQUEST: "native-script/browser-session-close-request",
  BROWSER_SESSION_CLOSE_RESULT: "native-script/browser-session-close-result",
  USER_INTERACTION_REQUEST: "native-script/user-interaction-request",
  USER_INTERACTION_RESULT: "native-script/user-interaction-result",
  EXECUTION_RESULT: "native-script/execution-result",
});

export const NATIVE_SCRIPT_IPC_RESULT_CHANNEL = Object.freeze({
  [NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_REQUEST]:
    NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_RESULT,
  [NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_CLOSE_REQUEST]:
    NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_CLOSE_RESULT,
  [NATIVE_SCRIPT_IPC_CHANNEL.USER_INTERACTION_REQUEST]:
    NATIVE_SCRIPT_IPC_CHANNEL.USER_INTERACTION_RESULT,
});

export const NATIVE_SCRIPT_IPC_PENDING_CHANNELS = Object.freeze([
  NATIVE_SCRIPT_IPC_CHANNEL.USER_INTERACTION_REQUEST,
]);

export function isNativeScriptIpcMessage(value) {
  return Boolean(value) && typeof value === "object" && typeof value.type === "string";
}

export const NATIVE_SCRIPT_EXECUTION_STATUS = Object.freeze({
  RETURNED: "returned",
  FAILED: "failed",
});

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function isNativeScriptExecutionResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.status === NATIVE_SCRIPT_EXECUTION_STATUS.FAILED) {
    return (
      hasExactKeys(value, ["status", "error"]) &&
      typeof value.error === "string" &&
      value.error.trim() !== ""
    );
  }
  if (value.status !== NATIVE_SCRIPT_EXECUTION_STATUS.RETURNED) return false;
  if (value.present === true) return hasExactKeys(value, ["status", "present", "value"]);
  return value.present === false && hasExactKeys(value, ["status", "present"]);
}

export function createPendingInteractionClock({ start, stop }) {
  let pending = 0;
  return {
    get pending() {
      return pending;
    },
    suspend() {
      pending += 1;
      if (pending === 1) stop();
    },
    resume() {
      if (pending === 0) return;
      pending -= 1;
      if (pending === 0) start();
    },
  };
}
