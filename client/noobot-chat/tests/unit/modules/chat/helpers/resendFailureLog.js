/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "vitest";
import { logStateMachineDebug } from "../../../../../src/modules/debug/loggers/stateMachineLogger.js";

export function lastResendFailure() {
  const calls = logStateMachineDebug.mock.calls.filter(
    ([event]) => event === "stateMachine.resend.failed",
  );
  expect(calls).toHaveLength(1);
  return calls[0][1]();
}
