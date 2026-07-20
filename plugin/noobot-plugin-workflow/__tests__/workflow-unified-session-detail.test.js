/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUnifiedSessionDetail,
  hasNewProtocolNodeIdentity,
  mergeUnifiedSessionDetail,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
} from "../frontend/components/workflow-message-card/workflowUnifiedSessionDetail.js";
import {
  fetchExecutionSessionDetail,
  hydrateExecutionSessionDetail,
} from "../frontend/components/workflow-message-card/workflowNodeSessionDetail.js";

const runtimeNode = {
  workflowRunId: "run-1",
  nodeExecutionId: "node-exec-a",
  sessionId: "child-session-a",
  parentSessionId: "parent-session",
  dialogProcessId: "wf_node_node-exec-a",
  turnScopeId: "workflow-node:node-exec-a",
  status: "running",
};

test("realtime projection cannot erase persisted user messages and turn metadata", () => {
  const merged = mergeUnifiedSessionDetail({
    sessionId: "child-session-a",
    messages: [
      { id: "user-1", role: "user", content: "request", turnScopeId: "turn-1" },
      { id: "assistant-1", role: "assistant", content: "", turnScopeId: "turn-1" },
    ],
    sessionSummary: {
      sessionId: "child-session-a",
      turnStatuses: [{ turnScopeId: "turn-1", status: "processing" }],
      turnTimings: [{ turnScopeId: "turn-1", thinkingStartedAt: "2026-07-20T00:00:00.000Z" }],
    },
  }, {
    sessionId: "child-session-a",
    messages: [{ id: "assistant-1", role: "assistant", content: "streamed", turnScopeId: "turn-1" }],
    sessionSummary: { sessionId: "child-session-a", messages: [] },
  });

  assert.deepEqual(merged.messages.map(({ id }) => id), ["user-1", "assistant-1"]);
  assert.equal(merged.messages[1].content, "streamed");
  assert.equal(merged.sessionSummary.turnStatuses[0].status, "processing");
  assert.equal(merged.sessionSummary.turnTimings[0].thinkingStartedAt, "2026-07-20T00:00:00.000Z");
});

function selectSessionMessages(sessionId) {
  if (sessionId !== "child-session-a") return null;
  return {
    sessionId,
    parentSessionId: "parent-session",
    messages: [
      { id: "m-1", role: "assistant", content: "kept", turnScopeId: "workflow-node:node-exec-a", toolLogs: [{ id: "tool-1" }] },
      { id: "m-2", role: "assistant", content: "other", turnScopeId: "workflow-node:node-exec-b" },
      { id: "m-3", role: "assistant", content: "dialog", metadata: { dialogProcessId: "wf_node_node-exec-a" } },
    ],
  };
}

test("detects new protocol nodes by nodeExecutionId", () => {
  assert.equal(hasNewProtocolNodeIdentity({ nodeExecutionId: "node-exec-a" }), true);
  assert.equal(hasNewProtocolNodeIdentity({ dialogProcessId: "legacy" }), false);
});

test("prefers authoritative child Execution detail and exposes its complete subtree", () => {
  const node = {
    nodeExecutionId: "node-exec-a",
    activeChildExecutionId: "agent:attempt-2",
    attemptExecutionIds: ["agent:attempt-1", "agent:attempt-2"],
  };
  assert.deepEqual(resolveNodeChildExecutionIds(node), ["agent:attempt-2", "agent:attempt-1"]);
  const detail = buildUnifiedSessionDetail({
    nodeItem: node,
    selectExecutionDetail: (executionId) => executionId === "agent:attempt-2" ? {
      execution: { executionId, sessionId: "child-session-a", turnScopeId: "turn-a", state: "processing" },
      session: { sessionId: "child-session-a" },
      messages: [{ id: "m-execution", content: "authoritative" }],
      children: [{ executionId: "agent:grandchild" }],
      descendants: [{ executionId: "agent:grandchild" }, { executionId: "agent:great-grandchild" }],
    } : null,
    selectSessionMessages: () => { throw new Error("new protocol must not infer by session"); },
  });
  assert.equal(detail.executionId, "agent:attempt-2");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map(({ id }) => id), ["m-execution"]);
  assert.deepEqual(detail.descendantExecutions.map(({ executionId }) => executionId), ["agent:grandchild", "agent:great-grandchild"]);
});

