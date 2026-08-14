/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  getBasePathFromAgentContext,
  getChildRunParentSessionIdFromAgentContext,
  getDialogProcessIdFromAgentContext,
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
  getToolsFromAgentContext,
} from "../../src/context/agent-context-accessor.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("agent context accessors separate the runtime execution root from the logical display root", () => {
  const systemRuntime = { sessionId: "runtime-session" };
  const runtime = { id: "runtime", basePath: "/host/workspaces/u1", systemRuntime };
  const tools = [{ name: "read_file" }];
  const scope = createTestAgentExecutionScope(runtime, {
    identity: {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "p1",
      rootSessionId: "r1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
    },
    environment: { workspace: { basePath: "/workspace" } },
    tools,
  });
  assert.equal(getRuntimeFromAgentContext(scope), runtime);
  assert.equal(getSystemRuntimeFromAgentContext(scope), systemRuntime);
  assert.equal(getToolsFromAgentContext(scope), tools);
  assert.equal(getBasePathFromAgentContext(scope), "/host/workspaces/u1");
  assert.equal(scope.context.environment.workspace.basePath, "/workspace");
  assert.equal(getDialogProcessIdFromAgentContext(scope), "d1");
  assert.equal(getChildRunParentSessionIdFromAgentContext(scope), "r1");
  assert.deepEqual(getSessionIdsFromAgentContext(scope), scope.context.identity);
});

test("agent context accessors reject removed runtime paths", () => {
  assert.throws(
    () => getRuntimeFromAgentContext({ runtime: { id: "legacy" } }),
    /bindings\.runtime is required/,
  );
  assert.throws(
    () => getRuntimeFromAgentContext({ execution: { controllers: { runtime: {} } } }),
    /bindings\.runtime is required/,
  );
});

test("getSystemRuntimeFromRuntime reads the canonical runtime field", () => {
  const systemRuntime = { sessionId: "s1" };
  assert.equal(getSystemRuntimeFromRuntime({ systemRuntime }), systemRuntime);
  assert.deepEqual(getSystemRuntimeFromRuntime({ systemRuntime: null }), {});
});
