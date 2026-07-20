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
  resolveRuntimeNodeSession,
} from "../frontend/components/workflow-message-card/workflowUnifiedSessionDetail.js";

const runtimeNode = {
  workflowRunId: "run-1",
  nodeExecutionId: "node-exec-a",
  sessionId: "child-session-a",
  parentSessionId: "parent-session",
  dialogProcessId: "wf_node_node-exec-a",
  turnScopeId: "workflow-node:node-exec-a",
  status: "running",
};

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
    nodeItem: { nodeExecutionId: "node-exec-a" },
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
    nodeItem: { nodeExecutionId: "node-exec-a" },
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