test("uses only the node's preallocated session when authoritative child Execution is missing", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-a", activeChildExecutionId: "agent:missing", sessionId: "legacy-session" },
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({ sessionId: "legacy-session", messages: [{ id: "legacy" }] }),
  });
  assert.equal(detail.executionId, "agent:missing");
  assert.equal(detail.sessionId, "legacy-session");
  assert.deepEqual(detail.messages.map(({ id }) => id), ["legacy"]);
});

test("hydrates child messages when the local Execution projection has not arrived", () => {
  const hydrated = hydrateExecutionSessionDetail({
    sessionId: "child-session-a",
    sessionSummary: { sessionId: "child-session-a", messages: [] },
    messages: [{ id: "live-child-message", content: "running" }],
  }, {
    executionId: "agent:starting",
    execution: null,
  });
  assert.equal(hydrated.sessionSummary.executionId, "agent:starting");
  assert.equal(hydrated.sessionSummary.turnRuntime, null);
  assert.deepEqual(hydrated.sessionSummary.messages.map(({ id }) => id), ["live-child-message"]);
  assert.deepEqual(hydrated.rawMessages.map(({ id }) => id), ["live-child-message"]);
});

test("resolves runtime node by nodeExecutionId before legacy keys", () => {
  const resolved = resolveRuntimeNodeSession(
    { nodeExecutionId: "node-exec-a", dialogProcessId: "legacy-dialog", sessionId: "legacy-session" },
    [
      { dialogProcessId: "legacy-dialog", sessionId: "wrong" },
      runtimeNode,
    ],
  );
  assert.equal(resolved.sessionId, "child-session-a");
  assert.equal(resolved.turnScopeId, "workflow-node:node-exec-a");
});

test("builds unified detail with scoped messages and turn runtime", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent-exec-a" },
    runtimeNodeSessions: [runtimeNode],
    selectSessionMessages,
    turnRuntimeRegistry: {
      sessions: {
        "child-session-a": {
          turns: {
            "workflow-node:node-exec-a": { turnScopeId: "workflow-node:node-exec-a", phase: "processing" },
          },
        },
      },
    },
  });
  assert.equal(detail.sessionId, "child-session-a");
  assert.equal(detail.sessionSummary.turnScopeId, "workflow-node:node-exec-a");
  assert.equal(detail.sessionSummary.turnRuntime.phase, "processing");
  assert.deepEqual(detail.messages.map((item) => item.id), ["m-1", "m-3"]);
  assert.deepEqual(detail.messages[0].toolLogs, [{ id: "tool-1" }]);
});

test("allows empty running session when lifecycle runtime exists", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent-exec-a" },
    runtimeNodeSessions: [runtimeNode],
    selectSessionMessages: () => ({ sessionId: "child-session-a", messages: [] }),
    turnRuntimeRegistry: {
      sessions: {
        "child-session-a": {
          turns: {
            "workflow-node:node-exec-a": { turnScopeId: "workflow-node:node-exec-a", phase: "action" },
          },
        },
      },
    },
  });
  assert.equal(detail.sessionId, "child-session-a");
  assert.equal(detail.messages.length, 0);
  assert.equal(detail.sessionSummary.turnRuntime.phase, "action");
});

test("uses the preallocated session realtime projection before Execution projection arrives", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent-exec-a" },
    runtimeNodeSessions: [runtimeNode],
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({
      sessionId: "child-session-a",
      messages: [
        { id: "user-live", role: "user", content: "run this", turnScopeId: "workflow-node:node-exec-a" },
        { id: "assistant-live", role: "assistant", content: "", thinking: "working", turnScopeId: "workflow-node:node-exec-a" },
      ],
    }),
    turnRuntimeRegistry: {},
  });

  assert.equal(detail.executionId, "agent-exec-a");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map((item) => item.id), ["user-live", "assistant-live"]);
});

