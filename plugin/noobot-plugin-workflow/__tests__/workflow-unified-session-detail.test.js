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
  resolveIsolatedNodeSessionId,
  resolveRuntimeNodeSession,
  withRunningAssistantPlaceholder,
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

test("realtime projection cannot erase persisted user messages", () => {
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
});

test("running child Execution adds an assistant placeholder beside its user message", () => {
  const messages = withRunningAssistantPlaceholder([
    { id: "user-1", role: "user", content: "request", turnScopeId: "turn-1" },
  ], {
    sessionId: "child-session-a",
    turnScopeId: "turn-1",
    state: "running",
  });

  assert.deepEqual(messages.map(({ role }) => role), ["user", "assistant"]);
  assert.equal(messages[1].pending, true);
  assert.equal(messages[1].workflowNodeRunningPlaceholder, true);
});

test("running placeholder inherits the persisted child user identity", () => {
  const messages = withRunningAssistantPlaceholder([{
    id: "user-1",
    role: "user",
    sessionId: "child-session",
    dialogProcessId: "child-dialog",
    turnScopeId: "child-turn",
  }], {
    sessionId: "root-session",
    dialogProcessId: "planned-dialog",
    turnScopeId: "child-turn",
    state: "running",
  });

  assert.equal(messages[1].sessionId, "child-session");
  assert.equal(messages[1].dialogProcessId, "child-dialog");
});

test("running child Execution does not duplicate a real assistant or leak into terminal state", () => {
  const realMessages = [
    { id: "user-1", role: "user", turnScopeId: "turn-1" },
    { id: "assistant-1", role: "assistant", turnScopeId: "turn-1" },
  ];
  assert.equal(withRunningAssistantPlaceholder(realMessages, { turnScopeId: "turn-1", state: "running" }), realMessages);
  const userOnly = realMessages.slice(0, 1);
  assert.equal(withRunningAssistantPlaceholder(userOnly, { turnScopeId: "turn-1", state: "completed" }), userOnly);
});

test("real assistant message supersedes a previously merged running placeholder", () => {
  const turnScopeId = "turn-1";
  const running = mergeUnifiedSessionDetail({}, {
    sessionId: "child-session-a",
    execution: { state: "running" },
    messages: withRunningAssistantPlaceholder([
      { id: "user-1", role: "user", turnScopeId },
    ], { sessionId: "child-session-a", turnScopeId, state: "running" }),
  });
  const completed = mergeUnifiedSessionDetail(running, {
    sessionId: "child-session-a",
    execution: { state: "completed" },
    messages: [{ id: "assistant-1", role: "assistant", content: "done", turnScopeId }],
  });

  assert.deepEqual(completed.messages.map(({ id }) => id), ["user-1", "assistant-1"]);
});

test("terminal child state keeps the thinking surface until the real assistant materializes", () => {
  const turnScopeId = "turn-1";
  const running = {
    sessionId: "child-session-a",
    execution: { state: "running" },
    messages: withRunningAssistantPlaceholder([
      { id: "user-1", role: "user", turnScopeId },
    ], { sessionId: "child-session-a", turnScopeId, state: "running" }),
  };
  const completed = mergeUnifiedSessionDetail(running, {
    sessionId: "child-session-a",
    execution: { state: "running" },
    sessionSummary: { status: "succeeded" },
    messages: [{ id: "user-1", role: "user", turnScopeId }],
  });

  assert.deepEqual(completed.messages.map(({ id }) => id), [
    "user-1",
    `workflow-node-running:${turnScopeId}`,
  ]);
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

test("never treats the workflow parent session as a node child session", () => {
  const node = { sessionId: "main-session", rootSessionId: "main-session", nodeExecutionId: "node-a" };
  assert.equal(resolveIsolatedNodeSessionId(node, node), "");
  assert.equal(resolveIsolatedNodeSessionId(node, { ...node, nodeSessionId: "child-session" }), "child-session");
  const detail = buildUnifiedSessionDetail({
    nodeItem: node,
    runtimeNodeSessions: [node],
    selectSessionMessages: () => { throw new Error("must not read the parent session"); },
  });
  assert.equal(detail, null);
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

test("does not let a root-bound Execution overwrite the isolated workflow node session", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const detail = buildUnifiedSessionDetail({
    nodeItem: {
      rootSessionId: "root-session",
      nodeExecutionId: "node-exec-a",
      activeChildExecutionId: "agent:attempt-1",
    },
    runtimeNodeSessions: [{
      nodeExecutionId: "node-exec-a",
      sessionId: "child-session-a",
      parentSessionId: "root-session",
      turnScopeId,
      dialogProcessId: "wf-node-a",
      status: "running",
      activeChildExecutionId: "agent:attempt-1",
    }],
    selectExecutionDetail: () => ({
      execution: {
        executionId: "agent:attempt-1",
        sessionId: "root-session",
        state: "running",
      },
      session: { sessionId: "root-session" },
      messages: [{ id: "root-user", role: "user", content: "root request", turnScopeId: "root-turn" }],
    }),
    selectSessionMessages: (sessionId) => sessionId === "child-session-a" ? {
      sessionId,
      messages: [{ id: "child-user", role: "user", content: "node request", turnScopeId }],
    } : null,
  });

  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map(({ id }) => id), [
    "child-user",
    `workflow-node-running:${turnScopeId}`,
  ]);
  assert.equal(detail.messages[1].sessionId, "child-session-a");
  assert.equal(detail.messages.some(({ id }) => id === "root-user"), false);
});

test("keeps a REST-hydrated child snapshot when its local Execution still points at root", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: {
      rootSessionId: "root-session",
      nodeExecutionId: "node-exec-a",
      activeChildExecutionId: "agent:attempt-1",
    },
    runtimeNodeSessions: [{
      nodeExecutionId: "node-exec-a",
      sessionId: "child-session-a",
      parentSessionId: "root-session",
      turnScopeId: "workflow-node:node-exec-a",
      status: "running",
      activeChildExecutionId: "agent:attempt-1",
    }],
    selectExecutionDetail: () => ({
      execution: { executionId: "agent:attempt-1", sessionId: "root-session", state: "running" },
      session: { sessionId: "root-session" },
      messages: [{ id: "root-user", role: "user", turnScopeId: "root-turn" }],
    }),
    selectSessionMessages: () => null,
  });

  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages, []);
  assert.deepEqual(detail.rawMessages, []);
});

