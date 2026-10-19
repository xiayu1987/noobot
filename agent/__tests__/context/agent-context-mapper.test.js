/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentContextEnvelope } from "@noobot/context-protocol/agent-context/envelope";
import { createAgentContextEnvelopeInput } from "../../src/context/agent-context-envelope-input.js";
import {
  TEST_AGENT_EXECUTION,
  createTestAgentEnvironment,
} from "../helpers/agent-execution-scope.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function buildEnvelope() {
  return createAgentContextEnvelope(
    createAgentContextEnvelopeInput({
      identity: {
        userId: "u1",
        sessionId: "s1",
        parentSessionId: "p1",
        rootSessionId: "r1",
        dialogProcessId: "dp1",
      },
      runConfig: { turnScopeId: "turn1", executionId: "run1", messageId: "message1" },
      staticInfo: {
        cwd: "/workspace",
        basePath: "/workspace/u1",
        platform: "linux",
        arch: "x64",
        nodeVersion: "v20.0.0",
        timezone: "Asia/Shanghai",
        globalDefaults: { workspaceRoot: "/workspace" },
      },
      workspaceDirectories: ["runtime/session", "runtime/ops_workdir"],
      systemRuntime: {
        now: "2026-08-16T00:00:00.000Z",
        caller: SESSION_CALLER.USER,
        isSuperUser: true,
        config: { allowUserInteraction: false, safeConfirm: true, selectedConnectorIds: ["c1"] },
      },
      runtimeModel: "openai",
      allEnabledProviders: { openai: { model: "gpt-4o" } },
      systemMessages: ["sys"],
      conversationMessages: [{ role: "user", content: "hi" }],
      incrementalMessages: [],
    }),
  );
}

test("explicit envelope input creates a serializable versioned envelope", () => {
  const context = buildEnvelope();
  assert.equal(context.kind, "noobot.agent-context");
  assert.equal(context.protocolVersion, 1);
  assert.deepEqual(context.identity, {
    userId: "u1",
    sessionId: "s1",
    rootSessionId: "r1",
    parentSessionId: "p1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    runId: "run1",
    messageId: "message1",
  });
  assert.equal(context.environment.permissions.isSuperUser, true);
  assert.equal(context.environment.workspace.basePath, "/workspace/u1");
  assert.equal(context.execution.timestamp, "2026-08-16T00:00:00.000Z");
  assert.deepEqual(context.execution.flags, { allowUserInteraction: false, safeConfirm: true });
  assert.deepEqual(context.execution.selectedConnectorIds, ["c1"]);
  assert.equal(context.modelContext.messageBlocks.history.length, 1);
  assert.equal("contextBuild" in context.execution, false);
  assert.doesNotThrow(() => JSON.stringify(context));
});

test("explicit envelope input excludes runtime controllers and tool instances", () => {
  const context = buildEnvelope();
  assert.equal("runtime" in context, false);
  assert.equal("controllers" in context.execution, false);
  assert.equal("payload" in context, false);
});

test("protocol envelope rejects incomplete execution identity", () => {
  assert.throws(
    () =>
      createAgentContextEnvelope({
        identity: { sessionId: "s1", dialogProcessId: "dp1" },
        environment: createTestAgentEnvironment({ basePath: "/workspace" }),
        execution: TEST_AGENT_EXECUTION,
        messageBlocks: { system: [], history: [], incremental: [] },
      }),
    /identity\.turnScopeId must be a non-empty string/,
  );
});
