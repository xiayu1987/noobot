import test from "node:test";
import assert from "node:assert/strict";

import { mapToAgentContextSchema } from "../../../src/system-core/context/formatters/agent-context-mapper.js";

test("mapToAgentContextSchema maps runtime/session/payload fields correctly", () => {
  const context = mapToAgentContextSchema({
    staticAgentContext: {
      userId: "u1",
      cwd: "/workspace",
      basePath: "/workspace/u1",
      workspaceDirectories: ["runtime/session", "runtime/workspace"],
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      timezone: "Asia/Shanghai",
      globalDefaults: { workspaceRoot: "/workspace" },
    },
    runtime: {
      runtimeModel: "openai",
      allEnabledProviders: { openai: { model: "gpt-4o" } },
      attachmentMetas: [{ attachmentId: "att_1" }],
      currentTurnMessages: { id: "m1" },
      currentTurnTasks: { id: "t1" },
      sharedTools: { x: true },
      systemRuntime: {
        sessionId: "s1",
        parentSessionId: "p1",
        dialogProcessId: "dp1",
        rootSessionId: "r1",
        config: {
          allowUserInteraction: false,
          maxToolLoopTurns: "6",
          selectedConnectors: {
            " mysql ": " prod-db ",
          },
        },
      },
    },
    resolvedRootSessionId: "r1",
    resolvedSessionTree: { roots: ["r1"], nodes: {} },
    systemMessages: ["sys"],
    conversationMessages: [{ role: "user", content: "hi" }],
  });

  assert.equal(context.environment.identity.userId, "u1");
  assert.equal(context.execution.flags.allowUserInteraction, false);
  assert.equal(context.execution.flags.maxToolLoopTurns, 6);
  assert.equal(context.execution.models.runtimeModel, "openai");
  assert.equal(context.session.current.id, "s1");
  assert.deepEqual(context.session.current.connectors, { mysql: "prod-db" });
  assert.equal("attachments" in context.session.current, false);
  assert.equal("turnStore" in context.session.current, false);
  assert.deepEqual(context.payload.messages.system, ["sys"]);
  assert.equal(context.payload.messages.history.length, 1);
  assert.equal("shared" in context.payload.tools, false);
  context.execution.controllers.runtime.abortSignal = { aborted: true };
  context.execution.controllers.runtime.parentAsyncResultContainer = { id: "p_1" };
  context.execution.controllers.runtime.attachmentMetas.push({ attachmentId: "att_2" });
  context.execution.controllers.runtime.sharedTools.y = true;
  assert.equal("abortSignal" in context.execution.controllers, false);
  assert.equal(
    "parentAsyncResultContainer" in context.execution.controllers,
    false,
  );
  assert.equal(context.execution.controllers.runtime.attachmentMetas.length, 2);
  assert.equal("attachments" in context.session.current, false);
  assert.equal("turnStore" in context.session.current, false);
  assert.equal(context.execution.controllers.runtime.sharedTools.y, true);
  assert.deepEqual(context.execution.controllers.runtime.abortSignal, { aborted: true });
  assert.deepEqual(
    context.execution.controllers.runtime.parentAsyncResultContainer,
    { id: "p_1" },
  );
  assert.equal(context.execution.controllers.runtime.attachmentMetas.length, 2);
  assert.equal("abortSignal" in context.execution.controllers, false);
  assert.equal(
    "parentAsyncResultContainer" in context.execution.controllers,
    false,
  );
  assert.equal("attachments" in context.session.current, false);
  assert.equal("turnStore" in context.session.current, false);
  assert.equal("shared" in context.payload.tools, false);
});

test("mapToAgentContextSchema keeps empty os/workspace fields when static context is missing", () => {
  const context = mapToAgentContextSchema({
    staticAgentContext: {},
    runtime: {
      systemRuntime: {},
    },
    globalConfig: {},
  });

  assert.equal(context.environment.os.platform, "");
  assert.equal(context.environment.os.arch, "");
  assert.equal(context.environment.os.timezone, "");
  assert.equal(context.environment.os.nodeVersion, "");
  assert.equal(context.environment.workspace.cwd, "");
});
