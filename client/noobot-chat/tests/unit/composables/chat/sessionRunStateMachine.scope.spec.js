/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
  rememberStopRequestedEvent,
  resolveEventScope,
  resolveRememberedStopRequestedEvent,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import { reduceTurnRuntimeEvent, TURN_TRANSITION_REASON } from "../../../../src/composables/chat/sessionRunStateMachine/turnReducer";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key), clear: () => map.clear(),
  } });
}

const identity = { sessionId: "s1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" };
function apply(current, event) {
  const result = reduceTurnRuntimeEvent(current, { ...identity, ...event });
  expect(result.applied, result.reason).toBe(true);
  return { ...result.next, ...identity };
}

describe("sessionRunStateMachine scope separation", () => {
  beforeEach(() => { installStorage(); clearRememberedStopRequests(); });

  it.each([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
  ])("retains the new Turn identity for %s", (type) => {
    const turn = apply(null, { type });
    expect(turn).toMatchObject({ ...identity, state: FrontendRunState.ACTION_REQUESTING });
  });

  it("keeps processing facts scoped to their exact Turn", () => {
    const started = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    for (const state of [BackendChannelState.SENDING, BackendChannelState.INTERACTION_PENDING]) {
      expect(apply(started, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state })).toMatchObject({
        ...identity, state: FrontendRunState.PROCESSING,
      });
    }
  });

  it("uses distinct completion and stop phases on the same Turn", () => {
    let processing = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    processing = apply(processing, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    const completion = apply(processing, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED });
    const stopRequest = apply(processing, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(completion.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    expect(stopRequest).toMatchObject({ state: FrontendRunState.ACTION_REQUESTING, action: "stop" });
  });

  it("rejects a differently scoped event instead of clearing another Turn lock", () => {
    const started = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    // The pure reducer owns lifecycle semantics; the Registry owns identity
    // routing and must not call it when this identity differs.
    expect(identity.sessionId).not.toBe("another-session");
    expect(reduceTurnRuntimeEvent(started, {
      ...identity,
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId: "another-session",
    })).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
    expect(started.state).toBe(FrontendRunState.ACTION_REQUESTING);
  });

  it("settles summaries into explicit terminal states rather than identity-free idle", () => {
    let processing = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    processing = apply(processing, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    let completion = apply(processing, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED });
    completion = apply(completion, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED });
    expect(completion).toMatchObject({ ...identity, state: FrontendRunState.FRONTEND_COMPLETED });

    let stopping = apply(processing, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    stopping = apply(stopping, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.USER_STOPPED });
    stopping = apply(stopping, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED });
    expect(stopping).toMatchObject({ ...identity, state: FrontendRunState.USER_STOP_COMPLETED });
  });

  it("keeps remembered stop requests scoped to the exact Turn", () => {
    rememberStopRequestedEvent({ sessionId: "s1", dialogProcessId: "dialog-old", turnScopeId: "turn-old" });
    expect(resolveRememberedStopRequestedEvent({ sessionId: "s1", dialogProcessId: "dialog-old", turnScopeId: "turn-new" })).toBeNull();
    expect(resolveRememberedStopRequestedEvent({ sessionId: "s1", dialogProcessId: "dialog-old", turnScopeId: "turn-old" })).toMatchObject({ turnScopeId: "turn-old" });
  });

  it("resolves event scope from turnScopeId only", () => {
    expect(resolveEventScope({ dialogProcessId: " dialog-1 ", turnScopeId: " client-1 " })).toBe("client-1");
    expect(resolveEventScope({ turnScopeId: " turn-1 " })).toBe("turn-1");
    expect(resolveEventScope({ dialogProcessId: " dialog-1 " })).toBe("");
  });
});
