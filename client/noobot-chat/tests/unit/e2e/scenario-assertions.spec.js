/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import {
  assertTurnLifecycle,
  settleSessionBeforeCleanup,
} from "../../e2e/protocol/helpers/scenario-assertions.js";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/session-protocol";

afterEach(() => vi.useRealTimers());

function frame(value) {
  return { payload: JSON.stringify({ protocolVersion: 1, ...value }) };
}

function cleanupCapture(commandType = "turn.send") {
  return {
    websocketSent: [
      frame({ commandId: "send", commandType, identity: { sessionId: "s", turnScopeId: "old" } }),
      frame({
        commandId: "next",
        commandType,
        identity: { sessionId: "s", turnScopeId: "active" },
      }),
    ],
    websocketReceived: [
      frame({
        eventId: "old",
        eventType: "turn.completed",
        sessionId: "s",
        turnScopeId: "old",
        sequence: 1,
      }),
    ],
  };
}

function terminalFrame(overrides = {}) {
  return frame({
    eventId: "terminal",
    eventType: "turn.stop_completed",
    sessionId: "s",
    turnScopeId: "active",
    sequence: 2,
    ...overrides,
  });
}

it.each(["turn.send", "turn.resend", "turn.continue"])(
  "cleanup waits for the active %s to settle after stop returns",
  async (commandType) => {
    vi.useFakeTimers();
    const capture = cleanupCapture(commandType);
    const stop = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn();
    const pending = settleSessionBeforeCleanup(capture, "s", stop).then(release);
    await vi.advanceTimersByTimeAsync(100);
    expect(stop).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    capture.websocketReceived.push(terminalFrame({ sessionId: "other" }));
    capture.websocketReceived.push(
      terminalFrame({ eventType: "turn.failed", phase: "stop", failure: { retryable: true } }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(release).not.toHaveBeenCalled();
    capture.websocketReceived.push(terminalFrame());
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "turn.stop_completed" }),
    );
  },
);

it("cleanup does not stop an already settled session", async () => {
  const capture = cleanupCapture();
  capture.websocketReceived.push(terminalFrame());
  const stop = vi.fn();
  await settleSessionBeforeCleanup(capture, "s", stop);
  expect(stop).not.toHaveBeenCalled();
});

it("cleanup propagates stop failure and prevents resource release", async () => {
  const stopError = new Error("stop failed");
  const release = vi.fn();
  const pending = settleSessionBeforeCleanup(cleanupCapture(), "s", () =>
    Promise.reject(stopError),
  ).then(release);
  await expect(pending).rejects.toBe(stopError);
  expect(release).not.toHaveBeenCalled();
});

it("cleanup permits resource release when no turn was sent", async () => {
  const stop = vi.fn();
  await settleSessionBeforeCleanup({ websocketSent: [], websocketReceived: [] }, "s", stop);
  expect(stop).not.toHaveBeenCalled();
});

it("waits for the terminal browser receipt after observing the lifecycle event", async () => {
  const event = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: "turn.stop_completed",
    eventId: "terminal-event",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    sequence: 1,
    revision: 1,
  };
  const receipt = {
    action: "turn.lifecycle.received",
    protocolVersion: 1,
    eventId: event.eventId,
    sessionId: event.sessionId,
    turnScopeId: event.turnScopeId,
  };
  const capture = {
    websocketReceived: [{ payload: JSON.stringify(event) }],
    websocketSent: [{ payload: JSON.stringify({ ...receipt, turnScopeId: "another-turn" }) }],
  };
  let resolved = false;
  const pending = assertTurnLifecycle(capture, event.sessionId, event.turnScopeId).then(
    (events) => {
      resolved = true;
      return events;
    },
  );
  await Promise.resolve();
  expect(resolved).toBe(false);
  capture.websocketSent.push({ payload: JSON.stringify(receipt) });
  await expect(pending).resolves.toEqual([event]);
});
