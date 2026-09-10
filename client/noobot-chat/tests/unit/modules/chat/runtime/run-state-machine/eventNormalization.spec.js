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
  it("reads authoritative state from the turn payload for lifecycle events", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      sequence: 7,
      raw: { turn: { state: "COMPLETED" } },
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
      raw: { turn: { finalizeIntent: "abort", failure: { phase: "model" } } },
    });
    expect(normalized.authoritativeTurnState).toBe("failed");
    expect(normalized.authority).toBe(TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_APPLIED);
    expect(normalized.finalizeIntent).toBe("abort");
    expect(normalized.failure).toEqual({ phase: "model" });
  });

  it("derives state from failureState for local failure events", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.LOCAL_FAILURE,
      failureState: "error",
      state: "running",
    });
    expect(normalized.state).toBe("error");
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

  it("routes sequence into transportSeq for backend state events", () => {
    const normalized = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sequence: 12,
    });
    expect(normalized.transportSeq).toBe(12);
    expect(normalized.lifecycleSeq).toBe(0);
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

  it("keeps materialization only when it is an object", () => {
    expect(normalizeSessionRunEvent({ materialization: { kind: "full" } }).materialization).toEqual({
      kind: "full",
    });
    expect(normalizeSessionRunEvent({ materialization: "full" }).materialization).toBeNull();
  });

  it("derives phase from the failure payload when absent", () => {
    const normalized = normalizeSessionRunEvent({ failure: { phase: "tool" } });
    expect(normalized.phase).toBe("tool");
  });
});
