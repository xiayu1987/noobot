/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createAgentContextEnvelope } from "../src/agent-context/agent-context-envelope.js";
import { validateAgentContextEnvelope } from "../src/agent-context/agent-context-validation.js";

function createEnvelope(overrides = {}) {
  return createAgentContextEnvelope({
    identity: {
      userId: "u1",
      sessionId: "s1",
      rootSessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      runId: "r1",
      messageId: "m1",
    },
    environment: { workspace: { cwd: "/workspace" } },
    execution: { caller: "user", flags: {} },
    modelContext: {
      protocolVersion: 2,
      activeTurnIdentity: { dialogProcessId: "d1", turnScopeId: "t1" },
      messageBlocks: { system: [], history: [], incremental: [] },
    },
    ...overrides,
  });
}

test("agent context envelope is versioned and JSON serializable", () => {
  const envelope = createEnvelope();
  assert.equal(envelope.kind, "noobot.agent-context");
  assert.equal(envelope.protocolVersion, 1);
  assert.doesNotThrow(() => JSON.stringify(envelope));
});

test("agent context envelope rejects runtime capabilities", () => {
  const envelope = createEnvelope();
  const result = validateAgentContextEnvelope({ ...envelope, runtime: {} });
  assert.equal(result.success, false);
  assert.match(result.errors.join("\n"), /runtime is forbidden/);
});

test("agent context envelope rejects functions and identity disagreement", () => {
  const envelope = createEnvelope();
  const result = validateAgentContextEnvelope({
    ...envelope,
    environment: { inspect() {} },
    modelContext: {
      ...envelope.modelContext,
      activeTurnIdentity: { dialogProcessId: "other", turnScopeId: "t1" },
    },
  });
  assert.equal(result.success, false);
  assert.match(result.errors.join("\n"), /must match identity\.dialogProcessId/);
  assert.match(result.errors.join("\n"), /not JSON-serializable/);
});

test("agent context envelope requires explicit current execution identity", () => {
  assert.throws(
    () => createEnvelope({ identity: { sessionId: "s1", dialogProcessId: "d1" } }),
    /identity\.turnScopeId is required/,
  );
});
