/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_CHANNEL_STATE,
  FrontendRunState,
  SESSION_RUN_EVENT,
  resolveEventScope,
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  reduceTurnRuntimeEvent as reduceNormalizedTurnRuntimeEvent,
  TURN_TRANSITION_REASON,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnReducer.js";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";
import { normalizeSessionRunEvent } from "../../../../../../src/modules/chat/runtime/run-state-machine/eventNormalization.js";

const reduceTurnRuntimeEvent = (current, rawEvent) =>
  reduceNormalizedTurnRuntimeEvent(current, normalizeSessionRunEvent(rawEvent));

const processingStarted = {
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  eventType: TURN_EVENT.PROCESSING_STARTED,
  phase: TURN_PHASE.PROCESSING,
  state: TURN_STATE.PROCESSING,
  executionState: AGENT_CHANNEL_STATE.SENDING,
  capabilities: { actionLocked: true, canStop: true },
};
const actionAccepted = {
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  eventType: TURN_EVENT.ACTION_ACCEPTED,
  phase: TURN_PHASE.ACTION,
  state: TURN_STATE.ACTION_REQUESTING,
  action: "send",
};
const processingCompleted = {
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  eventType: TURN_EVENT.PROCESSING_COMPLETED,
  phase: TURN_PHASE.COMPLETION,
  state: TURN_STATE.COMPLETION_REQUESTING,
};
const stopAccepted = {
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  eventType: TURN_EVENT.STOP_ACCEPTED,
  phase: TURN_PHASE.STOP,
  state: TURN_STATE.ACTION_REQUESTING,
  action: "stop",
};
const stopProcessingCompleted = {
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
  phase: TURN_PHASE.STOP,
  state: TURN_STATE.STOPPING,
};
const completionCommit = { completionCommitId: "completion-commit-1", summaryVersion: 1 };
const terminalResolved = (state) => ({
  type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
  state,
  revision: 10,
  seq: 10,
  ...completionCommit,
});

const identity = { sessionId: "s1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" };
function apply(current, event) {
  const result = reduceTurnRuntimeEvent(current, { ...identity, ...event });
  expect(result.applied, result.reason).toBe(true);
  return { ...result.next, ...identity };
}

describe("sessionRunStateMachine scope separation", () => {
  it.each([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
  ])("retains the new Turn identity for %s", (type) => {
    const turn = apply(null, { type });
    expect(turn).toMatchObject({ ...identity, commandPending: true, pendingCommandType: "action" });
    expect(turn.state).toBeUndefined();
  });

  it("keeps processing facts scoped to their exact Turn", () => {
    const localRequest = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    const started = apply(localRequest, actionAccepted);
    const transport = apply(started, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: AGENT_CHANNEL_STATE.SENDING,
    });
    expect(transport).toMatchObject({ ...identity, state: FrontendRunState.ACTION_REQUESTING });
    expect(apply(transport, processingStarted)).toMatchObject({
      ...identity,
      state: FrontendRunState.PROCESSING,
    });
    const transportOnly = reduceTurnRuntimeEvent(started, {
      ...identity,
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: AGENT_CHANNEL_STATE.INTERACTION_PENDING,
    });
    expect(transportOnly).toMatchObject({ applied: true });
    expect(started).toMatchObject({ ...identity, state: FrontendRunState.ACTION_REQUESTING });
  });

  it("uses distinct completion and stop phases on the same Turn", () => {
    let processing = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    processing = apply(processing, actionAccepted);
    processing = apply(processing, processingStarted);
    const completion = apply(processing, processingCompleted);
    const stopRequest = apply(processing, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    });
    expect(completion.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    expect(stopRequest).toMatchObject({
      state: FrontendRunState.PROCESSING,
      commandPending: true,
      pendingCommandType: "stop",
      action: "stop",
    });
  });

  it("rejects a differently scoped event instead of clearing another Turn lock", () => {
    const started = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    expect(identity.sessionId).not.toBe("another-session");
    expect(
      reduceTurnRuntimeEvent(started, {
        ...identity,
        type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
        sessionId: "another-session",
      }),
    ).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
    expect(started).toMatchObject({ commandPending: true, pendingCommandType: "action" });
    expect(started.state).toBeUndefined();
  });

  it("compares Turn identity case-sensitively and keeps command identity verbatim", () => {
    const mixedIdentity = { sessionId: "S1", dialogProcessId: "dialog-1", turnScopeId: "Turn-A" };
    const started = reduceTurnRuntimeEvent(null, {
      ...mixedIdentity,
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      commandId: "Cmd-A",
    }).next;
    expect(started).toMatchObject({ commandId: "Cmd-A", pendingCommandId: "Cmd-A" });
    expect(
      reduceTurnRuntimeEvent(
        { ...started, ...mixedIdentity },
        {
          ...mixedIdentity,
          type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
          turnScopeId: "turn-a",
        },
      ),
    ).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
    expect(
      reduceTurnRuntimeEvent(
        { ...started, ...mixedIdentity },
        {
          ...mixedIdentity,
          type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
          sessionId: "s1",
        },
      ),
    ).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
  });

  it("keeps the completion commit identity verbatim", () => {
    let processing = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    processing = apply(processing, actionAccepted);
    processing = apply(processing, processingStarted);
    let completion = apply(processing, processingCompleted);
    completion = apply(completion, {
      type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
      state: TURN_STATE.COMPLETED,
      revision: 10,
      seq: 10,
      completionCommitId: "Cmd-A:completed",
      summaryVersion: 1,
    });
    expect(completion.authoritativeCompletionCommit).toMatchObject({
      completionCommitId: "Cmd-A:completed",
    });
  });

  it("settles summaries into explicit terminal states rather than identity-free idle", () => {
    let processing = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    processing = apply(processing, actionAccepted);
    processing = apply(processing, processingStarted);
    let completion = apply(processing, processingCompleted);
    completion = apply(completion, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
      state: TURN_STATE.COMPLETED,
      ...completionCommit,
    });
    completion = apply(completion, terminalResolved(TURN_STATE.COMPLETED));
    expect(completion).toMatchObject({ ...identity, state: FrontendRunState.FRONTEND_COMPLETED });

    let stopping = apply(processing, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    stopping = apply(stopping, stopAccepted);
    stopping = apply(stopping, stopProcessingCompleted);
    stopping = apply(stopping, terminalResolved(TURN_STATE.STOP_COMPLETED));
    expect(stopping).toMatchObject({ ...identity, state: FrontendRunState.USER_STOP_COMPLETED });
  });

  it("resolves event scope from turnScopeId only", () => {
    expect(resolveEventScope({ dialogProcessId: " dialog-1 ", turnScopeId: " client-1 " })).toBe(
      "client-1",
    );
    expect(resolveEventScope({ turnScopeId: " turn-1 " })).toBe("turn-1");
    expect(resolveEventScope({ dialogProcessId: " dialog-1 " })).toBe("");
  });
});
