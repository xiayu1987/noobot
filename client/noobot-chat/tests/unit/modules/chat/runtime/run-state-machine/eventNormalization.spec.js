/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  TURN_RUNTIME_AUTHORITY,
  normalizeSessionRunEvent,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/eventNormalization.js";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";

describe("normalizeSessionRunEvent", () => {
  it("reads authoritative state from the top-level lifecycle envelope", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      seq: 7,
      state: "COMPLETED",
    });
    expect(normalized.state).toBe("completed");
    expect(normalized.lifecycleSeq).toBe(7);
    expect(normalized.seq).toBe(7);
    expect(normalized.transportSeq).toBe(0);
  });

  it("exposes terminal resolution as authoritative turn state and applied authority", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
      state: "Failed",
      finalizeIntent: "abort",
      failure: { code: "model_failed" },
    });
    expect(normalized.authoritativeTurnState).toBe("failed");
    expect(normalized.authority).toBe(TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_APPLIED);
    expect(normalized.finalizeIntent).toBe("abort");
    expect(normalized.failure).toEqual({ code: "model_failed" });
  });

  it("does not read turn payload from a nested raw.turn copy", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
      raw: { turn: { state: "failed", finalizeIntent: "abort", failure: { code: "x" } } },
    });
    expect(normalized.authoritativeTurnState).toBe("");
    expect(normalized.finalizeIntent).toBeNull();
    expect(normalized.failure).toBeNull();
  });

  it("treats local_failure as a non-protocol event without failureState derivation", () => {
    const normalized = normalizeSessionRunEvent({
      type: "local_failure",
      failureState: "error",
      state: "running",
    });
    expect(normalized.state).toBe("sending");
    expect(normalized.authoritativeTurnState).toBe("");
  });

  it("marks frontend completion failure with failed authority", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    });
    expect(normalized.authority).toBe(TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_FAILED);
  });

  it("prefers an explicit authority over the derived one", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
      authority: "  custom_authority  ",
    });
    expect(normalized.authority).toBe("custom_authority");
  });

  it("clears dialogProcessId for turn-starting events but keeps it otherwise", () => {
    const started = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      dialogProcessId: "dialog-1",
    });
    const other = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      dialogProcessId: "dialog-1",
    });
    expect(started.dialogProcessId).toBe("");
    expect(other.dialogProcessId).toBe("dialog-1");
  });

  it("routes seq into transportSeq for backend state events", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      seq: 12,
    });
    expect(normalized.transportSeq).toBe(12);
    expect(normalized.lifecycleSeq).toBe(0);
  });

  it("keeps derived sequences at zero for local events", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      seq: 5,
      transportSeq: 9,
      lifecycleSeq: 9,
    });
    expect(normalized.seq).toBe(5);
    expect(normalized.transportSeq).toBe(0);
    expect(normalized.lifecycleSeq).toBe(0);
  });

  it("normalizes a missing or zero seq to zero without reading aliases", () => {
    const missing = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      sequence: 4,
    });
    const zero = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      seq: 0,
    });
    expect([missing.seq, missing.lifecycleSeq, missing.transportSeq]).toEqual([0, 0, 0]);
    expect([zero.seq, zero.lifecycleSeq, zero.transportSeq]).toEqual([0, 0, 0]);
  });

  it("falls back through timestamp, updatedAt then createdAt", () => {
    expect(normalizeSessionRunEvent({ timestamp: 1000 }).timestamp).toBe(1000);
    expect(normalizeSessionRunEvent({ updatedAtMs: 2000 }).timestamp).toBe(2000);
    const iso = "2026-01-02T03:04:05.000Z";
    expect(normalizeSessionRunEvent({ updatedAt: iso }).timestamp).toBe(Date.parse(iso));
    expect(normalizeSessionRunEvent({ createdAt: iso }).timestamp).toBe(Date.parse(iso));
    expect(normalizeSessionRunEvent({}).timestamp).toBeGreaterThan(0);
  });

  it("defaults the type to the backend conversation state and retains the raw event", () => {
    const rawEvent = { state: "running" };
    const normalized = normalizeSessionRunEvent(rawEvent);
    expect(normalized.type).toBe(SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE);
    expect(normalized.raw).toBe(rawEvent);
  });

  it("does not carry a terminal materialization field", () => {
    expect(normalizeSessionRunEvent({ materialization: { kind: "full" } })).not.toHaveProperty(
      "materialization",
    );
  });

  it("reads phase only from the top-level protocol field", () => {
    expect(normalizeSessionRunEvent({ failure: { phase: "tool" } }).phase).toBe("");
    expect(normalizeSessionRunEvent({ phase: "processing" }).phase).toBe("processing");
  });
});
