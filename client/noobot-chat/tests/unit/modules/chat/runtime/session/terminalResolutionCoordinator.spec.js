/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createTerminalResolutionCoordinator } from "../../../../../../src/modules/chat/runtime/terminalResolutionCoordinator.js";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnLifecycleEnvelope, createTurnTerminalResolution } from "@noobot/session-protocol";
import {
  applyTurnRuntimeEvent,
  applyTurnLifecycleEnvelope,
  applyTurnTerminalResolution,
  createTurnRuntimeRegistryState,
  selectSessionTurnRuntime,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function response({
  resolved = true,
  retryable = false,
  revision = 2,
  sequence = 3,
  completionCommitId = "commit-2",
  summaryVersion = 2,
} = {}) {
  return {
    protocolVersion: 2,
    eventType: "turn.terminal_resolved",
    commandId: "resolve-1",
    sessionId: "s-1",
    turnScopeId: "t-1",
    resolved,
    retryable,
    reason: resolved ? "" : "terminal_materialization_not_ready",
    retryAfterMs: 0,
    aggregateVersion: 1,
    revision,
    sequence,
    completionCommitId,
    summaryVersion,
    turn: { revision, sequence },
  };
}

describe("terminalResolutionCoordinator", () => {
  it("traces fetch and apply decisions without exposing the terminal materialization", async () => {
    const traces = [];
    const fetcher = vi.fn(async () => ({
      ...response(),
      turn: { revision: 2, sequence: 3, state: "completed" },
      materialization: { messages: [{ content: "private terminal body" }] },
    }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: () => ({
        applied: true,
        turn: { state: "frontend_completed", terminal: "completed" },
      }),
      onTrace: (event, details) => traces.push({ event, details }),
    });

    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3, source: "test" });

    expect(traces.map((entry) => entry.event)).toEqual([
      "stateMachine.terminal.fetch.start",
      "stateMachine.terminal.fetch.result",
      "stateMachine.terminal.apply",
    ]);
    expect(traces[2].details).toMatchObject({ applied: true, terminal: "completed" });
    expect(JSON.stringify(traces)).not.toContain("private terminal body");
  });

  it("treats terminal notifications as query triggers and unwraps reactive user identity", async () => {
    let release;
    const fetcher = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: ref("u-1"), fetcher, applyTurnTerminalResolution: apply,
    });
    const event = {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.completed",
      sessionId: "s-1",
      turnScopeId: "t-1",
    };

    const first = coordinator.observe(event);
    const duplicate = coordinator.observe(event);
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toContain("/session/u-1/s-1/turns/t-1/terminal");
    release(response());
    await expect(first).resolves.toEqual({ applied: true });
    expect(apply).toHaveBeenCalledOnce();
  });

  it("does not apply an unresolved authoritative read", async () => {
    const fetcher = vi.fn(async () => response({ resolved: false }));
    const apply = vi.fn();
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply, maxRetries: 0,
    });
    await expect(coordinator.resolve("s-1", "t-1")).resolves.toMatchObject({
      applied: false,
      reason: "terminal_materialization_not_ready",
    });
    await coordinator.resolve("s-1", "t-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not expose persistence location in terminal resolution", async () => {
    const fetcher = vi.fn(async () => response());
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: () => ({ applied: true }),
    });
    const persistenceScope = {
      scopeId: "agent:workflow-node:node-1",
      parentSessionId: "root-session",
      relativeDir: "runtime/workflow/session/root-session/node-1",
      allowedRoot: "runtime/workflow/session",
    };

    await coordinator.observe({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.completed",
      sessionId: "s-1",
      turnScopeId: "t-1",
      persistenceScope,
    });

    const requestUrl = fetcher.mock.calls[0][0];
    const request = new URL(requestUrl, "http://localhost");
    expect(request.searchParams.has("persistenceScope")).toBe(false);
  });

  it("caches an applied commit and only queries again for a newer target version", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
    await coordinator.resolve("s-1", "t-1");
    await coordinator.observe({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.completed",
      sessionId: "s-1",
      turnScopeId: "t-1",
      revision: 2,
      sequence: 3,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(response({ revision: 3, sequence: 4 }));
    await coordinator.resolve("s-1", "t-1", { revision: 3, sequence: 4 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("re-applies a cached authoritative response after a temporary local projection failure", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn()
      .mockReturnValueOnce({ applied: false, retryable: true, reason: "terminal_materialization_apply_failed" })
      .mockReturnValueOnce({ applied: true });
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await expect(coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 }))
      .resolves.toMatchObject({ applied: false, retryable: true });
    await expect(coordinator.resolve("s-1", "t-1"))
      .resolves.toEqual({ applied: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("coalesces a newer in-flight notification into one follow-up read", async () => {
    let release;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(response({ revision: 3, sequence: 4 }));
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({ userId: "u-1", fetcher, applyTurnTerminalResolution: apply });

    const first = coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
    expect(coordinator.resolve("s-1", "t-1", { revision: 3, sequence: 4 })).toBe(first);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    release(response({ revision: 2, sequence: 3 }));
    await first;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("does not refetch or reapply an authoritative commit after a rejected local commit", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn()
      .mockReturnValue({ applied: false, reason: "terminal_commit_rejected" });
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await expect(coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 }))
      .resolves.toMatchObject({ applied: false, reason: "terminal_commit_rejected" });
    await expect(coordinator.resolve("s-1", "t-1"))
      .resolves.toMatchObject({ applied: false, reason: "terminal_commit_rejected" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("uses the resolved version watermark without a cache projection API", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
    await coordinator.resolve("s-1", "t-1");
    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("scopes watermarks by Session and clears them on invalidate", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
    await coordinator.resolve("s-2", "t-1", { revision: 2, sequence: 3 });
    coordinator.invalidate("s-1", "t-1");
    await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("releases sending and stop capability from the first authoritative response", async () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s-1",
      turnScopeId: "t-1",
      dialogProcessId: "dp-1",
      source: "test",
    });
    applyTurnLifecycleEnvelope(registry, createTurnLifecycleEnvelope({
      eventType: "turn.action_accepted", eventId: "event-t-1-accepted",
      commandId: "command-t-1", userId: "u-1", sessionId: "s-1", turnScopeId: "t-1",
      messageId: "event-message-t-1", presentationMessageId: "message-t-1",
      dialogProcessId: "dp-1", revision: 1, sequence: 1,
      phase: "action", state: "action_requesting", action: "send", executionState: "accepted",
      capabilities: { actionLocked: true, canStop: false },
    }));
    applyTurnLifecycleEnvelope(registry, createTurnLifecycleEnvelope({
      eventType: "turn.processing_started", eventId: "event-t-1-processing",
      commandId: "command-t-1", userId: "u-1", sessionId: "s-1", turnScopeId: "t-1",
      messageId: "event-message-t-1", presentationMessageId: "message-t-1",
      dialogProcessId: "dp-1", revision: 2, sequence: 2,
      phase: "processing", state: "processing", action: "send", executionState: "sending",
      capabilities: { actionLocked: true, canStop: true },
    }));
    expect(selectSessionTurnRuntime(registry, "s-1")).toMatchObject({
      sending: true,
      canStop: true,
    });

    const authoritativeResponse = createTurnTerminalResolution({
      commandId: "resolve-t-1",
      sessionId: "s-1",
      turnScopeId: "t-1",
      resolved: true,
      aggregateVersion: 1,
      turn: {
        sessionId: "s-1",
        turnScopeId: "t-1",
        dialogProcessId: "dp-1",
        state: "completed",
        phase: "completion",
        revision: 3,
        sequence: 3,
        completionCommitId: "commit-2",
        summaryVersion: 2,
        capabilities: { actionLocked: false, canStop: false },
      },
      materialization: {
        completionCommitId: "commit-2",
        summaryVersion: 2,
        revision: 2,
        sequence: 3,
        terminalStatus: { status: "completed" },
        messages: [],
      },
    });
    const fetcher = vi.fn(async () => authoritativeResponse);
    const apply = vi.fn((authoritativeResponse) =>
      applyTurnTerminalResolution(registry, authoritativeResponse));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1", fetcher, applyTurnTerminalResolution: apply,
    });

    await expect(coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 }))
      .resolves.toMatchObject({ applied: true });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(selectSessionTurnRuntime(registry, "s-1")).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

  it("isolates cache and in-flight work by user, session and turn", async () => {
    const fetcher = vi.fn(async () => response());
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: () => ({ applied: true }),
    });
    await Promise.all([
      coordinator.resolve("s-1", "same-turn"),
      coordinator.resolve("s-2", "same-turn"),
    ]);
    await coordinator.resolve("s-1", "same-turn");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not hide a conflicting commit behind a cached revision watermark", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ completionCommitId: "commit-a" }))
      .mockResolvedValueOnce(response({ completionCommitId: "commit-b" }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: () => ({ applied: true }),
    });

    await coordinator.resolve("s-1", "t-1", {
      completionCommitId: "commit-a", summaryVersion: 2, revision: 2, sequence: 3,
    });
    await coordinator.resolve("s-1", "t-1", {
      completionCommitId: "commit-b", summaryVersion: 2, revision: 2, sequence: 3,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an exhausted retry generation dormant until a newer target or forced reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => response({ resolved: false, retryable: true }));
      const coordinator = createTerminalResolutionCoordinator({
        userId: "u-1", fetcher, maxRetries: 1,
      });
      const first = coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
      await vi.runAllTimersAsync();
      await expect(first).resolves.toMatchObject({ applied: false });
      expect(fetcher).toHaveBeenCalledTimes(2);

      await coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 });
      expect(fetcher).toHaveBeenCalledTimes(2);

      const forced = coordinator.resolve("s-1", "t-1", {
        revision: 2, sequence: 3, force: true,
      });
      await vi.runAllTimersAsync();
      await forced;
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reproject a resolved response after the single authoritative commit is rejected", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: false, reason: "terminal_materialization_apply_failed" }));
    const coordinator = createTerminalResolutionCoordinator({ userId: "u-1", fetcher, applyTurnTerminalResolution: apply });

    await expect(coordinator.resolve("s-1", "t-1", { revision: 2, sequence: 3 }))
      .resolves.toEqual({ applied: false, reason: "terminal_materialization_apply_failed" });
    await expect(coordinator.resolve("s-1", "t-1"))
      .resolves.toEqual({ applied: false, reason: "terminal_materialization_apply_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("opens a cooldown after a 429 instead of retrying duplicate notifications", async () => {
    const headers = { get: (name) => name === "retry-after" ? "2" : null };
    const fetcher = vi.fn(async () => ({ ok: false, status: 429, headers, json: async () => ({ ok: false, error: "Too Many Requests" }) }));
    const coordinator = createTerminalResolutionCoordinator({ userId: "u-1", fetcher });

    const first = await coordinator.resolve("s-1", "t-1");
    const second = await coordinator.resolve("s-1", "t-1");
    expect(first.reason).toBe("terminal_resolution_rate_limited");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("queries a historical Turn from stable identity without current-Turn state", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: apply,
    });

    await expect(coordinator.resolve("s-1", "historical-turn"))
      .resolves.toEqual(expect.objectContaining({ applied: true }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("resolves an early terminal notification without waiting for hydration", async () => {
    const fetcher = vi.fn(async () => response());
    const apply = vi.fn(() => ({ applied: true }));
    const coordinator = createTerminalResolutionCoordinator({
      userId: "u-1",
      fetcher,
      applyTurnTerminalResolution: apply,
    });

    await expect(coordinator.observe({
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.completed",
      sessionId: "s-1",
      turnScopeId: "t-1",
      revision: 2,
      sequence: 3,
    })).resolves.toMatchObject({ applied: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
