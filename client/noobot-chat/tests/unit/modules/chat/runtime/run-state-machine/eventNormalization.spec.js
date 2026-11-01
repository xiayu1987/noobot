/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTurnLifecycleEnvelope } from "@noobot/session-protocol";
import {
  createLocalSessionRunEvent,
  SESSION_RUN_EVENT,
} from "@noobot/session-protocol/runtime-event";
import {
  applyTurnRuntimeEvent,
  applyTurnLifecycleEnvelope,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createRuntimeEventProjector } from "../../../../../../src/modules/chat/runtime/session/runtimeEventProjector.js";

function envelope() {
  return createTurnLifecycleEnvelope({
    eventType: "turn.processing_started",
    eventId: "event-1",
    commandId: "command-1",
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "t1",
    presentationMessageId: "message-1",
    dialogProcessId: "dp1",
    revision: 2,
    sequence: 2,
    state: "processing",
    phase: "processing",
    action: "send",
    executionState: "sending",
    capabilities: { actionLocked: true, canStop: true },
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    occurredAt: "2026-01-01T00:00:01.000Z",
  });
}

afterEach(() => vi.useRealTimers());

describe("runtime event input contract", () => {
  it("replays authoritative events independently of the local clock", () => {
    vi.useFakeTimers();
    const input = envelope();
    const before = structuredClone(input);
    const first = createTurnRuntimeRegistryState();
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    expect(applyTurnLifecycleEnvelope(first, input).applied).toBe(true);
    const second = createTurnRuntimeRegistryState();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    expect(applyTurnLifecycleEnvelope(second, input).applied).toBe(true);
    expect(second).toEqual(first);
    expect(first.sessions.s1.turns.t1.updatedAtMs).toBe(Date.parse(input.updatedAt));
    expect(input).toEqual(before);
  });

  it.each(["sessionId", "turnScopeId", "dialogProcessId", "updatedAt", "sequence", "revision"])(
    "rejects missing authoritative %s before changing the registry",
    (field) => {
      const input = envelope();
      delete input[field];
      const registry = createTurnRuntimeRegistryState();
      const before = structuredClone(registry);
      expect(applyTurnLifecycleEnvelope(registry, input)).toMatchObject({
        applied: false,
        reason: "invalid_authoritative_envelope",
      });
      expect(registry).toEqual(before);
    },
  );

  it("does not recover a transport event identity from an existing dialog route", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleEnvelope(registry, envelope());
    const before = structuredClone(registry);
    expect(
      applyTurnRuntimeEvent(registry, {
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        dialogProcessId: "dp1",
        state: "completed",
        seq: 3,
        updatedAtMs: 1767225602000,
      }),
    ).toMatchObject({ applied: false, reason: "missing_turn_identity" });
    expect(registry).toEqual(before);
  });

  it("keeps a local event timestamp across consumption under a different clock", () => {
    vi.useFakeTimers();
    const input = createLocalSessionRunEvent(
      { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "t1" },
      1000,
    );
    vi.setSystemTime(9000);
    const registry = createTurnRuntimeRegistryState();
    expect(applyTurnRuntimeEvent(registry, input).applied).toBe(true);
    expect(registry.sessions.s1.turns.t1.updatedAtMs).toBe(1000);
  });

  it("creates local time at the session dispatch producer before store consumption", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const registry = createTurnRuntimeRegistryState();
    const apply = vi.fn((input) => applyTurnRuntimeEvent(registry, input));
    const submit = createRuntimeEventProjector({
      turnRuntimeRegistry: { value: registry },
      chatStore: { applyTurnRuntimeEvent: apply },
      resolveActiveSessionIdentity: () => "s1",
    });
    submit({ type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "t1" });
    expect(apply.mock.calls[0][0].timestamp).toBe(1000);
    expect(registry.sessions.s1.turns.t1.updatedAtMs).toBe(1000);
  });
});
