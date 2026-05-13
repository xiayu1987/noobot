import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../system-core/bot-manage/session/session-execution-engine.js";

function createEngine({ maybeSummarize } = {}) {
  const session = {
    async appendExecutionLog() {},
    async appendTurn() {},
    async saveCurrentTurnTasks() {},
    async getExecutionBundle() {
      return { logs: [] };
    },
  };
  const memory = {
    async captureSessionToShortMemory() {},
    async maybeSummarize(...args) {
      if (typeof maybeSummarize === "function") {
        return maybeSummarize(...args);
      }
      return undefined;
    },
  };
  return new SessionExecutionEngine({
    globalConfig: {},
    session,
    memory,
    attach: {},
    skill: {},
    configService: { async loadUserConfig() { return {}; } },
    workspaceService: { async ensureUserWorkspace() { return "/tmp"; } },
    errorLogger: { async log() {} },
    botManager: {},
    agentRunner: async () => ({ output: "ok" }),
  });
}

function buildFinalizeInput(userConfig = {}) {
  return {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    parentDialogProcessId: "",
    caller: "user",
    dialogProcessId: "d1",
    agentResult: {
      output: "ok",
      turnMessages: [{ role: "assistant", type: "message", content: "ok" }],
      turnTasks: [],
    },
    executionStartIndex: 0,
    runtimeEventListener: null,
    userConfig,
    resolvedParentAsyncResultContainer: null,
  };
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("_finalizeRunSession does not block on memory summarize when async enabled", async () => {
  let resolveSummarize = null;
  let summarizeStarted = false;
  const engine = createEngine({
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine._finalizeRunSession(
    buildFinalizeInput({
      memory: { summarize_async: true },
    }),
  );

  const result = await finalizePromise;
  assert.ok(result);
  assert.equal(summarizeStarted, true);
  await waitFor(() => typeof resolveSummarize === "function");

  resolveSummarize?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("_finalizeRunSession blocks on memory summarize when async disabled", async () => {
  let finalizeCompleted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    maybeSummarize: async () => {
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(
      buildFinalizeInput({
        memory: { summarize_async: false },
      }),
    )
    .then(() => {
      finalizeCompleted = true;
    });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(finalizeCompleted, false);
  await waitFor(() => typeof resolveSummarize === "function");

  resolveSummarize?.();
  await finalizePromise;
  assert.equal(finalizeCompleted, true);
});
