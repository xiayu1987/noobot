/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  areCanonicalTurnScopeIdsEqual,
  canonicalizeTurnScopeId,
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
  isCanonicalTurnScopeId,
  isWorkflowNodeDialogProcessId,
  isWorkflowNodeTurnScopeId,
  readWorkflowNodeExecutionId,
  turnScopeIdentityKey,
} from "@noobot/session-protocol/turn-scope-identity";
import {
  canonicalizeTurnScopeId as canonicalizeInternalTurnScopeId,
  turnScopeIdentityKey as internalTurnScopeIdentityKey,
} from "../src/identity/turn-scope-identity.js";

test("public subpath re-exports the canonical identity implementation", () => {
  assert.equal(canonicalizeTurnScopeId, canonicalizeInternalTurnScopeId);
  assert.equal(turnScopeIdentityKey, internalTurnScopeIdentityKey);
});

test("canonicalizes workflow node transport identities at the protocol boundary", () => {
  assert.equal(canonicalizeTurnScopeId("workflow-node_node-1"), "workflow-node:node-1");
  assert.equal(canonicalizeTurnScopeId("workflow-node:node-1"), "workflow-node:node-1");
  assert.equal(turnScopeIdentityKey("workflow-node:node-1"), "workflow-node_node-1");
  assert.equal(areCanonicalTurnScopeIdsEqual("workflow-node_node-1", "workflow-node:node-1"), true);
});

test("does not rewrite ordinary turn identities", () => {
  assert.equal(canonicalizeTurnScopeId("client-turn:one:two"), "client-turn:one:two");
  assert.equal(turnScopeIdentityKey("client-turn:one:two"), "client-turn:one:two");
});

test("canonical identity validation rejects transport encoding", () => {
  assert.equal(isCanonicalTurnScopeId("workflow-node:node-1"), true);
  assert.equal(isCanonicalTurnScopeId("workflow-node_node-1"), false);
});

test("builds workflow node identities from a single node execution id", () => {
  assert.equal(createWorkflowNodeTurnScopeId("run_n1_1"), "workflow-node:run_n1_1");
  assert.equal(createWorkflowNodeDialogProcessId("run_n1_1"), "wf_node_run_n1_1");
  assert.equal(readWorkflowNodeExecutionId("workflow-node:run_n1_1"), "run_n1_1");
  assert.equal(readWorkflowNodeExecutionId("workflow-node_run_n1_1"), "run_n1_1");
  assert.equal(createWorkflowNodeTurnScopeId(""), "");
  assert.equal(createWorkflowNodeDialogProcessId(" "), "");
  assert.equal(readWorkflowNodeExecutionId("client-turn:one"), "");
});

test("detects workflow node identities in both canonical and transport encodings", () => {
  assert.equal(isWorkflowNodeTurnScopeId("workflow-node:run_n1_1"), true);
  assert.equal(isWorkflowNodeTurnScopeId("workflow-node_run_n1_1"), true);
  assert.equal(isWorkflowNodeTurnScopeId("client-turn:one"), false);
  assert.equal(isWorkflowNodeTurnScopeId(""), false);
  assert.equal(isWorkflowNodeDialogProcessId("wf_node_run_n1_1"), true);
  assert.equal(isWorkflowNodeDialogProcessId("dialog-1"), false);
});
