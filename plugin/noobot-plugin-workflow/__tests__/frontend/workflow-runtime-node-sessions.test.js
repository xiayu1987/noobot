/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeNodeSessions } from "../../frontend/runtime/workflowRuntimeSessions.js";

function ref(value) {
  return { value };
}

function buildSessions({ workflowPayload, nodeSessions = [], executionMeta = {}, registry = null }) {
  return createRuntimeNodeSessions({
    workflowPayload: ref(workflowPayload),
    nodeSessions: ref(nodeSessions),
    executionMeta: ref(executionMeta),
    workflowNodeStateRegistry: registry,
  }).value;
}

function registryWith(workflowRunId, nodes) {
  return {
    workflows: {
      [workflowRunId]: {
        nodes,
      },
    },
  };
}

test("createRuntimeNodeSessions merges committed node facts by workflowRunId and nodeExecutionId", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-1" },
    nodeSessions: [
      {
        workflowRunId: "run-1",
        nodeExecutionId: "node-exec-1",
        nodeId: "node-a",
        nodeName: "Plan A",
        commandId: "old-command",
        sessionId: "old-session",
        dialogProcessId: "old-dialog",
        turnScopeId: "old-turn",
        status: "pending",
      },
    ],
    registry: registryWith("run-1", {
      "node-exec-1": {
        workflowRunId: "run-1",
        nodeExecutionId: "node-exec-1",
        commandId: "command-1",
        sessionId: "session-1",
        parentSessionId: "parent-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "running",
        revision: 2,
        sequence: 5,
        eventId: "event-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].nodeExecutionId, "node-exec-1");
  assert.equal(sessions[0].nodeId, "node-a");
  assert.equal(sessions[0].nodeName, "Plan A");
  assert.equal(sessions[0].commandId, "command-1");
  assert.equal(sessions[0].sessionId, "session-1");
  assert.equal(sessions[0].parentSessionId, "parent-1");
  assert.equal(sessions[0].dialogProcessId, "dialog-1");
  assert.equal(sessions[0].turnScopeId, "turn-1");
  assert.equal(sessions[0].status, "running");
  assert.equal(sessions[0].revision, 2);
  assert.equal(sessions[0].sequence, 5);
  assert.equal(sessions[0].eventId, "event-1");
});

test("createRuntimeNodeSessions isolates committed facts by workflowRunId", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-current" },
    nodeSessions: [
      {
        workflowRunId: "run-current",
        nodeExecutionId: "node-exec-1",
        commandId: "planned-command",
        sessionId: "planned-session",
        status: "pending",
      },
    ],
    registry: registryWith("run-other", {
      "node-exec-1": {
        workflowRunId: "run-other",
        nodeExecutionId: "node-exec-1",
        commandId: "wrong-command",
        sessionId: "wrong-session",
        status: "succeeded",
      },
    }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].commandId, "planned-command");
  assert.equal(sessions[0].sessionId, "planned-session");
  assert.equal(sessions[0].status, "pending");
});

test("createRuntimeNodeSessions appends registry-only committed nodes", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-1" },
    nodeSessions: [],
    registry: registryWith("run-1", {
      "node-exec-orphan": {
        workflowRunId: "run-1",
        nodeExecutionId: "node-exec-orphan",
        nodeId: "node-orphan",
        nodeName: "Orphan Node",
        commandId: "command-orphan",
        sessionId: "session-orphan",
        dialogProcessId: "dialog-orphan",
        turnScopeId: "turn-orphan",
        status: "failed",
        activeChildExecutionId: "child-exec-orphan",
        failure: { message: "boom" },
        revision: 3,
        sequence: 7,
        eventId: "event-orphan",
      },
    }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].nodeExecutionId, "node-exec-orphan");
  assert.equal(sessions[0].status, "failed");
  assert.deepEqual(sessions[0].stepFailure, { message: "boom" });
  assert.equal(sessions[0].sessionId, "session-orphan");
  assert.equal(sessions[0].nodeId, "node-orphan");
  assert.equal(sessions[0].nodeName, "Orphan Node");
  assert.equal(sessions[0].stepId, "node-exec-orphan");
  assert.equal(sessions[0].activeChildExecutionId, "child-exec-orphan");
  assert.equal(sessions[0].childExecutionId, "child-exec-orphan");
});

test("createRuntimeNodeSessions preserves enough identity to render a running registry-only step", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-live" },
    registry: registryWith("run-live", {
      "node-exec-live": {
        workflowRunId: "run-live",
        nodeExecutionId: "node-exec-live",
        nodeId: "node-live",
        nodeName: "Live Node",
        status: "running",
        activeChildExecutionId: "agent-exec-live",
        revision: 2,
        sequence: 3,
      },
    }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].nodeId, "node-live");
  assert.equal(sessions[0].stepId, "node-exec-live");
  assert.equal(sessions[0].childExecutionId, "agent-exec-live");
});

test("createRuntimeNodeSessions prevents nodeAgentRuns from overwriting committed node facts", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-1" },
    nodeSessions: [
      {
        workflowRunId: "run-1",
        nodeExecutionId: "node-exec-1",
        commandId: "planned-command",
        sessionId: "planned-session",
        dialogProcessId: "planned-dialog",
        status: "pending",
      },
    ],
    executionMeta: {
      nodeAgentRuns: [
        {
          workflowRunId: "run-1",
          nodeExecutionId: "node-exec-1",
          commandId: "legacy-command",
          nodeSessionId: "legacy-session",
          dialogProcessId: "legacy-dialog",
          status: "succeeded",
          step: { nodeId: "node-a" },
        },
      ],
    },
    registry: registryWith("run-1", {
      "node-exec-1": {
        workflowRunId: "run-1",
        nodeExecutionId: "node-exec-1",
        commandId: "committed-command",
        sessionId: "committed-session",
        dialogProcessId: "committed-dialog",
        status: "running",
      },
    }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].commandId, "committed-command");
  assert.equal(sessions[0].sessionId, "committed-session");
  assert.equal(sessions[0].dialogProcessId, "committed-dialog");
  assert.equal(sessions[0].status, "running");
});

test("createRuntimeNodeSessions does not infer identity for runs without nodeExecutionId", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "legacy-run" },
    nodeSessions: [
      {
        dialogProcessId: "legacy-dialog",
        sessionId: "legacy-session",
        stepId: "step-1",
        status: "pending",
      },
    ],
    executionMeta: {
      nodeAgentRuns: [
        {
          dialogProcessId: "legacy-dialog",
          nodeSessionId: "legacy-session-2",
          status: "succeeded",
          step: { nodeId: "legacy-node", nodeName: "Legacy Node" },
        },
      ],
    },
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].dialogProcessId, "legacy-dialog");
  assert.equal(sessions[0].sessionId, "legacy-session");
  assert.equal(sessions[0].nodeId, undefined);
  assert.equal(sessions[0].nodeName, undefined);
  assert.equal(sessions[0].status, "pending");
});

test("createRuntimeNodeSessions accepts Vue ref-like registry objects", () => {
  const sessions = buildSessions({
    workflowPayload: { workflowRunId: "run-ref" },
    nodeSessions: [
      {
        workflowRunId: "run-ref",
        nodeExecutionId: "node-ref",
        status: "pending",
      },
    ],
    registry: ref(registryWith("run-ref", {
      "node-ref": {
        workflowRunId: "run-ref",
        nodeExecutionId: "node-ref",
        status: "succeeded",
        sessionId: "session-ref",
      },
    })),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "succeeded");
  assert.equal(sessions[0].sessionId, "session-ref");
});