test("keeps authoritative child Execution turn facts for a running assistant placeholder", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const turnTimings = [{
    turnScopeId,
    thinkingStartedAt: "2026-07-21T07:29:00.000Z",
    thinkingFinishedAt: "2026-07-21T07:29:27.000Z",
  }];
  const turnStatuses = [{ turnScopeId, status: "completed" }];
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent:attempt-1" },
    selectExecutionDetail: () => ({
      execution: {
        executionId: "agent:attempt-1",
        sessionId: "child-session-a",
        turnScopeId,
        turnTimings,
        turnStatuses,
      },
      session: { sessionId: "child-session-a" },
      messages: [{ id: "assistant-1", role: "assistant", turnScopeId }],
    }),
  });

  assert.deepEqual(detail.sessionSummary.turnTimings, turnTimings);
  assert.deepEqual(detail.sessionSummary.turnStatuses, turnStatuses);
  assert.deepEqual(detail.messages.map(({ id }) => id), ["assistant-1"]);
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
  assert.equal(hydrated.sessionSummary.turnRuntime, undefined);
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

test("builds content-only unified detail with scoped messages", () => {
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
  assert.equal(detail.sessionSummary.turnRuntime, undefined);
  assert.deepEqual(detail.messages.map((item) => item.id), ["m-1", "m-3"]);
  assert.deepEqual(detail.messages[0].toolLogs, [{ id: "tool-1" }]);
});

test("copies persisted turn facts from realtime child session projection", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const turnTimings = [{
    turnScopeId,
    thinkingStartedAt: "2026-07-21T07:29:00.000Z",
    thinkingFinishedAt: "2026-07-21T07:29:27.000Z",
  }];
  const turnStatuses = [{ turnScopeId, status: "completed" }];
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a", activeChildExecutionId: "agent-exec-a" },
    runtimeNodeSessions: [runtimeNode],
    selectSessionMessages: () => ({
      sessionId: "child-session-a",
      turnTimings,
      turnStatuses,
      messages: [{ id: "assistant-1", role: "assistant", turnScopeId }],
    }),
    turnRuntimeRegistry: {},
  });

  assert.deepEqual(detail.sessionSummary.turnTimings, turnTimings);
  assert.deepEqual(detail.sessionSummary.turnStatuses, turnStatuses);
  assert.deepEqual(detail.messages.map(({ id }) => id), ["assistant-1"]);
});

test("allows an empty preallocated session without copying lifecycle runtime", () => {
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
  assert.equal(detail.sessionSummary.turnRuntime, undefined);
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

test("supports ref-like runtime node sessions without copying registry runtime", () => {
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
  assert.equal(detail.sessionSummary.turnRuntime, undefined);
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
                sessionId: "child-session-a",
                workflowSession: {
                  session: {
                    sessionId: "child-session-a",
                    state,
                    messages: [
                    { id: `user-${state}`, role: "user", content: `request-${state}`, turnScopeId: `turn-${state}` },
                    { id: `message-${state}`, role: "assistant", content: state, turnScopeId: `turn-${state}` },
                    ],
                    turnStatuses: [{ turnScopeId: `turn-${state}`, status: state === "completed" ? "completed" : "processing" }],
                    turnTimings: [{ turnScopeId: `turn-${state}`, thinkingStartedAt: "2026-07-20T00:00:00.000Z" }],
                  },
                },
              };
            },
          };
        },
      },
      translate: (key) => key,
      sessionId: "child-session-a",
      rootSessionId: "root-session-a",
      dialogProcessId: "workflow-node-a",
    });

    assert.deepEqual(calls, ["/api/internal/workflow/session/user-1/root-session-a/workflow-node-a"]);
    assert.equal(detail.sessionId, "child-session-a");
    assert.equal(detail.sessionSummary.state, state);
    assert.deepEqual(detail.messages.map(({ id }) => id), [`user-${state}`, `message-${state}`]);
    assert.equal(detail.sessionSummary.turnStatuses[0].status, state === "completed" ? "completed" : "processing");
    assert.equal(detail.sessionSummary.turnTimings[0].turnScopeId, `turn-${state}`);
    assert.equal(detail.turnTimings, undefined);
  });
}

test("classifies an unmaterialized Execution session as pending", async () => {
  const detail = await fetchExecutionSessionDetail({
    props: {
      userId: "user-1",
      authFetch: async () => ({
        ok: true,
        async json() { return { ok: true, workflowSession: {} }; },
      }),
    },
    translate: (key) => key,
    sessionId: "child-session-pending",
    rootSessionId: "root-session-a",
    dialogProcessId: "workflow-node-a",
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
        async json() { return { ok: true, workflowSession: { session: { sessionId: "child-session-empty", messages: [] } } }; },
      }),
    },
    translate: (key) => key,
    sessionId: "child-session-empty",
    rootSessionId: "root-session-a",
    dialogProcessId: "workflow-node-a",
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
    rootSessionId: "root-session-a",
    dialogProcessId: "workflow-node-a",
  }), /permission denied/);
});