test("allows the preallocated child session to mount before its first realtime message", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent-exec-a" },
    runtimeNodeSessions: [runtimeNode],
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({ sessionId: "child-session-a", messages: [] }),
    turnRuntimeRegistry: {},
  });

  assert.equal(detail.executionId, "agent-exec-a");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages, []);
});

test("returns null so caller can use REST fallback for legacy missing unified data", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { dialogProcessId: "legacy-dialog" },
    runtimeNodeSessions: [],
    selectSessionMessages: () => null,
    turnRuntimeRegistry: {},
  });
  assert.equal(detail, null);
});

test("supports ref-like runtime node sessions and registry", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectSessionMessages,
    turnRuntimeRegistry: {
      value: {
        sessions: {
          "child-session-a": {
            turns: {
              "workflow-node:node-exec-a": { turnScopeId: "workflow-node:node-exec-a", phase: "completion" },
            },
          },
        },
      },
    },
  });
  assert.equal(detail.sessionSummary.turnRuntime.phase, "completion");
});

for (const state of ["processing", "completed"]) {
  test(`loads ${state} child Agent messages from the authoritative Execution session`, async () => {
    const calls = [];
    const detail = await fetchExecutionSessionDetail({
      props: {
        userId: "user-1",
        authFetch: async (url) => {
          calls.push(url);
          return {
            ok: true,
            async json() {
              return {
                ok: true,
                exists: true,
                sessionId: "child-session-a",
                sessions: [{
                  sessionId: "child-session-a",
                  state,
                  messages: [
                    { id: `user-${state}`, role: "user", content: `request-${state}`, turnScopeId: `turn-${state}` },
                    { id: `message-${state}`, role: "assistant", content: state, turnScopeId: `turn-${state}` },
                  ],
                  turnStatuses: [{ turnScopeId: `turn-${state}`, status: state === "completed" ? "completed" : "processing" }],
                  turnTimings: [{ turnScopeId: `turn-${state}`, thinkingStartedAt: "2026-07-20T00:00:00.000Z" }],
                }],
              };
            },
          };
        },
      },
      translate: (key) => key,
      sessionId: "child-session-a",
    });

    assert.deepEqual(calls, ["/api/internal/session/user-1/child-session-a?mode=full"]);
    assert.equal(detail.sessionId, "child-session-a");
    assert.equal(detail.sessionSummary.state, state);
    assert.deepEqual(detail.messages.map(({ id }) => id), [`user-${state}`, `message-${state}`]);
    assert.equal(detail.sessionSummary.turnStatuses[0].turnScopeId, `turn-${state}`);
    assert.equal(detail.turnTimings[0].thinkingStartedAt, "2026-07-20T00:00:00.000Z");
  });
}

test("classifies an unmaterialized Execution session as pending", async () => {
  const detail = await fetchExecutionSessionDetail({
    props: {
      userId: "user-1",
      authFetch: async () => ({
        ok: true,
        async json() { return { ok: true, exists: false }; },
      }),
    },
    translate: (key) => key,
    sessionId: "child-session-pending",
  });
  assert.deepEqual(detail, {
    state: "pending",
    reason: "session_not_materialized",
    sessionId: "child-session-pending",
  });
});

test("classifies a materialized Execution session without messages as empty", async () => {
  const detail = await fetchExecutionSessionDetail({
    props: {
      userId: "user-1",
      authFetch: async () => ({
        ok: true,
        async json() { return { ok: true, exists: true, sessionId: "child-session-empty", messages: [] }; },
      }),
    },
    translate: (key) => key,
    sessionId: "child-session-empty",
  });
  assert.equal(detail.state, "empty");
  assert.deepEqual(detail.messages, []);
});

test("keeps a Session service failure distinct from pending", async () => {
  await assert.rejects(() => fetchExecutionSessionDetail({
    props: {
      userId: "user-1",
      authFetch: async () => ({
        ok: true,
        async json() { return { ok: false, exists: false, error: "permission denied" }; },
      }),
    },
    translate: (key) => key,
    sessionId: "child-session-failed",
  }), /permission denied/);
});
