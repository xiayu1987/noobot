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
  turnScopeIdentityKey,
} from "../turn-scope-identity.mjs";

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
