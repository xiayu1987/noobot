/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_KIND,
  buildExecutionTree,
  createExecutionLifecycleEnvelope,
  deriveAgentExecutionId,
  validateExecutionIdentity,
} from "@noobot/session-protocol/execution-lifecycle";

test("agent execution identity is a stable compatibility projection of turn scope", () => {
  assert.equal(deriveAgentExecutionId({ turnScopeId: "turn-1" }), "agent:turn-1");
  const result = validateExecutionIdentity({ sessionId: "session-1", turnScopeId: "turn-1" });
  assert.equal(result.valid, true);
  assert.equal(result.identity.executionId, "agent:turn-1");
  assert.equal(result.identity.rootExecutionId, "agent:turn-1");
});

test("execution envelope retains lifecycle coordinates and parent identity", () => {
  const envelope = createExecutionLifecycleEnvelope({
    eventType: "turn.processing_started",
    eventId: "event-1",
    commandId: "command-1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    turnScopeId: "child-turn",
    parentExecutionId: "agent:root-turn",
    rootExecutionId: "agent:root-turn",
    revision: 2,
    sequence: 3,
    state: "processing",
  });
  assert.equal(envelope.executionKind, EXECUTION_KIND.AGENT);
  assert.equal(envelope.executionId, "agent:child-turn");
  assert.equal(envelope.parentExecutionId, "agent:root-turn");
  assert.equal(envelope.sequence, 3);
});

test("execution tree supports arbitrary child agent depth", () => {
  const tree = buildExecutionTree([
    { executionId: "root", executionKind: "workflow", rootExecutionId: "root" },
    {
      executionId: "child",
      executionKind: "agent",
      rootExecutionId: "root",
      parentExecutionId: "root",
      sessionId: "s1",
    },
    {
      executionId: "grandchild",
      executionKind: "agent",
      rootExecutionId: "root",
      parentExecutionId: "child",
      sessionId: "s2",
    },
  ]);
  assert.deepEqual(tree.rootExecutionIds, ["root"]);
  assert.deepEqual(tree.executions.root.childExecutionIds, ["child"]);
  assert.deepEqual(tree.executions.child.childExecutionIds, ["grandchild"]);
});
