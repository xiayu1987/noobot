/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mapToAgentContextSchema } from "../../src/context/formatters/agent-context-mapper.js";

function buildEnvelope() {
  return mapToAgentContextSchema({
    staticAgentContext: {
      userId: "u1",
      cwd: "/workspace",
      basePath: "/workspace/u1",
      workspaceDirectories: ["runtime/session", "runtime/ops_workdir"],
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      timezone: "Asia/Shanghai",
      globalDefaults: { workspaceRoot: "/workspace" },
      identity: { userId: "u1", isSuperUser: true },
    },
    runtime: {
      runtimeModel: "openai",
      allEnabledProviders: { openai: { model: "gpt-4o" } },
      systemRuntime: {
        sessionId: "s1",
        parentSessionId: "p1",
        rootSessionId: "r1",
        config: { allowUserInteraction: false, maxToolLoopTurns: "6" },
      },
    },
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    runId: "run1",
    systemMessages: ["sys"],
    conversationMessages: [{ role: "user", content: "hi" }],
  });
}

test("mapToAgentContextSchema creates a serializable versioned envelope", () => {
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
  });
  assert.equal(context.environment.permissions.isSuperUser, true);
  assert.equal(context.execution.flags.allowUserInteraction, false);
  assert.equal(context.modelContext.messageBlocks.history.length, 1);
  assert.doesNotThrow(() => JSON.stringify(context));
});

test("mapToAgentContextSchema excludes runtime controllers and tool instances", () => {
  const context = buildEnvelope();
  assert.equal("runtime" in context, false);
  assert.equal("controllers" in context.execution, false);
  assert.equal("payload" in context, false);
});

test("mapToAgentContextSchema rejects incomplete execution identity", () => {
  assert.throws(
    () => mapToAgentContextSchema({ sessionId: "s1", dialogProcessId: "dp1" }),
    /identity\.turnScopeId is required/,
  );
});
