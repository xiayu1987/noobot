/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  areCanonicalTurnScopeIdsEqual,
  createMemoryPostprocessIdentity,
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
  isCanonicalTurnScopeId,
  isOptionalCanonicalTurnScopeId,
  isWorkflowNodeTurnScopeId,
  requireCanonicalTurnScopeId,
  requireOptionalCanonicalTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { requireCanonicalTurnScopeId as requireInternalTurnScopeId } from "../src/identity/turn-scope-identity.js";
import { isDialogProcessKey } from "../src/identity.js";

test("memory postprocess identity is a dialog process key derived from the source turn", () => {
  const longSession = "s".repeat(200);
  const longSource = "d".repeat(128);
  const identity = createMemoryPostprocessIdentity({
    sessionId: longSession,
    sourceDialogProcessId: longSource,
  });
  assert.match(identity.dialogProcessId, /^mem_[0-9a-f]{32}$/);
  assert.equal(isDialogProcessKey(identity.dialogProcessId), true);
  assert.equal(identity.turnScopeId, `memory-postprocess:${longSource}`);
  assert.equal(identity.runId, identity.turnScopeId);
  assert.deepEqual(
    createMemoryPostprocessIdentity({ sessionId: longSession, sourceDialogProcessId: longSource }),
    identity,
  );
  assert.notEqual(
    createMemoryPostprocessIdentity({ sessionId: longSession, sourceDialogProcessId: "other" })
      .dialogProcessId,
    identity.dialogProcessId,
  );
});

test("memory postprocess identity rejects missing session or source turn", () => {
  assert.throws(() => createMemoryPostprocessIdentity({ sessionId: "s1" }), {
    code: "MEMORY_POSTPROCESS_IDENTITY_INVALID",
  });
  assert.throws(() => createMemoryPostprocessIdentity({ sourceDialogProcessId: "d1" }), {
    code: "MEMORY_POSTPROCESS_IDENTITY_INVALID",
  });
});

test("public subpath re-exports the canonical identity implementation", () => {
  assert.equal(requireCanonicalTurnScopeId, requireInternalTurnScopeId);
});

test("workflow node turn scope has a single encoding and is never rewritten", () => {
  assert.equal(requireCanonicalTurnScopeId("workflow-node:node-1"), "workflow-node:node-1");
  assert.equal(areCanonicalTurnScopeIdsEqual("workflow-node:node-1", "workflow-node:node-1"), true);
  assert.equal(
    areCanonicalTurnScopeIdsEqual("workflow-node_node-1", "workflow-node:node-1"),
    false,
  );
  assert.equal(isWorkflowNodeTurnScopeId("workflow-node_node-1"), false);
});

test("canonical identity validation rejects non canonical text instead of trimming", () => {
  assert.equal(isCanonicalTurnScopeId("workflow-node:node-1"), true);
  assert.equal(isCanonicalTurnScopeId(" workflow-node:node-1"), false);
  assert.equal(isCanonicalTurnScopeId(""), false);
  assert.equal(areCanonicalTurnScopeIdsEqual(" turn-a", " turn-a"), false);
  for (const value of [undefined, null, "", " turn-a", "turn-a ", 1]) {
    assert.throws(() => requireCanonicalTurnScopeId(value), { code: "TURN_SCOPE_ID_INVALID" });
  }
});

test("optional turn scope accepts only the explicit empty value or canonical text", () => {
  assert.equal(isOptionalCanonicalTurnScopeId(""), true);
  assert.equal(requireOptionalCanonicalTurnScopeId(""), "");
  assert.equal(requireOptionalCanonicalTurnScopeId("turn-a"), "turn-a");
  for (const value of [undefined, null, " ", " turn-a", 0]) {
    assert.throws(() => requireOptionalCanonicalTurnScopeId(value), {
      code: "TURN_SCOPE_ID_INVALID",
    });
  }
});

test("builds workflow node identities from a single node execution id", () => {
  assert.equal(createWorkflowNodeTurnScopeId("run_n1_1"), "workflow-node:run_n1_1");
  assert.equal(createWorkflowNodeDialogProcessId("run_n1_1"), "wf_node_run_n1_1");
  for (const value of [undefined, "", " ", " run_n1_1"]) {
    assert.throws(() => createWorkflowNodeTurnScopeId(value), {
      code: "WORKFLOW_NODE_IDENTITY_INVALID",
    });
    assert.throws(() => createWorkflowNodeDialogProcessId(value), {
      code: "WORKFLOW_NODE_IDENTITY_INVALID",
    });
  }
});

test("detects workflow node identities only in the single canonical encoding", () => {
  assert.equal(isWorkflowNodeTurnScopeId("workflow-node:run_n1_1"), true);
  assert.equal(isWorkflowNodeTurnScopeId("workflow-node_run_n1_1"), false);
  assert.equal(isWorkflowNodeTurnScopeId("client-turn:one"), false);
  assert.equal(isWorkflowNodeTurnScopeId(""), false);
});
