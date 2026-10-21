/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentContextEnvelope } from "@noobot/context-protocol";
import { buildContextSnapshot } from "../../src/data/record-builders.js";

const IDENTITY = Object.freeze({
  userId: "u-snapshot",
  sessionId: "s-child",
  rootSessionId: "s-root",
  parentSessionId: "s-root",
  dialogProcessId: "d-snapshot",
  turnScopeId: "t-snapshot",
  runId: "r-snapshot",
  presentationMessageId: "m-snapshot",
});

const ENVIRONMENT = Object.freeze({
  os: { platform: "linux", arch: "x64", timezone: "UTC", nodeVersion: "v0" },
  workspace: {
    cwd: "/tmp/snapshot",
    basePath: "/tmp/snapshot",
    workspaceDirectories: [],
    globalDefaults: {},
  },
  permissions: { isSuperUser: false },
});

const EXECUTION = Object.freeze({
  timestamp: "2026-01-01T00:00:00.000Z",
  caller: "user",
  flags: { allowUserInteraction: true, safeConfirm: false },
  model: { runtimeModel: "model-snapshot", allEnabledProviders: {} },
  selectedConnectorIds: ["c-1"],
});

test("context snapshot reads identity, execution and lane counts from the envelope", () => {
  const context = createAgentContextEnvelope({
    identity: IDENTITY,
    environment: ENVIRONMENT,
    execution: EXECUTION,
    messageBlocks: {
      system: [{ role: "system", content: "s" }],
      history: [
        { role: "user", content: "h1" },
        { role: "assistant", content: "h2" },
      ],
      incremental: [],
    },
  });
  const ctx = {
    agentContext: {
      context,
      bindings: { runtime: { userMessageAttachments: [{ id: "a-1" }] }, tools: [], extensions: {} },
    },
  };

  const snapshot = buildContextSnapshot({ ctx, pluginName: "harness", pluginVersion: "1.0.0" });

  assert.equal(snapshot.userId, IDENTITY.userId);
  assert.equal(snapshot.sessionId, IDENTITY.sessionId);
  assert.equal(snapshot.parentSessionId, IDENTITY.parentSessionId);
  assert.equal(snapshot.dialogProcessId, IDENTITY.dialogProcessId);
  assert.equal(snapshot.caller, EXECUTION.caller);
  assert.deepEqual(snapshot.environment.os, ENVIRONMENT.os);
  assert.deepEqual(snapshot.execution, {
    flags: EXECUTION.flags,
    runtimeModel: EXECUTION.model.runtimeModel,
  });
  assert.deepEqual(snapshot.session, { attachmentCount: 1, connectorIds: ["c-1"] });
  assert.deepEqual(snapshot.payload, { systemMessageCount: 1, historyMessageCount: 2 });
});

test("context snapshot rejects a hook context without agentContext", () => {
  assert.throws(() => buildContextSnapshot({ ctx: {}, pluginName: "harness", pluginVersion: "1" }));
});
