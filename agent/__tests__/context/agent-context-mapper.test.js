/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentContextBuildEnvelope } from "@noobot/context-protocol/agent-context/envelope";
import { createAgentContextEnvelopeInput } from "../../src/context/agent-context-envelope-input.js";

function buildEnvelope() {
  return createAgentContextBuildEnvelope(
    createAgentContextEnvelopeInput({
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "p1",
      rootSessionId: "r1",
      dialogProcessId: "dp1",
      caller: "user",
      runConfig: {
        turnScopeId: "turn1",
        executionId: "run1",
        messageId: "message1",
      },
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
      },
      runtimeModel: "openai",
      allEnabledProviders: { openai: { model: "gpt-4o" } },
      systemRuntime: {
        now: "2026-08-16T00:00:00.000Z",
        isSuperUser: true,
        config: { allowUserInteraction: false, maxToolLoopTurns: "6" },
      },
      systemMessages: ["sys"],
      conversationMessages: [{ role: "user", content: "hi" }],
      contextBuild: {
        sourceRevision: "ctxsrc:test",
        mode: "existing_session",
        startedAt: "2026-08-16T00:00:00.000Z",
        completedAt: "2026-08-16T00:00:01.000Z",
      },
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
  assert.equal(context.execution.flags.allowUserInteraction, false);
  assert.equal(context.modelContext.messageBlocks.history.length, 1);
  assert.equal(context.execution.contextBuild.status, "ready");
  assert.equal(context.execution.contextBuild.mode, "existing_session");
  assert.equal(context.execution.contextBuild.sourceRevision, "ctxsrc:test");
  assert.equal(context.execution.contextBuild.messageCount, 1);
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
      createAgentContextBuildEnvelope({ identity: { sessionId: "s1", dialogProcessId: "dp1" } }),
    /context build receipt requires a complete context scope/,
  );
});
