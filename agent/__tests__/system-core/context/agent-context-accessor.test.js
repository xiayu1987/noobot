import test from "node:test";
import assert from "node:assert/strict";

import {
  getBasePathFromAgentContext,
  getDialogProcessIdFromAgentContext,
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../../src/system-core/context/agent-context-accessor.js";

test("getRuntimeFromAgentContext prefers execution.controllers.runtime", () => {
  const runtimeFromController = { id: "controller" };
  const runtimeFromTopLevel = { id: "top" };
  const runtime = getRuntimeFromAgentContext({
    execution: { controllers: { runtime: runtimeFromController } },
    runtime: runtimeFromTopLevel,
  });
  assert.equal(runtime, runtimeFromController);
});

test("getRuntimeFromAgentContext falls back to top-level runtime and injected fallback", () => {
  const runtimeFromTopLevel = { id: "top" };
  assert.equal(
    getRuntimeFromAgentContext({ runtime: runtimeFromTopLevel }),
    runtimeFromTopLevel,
  );
  const fallbackRuntime = { id: "fallback" };
  assert.equal(getRuntimeFromAgentContext({}, fallbackRuntime), fallbackRuntime);
});

test("getSystemRuntimeFromAgentContext reads systemRuntime safely", () => {
  const systemRuntime = { sessionId: "s1" };
  assert.equal(
    getSystemRuntimeFromAgentContext({
      execution: { controllers: { runtime: { systemRuntime } } },
    }),
    systemRuntime,
  );
  assert.deepEqual(getSystemRuntimeFromAgentContext({}), {});
});

test("getSystemRuntimeFromRuntime reads and normalizes safely", () => {
  const systemRuntime = { sessionId: "s1" };
  assert.equal(getSystemRuntimeFromRuntime({ systemRuntime }), systemRuntime);
  assert.deepEqual(getSystemRuntimeFromRuntime({ systemRuntime: null }), {});
});

test("getSessionIdsFromAgentContext resolves ids from session view and runtime fallback", () => {
  const idsFromSessionView = getSessionIdsFromAgentContext({
    environment: { identity: { userId: "u1" } },
    session: {
      current: { id: "s1" },
      parent: { id: "p1" },
      root: { id: "r1" },
    },
    execution: {
      controllers: {
        runtime: {
          systemRuntime: {
            userId: "ux",
            sessionId: "sx",
            parentSessionId: "px",
            rootSessionId: "rx",
          },
        },
      },
    },
  });
  assert.deepEqual(idsFromSessionView, {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    rootSessionId: "r1",
  });

  const idsFromRuntime = getSessionIdsFromAgentContext({
    execution: {
      controllers: {
        runtime: {
          userId: "u2",
          systemRuntime: {
            sessionId: "s2",
            parentSessionId: "p2",
            rootSessionId: "r2",
          },
        },
      },
    },
  });
  assert.deepEqual(idsFromRuntime, {
    userId: "u2",
    sessionId: "s2",
    parentSessionId: "p2",
    rootSessionId: "r2",
  });
});

test("getBasePathFromAgentContext resolves workspace first then runtime fallback", () => {
  const fromWorkspace = getBasePathFromAgentContext({
    environment: { workspace: { basePath: "/workspace/u1" } },
    execution: { controllers: { runtime: { basePath: "/runtime/u1" } } },
  });
  assert.equal(fromWorkspace, "/workspace/u1");

  const fromRuntime = getBasePathFromAgentContext({
    execution: { controllers: { runtime: { basePath: "/runtime/u2" } } },
  });
  assert.equal(fromRuntime, "/runtime/u2");
});

test("getDialogProcessIdFromAgentContext resolves id from execution and runtime fallback", () => {
  const fromExecution = getDialogProcessIdFromAgentContext({
    execution: {
      dialogProcessId: "dp_execution",
      controllers: { runtime: { systemRuntime: { dialogProcessId: "dp_runtime" } } },
    },
  });
  assert.equal(fromExecution, "dp_execution");

  const fromRuntimeFallback = getDialogProcessIdFromAgentContext(
    {},
    { systemRuntime: { dialogProcessId: "dp_fallback" } },
  );
  assert.equal(fromRuntimeFallback, "dp_fallback");
});
