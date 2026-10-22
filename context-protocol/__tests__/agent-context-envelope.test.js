/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createAgentContextEnvelope } from "../src/agent-context/envelope.js";
import { validateAgentContextEnvelope } from "../src/agent-context/validation.js";

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
      presentationMessageId: "m1",
    },
    environment: {
      os: { platform: "linux", arch: "x64", timezone: "UTC", nodeVersion: "v22.0.0" },
      workspace: {
        cwd: "/workspace",
        basePath: "/workspace",
        workspaceDirectories: [],
        globalDefaults: {},
      },
      permissions: { isSuperUser: false },
    },
    execution: {
      timestamp: "2026-01-01T00:00:00.000Z",
      caller: "user",
      flags: { allowUserInteraction: true, safeConfirm: false },
      model: { runtimeModel: "m", allEnabledProviders: {} },
      selectedConnectorIds: [],
    },
    messageBlocks: { system: [], history: [], incremental: [] },
    userMetaBackwrites: [],
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
  assert.match(result.errors.join("\n"), /runtime is not part of the protocol/);
});

test("agent context envelope rejects functions and duplicated model context facts", () => {
  const envelope = createEnvelope();
  const result = validateAgentContextEnvelope({
    ...envelope,
    environment: { inspect() {} },
    modelContext: {
      ...envelope.modelContext,
      activeTurnIdentity: { dialogProcessId: "d1", turnScopeId: "t1" },
      messageBlocks: { system: [], history: [] },
    },
  });
  assert.equal(result.success, false);
  const errors = result.errors.join("\n");
  assert.match(errors, /modelContext\.activeTurnIdentity is not part of the protocol/);
  assert.match(errors, /modelContext\.messageBlocks\.incremental must be array/);
  assert.match(errors, /not JSON-serializable/);
});

test("agent context envelope requires every identity field explicitly", () => {
  assert.throws(
    () => createEnvelope({ identity: { sessionId: "s1", dialogProcessId: "d1" } }),
    (error) =>
      ["userId", "rootSessionId", "turnScopeId", "runId", "presentationMessageId"].every((field) =>
        error.message.includes(`identity.${field} must be a non-empty string`),
      ) && error.message.includes("identity.parentSessionId must be string"),
  );
});

test("agent context identity rejects extra keys and accepts an empty root parentSessionId", () => {
  const envelope = createEnvelope();
  assert.equal(envelope.identity.parentSessionId, "");
  const result = validateAgentContextEnvelope({
    ...envelope,
    identity: { ...envelope.identity, isSuperUser: true },
  });
  assert.equal(result.success, false);
  assert.match(result.errors.join("\n"), /identity\.isSuperUser is not part of the protocol/);
});

test("agent context envelope rejects a non-object identity with the protocol error", () => {
  assert.throws(
    () =>
      createAgentContextEnvelope({
        identity: null,
        environment: {},
        execution: {},
        messageBlocks: {},
      }),
    /invalid agent context envelope: .*identity must be a plain object/,
  );
});

test("agent context envelope rejects incomplete or extra environment and execution fields", () => {
  const envelope = createEnvelope();
  const result = validateAgentContextEnvelope({
    ...envelope,
    environment: { ...envelope.environment, staticInfo: {} },
    execution: { ...envelope.execution, flags: { allowUserInteraction: true } },
  });
  assert.equal(result.success, false);
  const errors = result.errors.join("\n");
  assert.match(errors, /environment\.staticInfo is not part of the protocol/);
  assert.match(errors, /execution\.flags\.safeConfirm must be boolean/);
});
