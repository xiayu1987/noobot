/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  FrontendRunState,
  clearRememberedStopRequests,
  rememberStopRequestedEvent,
  resolveRememberedStopRequestedEvent,
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    },
  });
}

describe("sessionRunStateMachine remembered stop requests", () => {
  beforeEach(() => installStorage());

  it("persists remembered stop requests and clears them on terminal", () => {
    rememberStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      commandId: "stop:turn-1",
      timestamp: Date.now(),
    });
    expect(
      resolveRememberedStopRequestedEvent({
        sessionId: "s1",
        dialogProcessId: "d1",
      }),
    ).toBeNull();
    expect(
      resolveRememberedStopRequestedEvent({
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
      }),
    ).toMatchObject({
      state: FrontendRunState.USER_STOPPING,
      commandId: "stop:turn-1",
    });
    clearRememberedStopRequests({ sessionId: "s1", dialogProcessId: "d1", turnScopeId: "turn-1" });
    expect(
      resolveRememberedStopRequestedEvent({
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
      }),
    ).toBeNull();
  });
});
