/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { computed, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { applyTurnTerminalResolution, selectTurnMessageRuntime } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnTerminalResolution } from "../../../../../../../shared/turn-lifecycle-protocol.mjs";

function settleCompleted(registry, { sessionId, turnScopeId, updatedAt }) {
  const revision = 100;
  const completionCommitId = `commit-${turnScopeId}`;
  return applyTurnTerminalResolution(registry, createTurnTerminalResolution({
    commandId: `resolve-${turnScopeId}`,
    sessionId,
    turnScopeId,
    resolved: true,
    turn: { sessionId, turnScopeId, state: "completed", phase: "completion", revision, sequence: revision,
      completionCommitId, summaryVersion: revision, updatedAt, capabilities: { actionLocked: false, canStop: false } },
    materialization: { completionCommitId, summaryVersion: revision, revision, sequence: revision,
      terminalStatus: { status: "completed" }, messages: [] },
  }));
}

describe("useChatStore turn runtime actions", () => {
  it("publishes a new registry root after the first runtime event so selectors recompute", async () => {
    setActivePinia(createPinia());
    const store = useChatStore();
    const runtime = computed(() => selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
    }));

    expect(runtime.value.startedAt).toBe("");
    const before = store.turnRuntimeRegistry;
    const result = store.applyTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      updatedAt: "2026-07-21T10:00:00.000Z",
    });
    await nextTick();

    expect(result.applied).not.toBe(false);
    expect(store.turnRuntimeRegistry).not.toBe(before);
    expect(runtime.value.running).toBe(true);
    expect(runtime.value.startedAt).toBe("2026-07-21T10:00:00.000Z");
  });

  it("keeps startedAt and terminal time monotonic while repeated maintenance is zero-submit", () => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.applyTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      updatedAt: "2026-07-21T10:00:00.000Z",
    });
    const afterSending = store.turnRuntimeRegistry;

    store.applyTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      dialogProcessId: "dp-1",
      state: "sending",
      updatedAt: "2026-07-21T10:00:10.000Z",
    });
    let runtime = selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      dialogProcessId: "different-dp",
    });
    expect(runtime.startedAt).toBe("2026-07-21T10:00:00.000Z");
    expect(runtime.running).toBe(true);

    store.applyTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      updatedAt: "2026-07-21T10:00:59.000Z",
    });
    settleCompleted(store.turnRuntimeRegistry, { sessionId: "session-1", turnScopeId: "client-turn:abc:def",
      updatedAt: "2026-07-21T10:01:00.000Z" });
    const afterCompleted = store.turnRuntimeRegistry;
    store.applyTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
      state: "sending",
      updatedAt: "2026-07-21T10:00:30.000Z",
    });
    runtime = selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "session-1",
      turnScopeId: "client-turn:abc:def",
    });
    expect(runtime.running).toBe(false);
    expect(runtime.finishedAt).toBe("2026-07-21T10:01:00.000Z");

    const wrongScopeRuntime = selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "session-1",
      turnScopeId: "client-turn_abc_def",
    });
    expect(wrongScopeRuntime.startedAt).toBe("");

    const pruneResult = store.pruneTerminalTurns({ sessionId: "session-1", keepTurnScopeIds: ["client-turn:abc:def"] });
    expect(pruneResult.applied).toBe(false);
    expect(store.turnRuntimeRegistry).toBe(afterCompleted);
    expect(afterSending).not.toBe(afterCompleted);
  });
});
