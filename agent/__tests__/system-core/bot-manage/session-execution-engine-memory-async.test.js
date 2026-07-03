import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

const TEST_SHORT_DELAY_MS = 5;
const TEST_MEDIUM_DELAY_MS = 20;

function createEngine({ captureSessionToShortMemory, maybeSummarize, globalConfig = {} } = {}) {
  const session = {
    async appendExecutionLog() {},
    async appendTurn() {},
    async saveCurrentTurnTasks() {},
    async getExecutionBundle() {
      return { logs: [] };
    },
  };
  const memory = {
    async captureSessionToShortMemory(...args) {
      if (typeof captureSessionToShortMemory === "function") {
        return captureSessionToShortMemory(...args);
      }
      return undefined;
    },
    async maybeSummarize(...args) {
      if (typeof maybeSummarize === "function") {
        return maybeSummarize(...args);
      }
      return undefined;
    },
  };
  return new SessionExecutionEngine({
    globalConfig,
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
    await new Promise((resolve) => setTimeout(resolve, TEST_SHORT_DELAY_MS));
  }
}

test("_finalizeRunSession does not block on memory postprocess when async enabled", async () => {
  let resolveCapture = null;
  let captureStarted = false;
  let summarizeStarted = false;
  const engine = createEngine({
    captureSessionToShortMemory: async () => {
      captureStarted = true;
      await new Promise((resolve) => {
        resolveCapture = resolve;
      });
    },
    maybeSummarize: async () => {
      summarizeStarted = true;
    },
  });

  const finalizePromise = engine._finalizeRunSession(
    buildFinalizeInput({
      memory: { postprocess_async: true, summarize_async: true },
    }),
  );

  const result = await finalizePromise;
  assert.ok(result);
  assert.equal(captureStarted, true);
  assert.equal(summarizeStarted, false);
  await waitFor(() => typeof resolveCapture === "function");

  resolveCapture?.();
  await waitFor(() => summarizeStarted === true);
});

test("_finalizeRunSession blocks on memory postprocess when postprocess async disabled", async () => {
  let finalizeCompleted = false;
  let resolveCapture = null;
  const engine = createEngine({
    captureSessionToShortMemory: async () => {
      await new Promise((resolve) => {
        resolveCapture = resolve;
      });
    },
    maybeSummarize: async () => {
      return undefined;
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(
      buildFinalizeInput({
        memory: { postprocess_async: false, summarize_async: true },
      }),
    )
    .then(() => {
      finalizeCompleted = true;
    });

  await new Promise((resolve) => setTimeout(resolve, TEST_MEDIUM_DELAY_MS));
  assert.equal(finalizeCompleted, false);
  await waitFor(() => typeof resolveCapture === "function");

  resolveCapture?.();
  await finalizePromise;
  assert.equal(finalizeCompleted, true);
});

test("_finalizeRunSession does not block on memory summarize when only summary async enabled", async () => {
  let finalizeCompleted = false;
  let captureCompleted = false;
  let summarizeStarted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    captureSessionToShortMemory: async () => {
      captureCompleted = true;
    },
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(
      buildFinalizeInput({
        memory: { postprocess_async: false, summarize_async: true },
      }),
    )
    .then(() => {
      finalizeCompleted = true;
    });

  await waitFor(() => captureCompleted === true);
  await waitFor(() => summarizeStarted === true);
  await waitFor(() => finalizeCompleted === true);
  assert.equal(typeof resolveSummarize, "function");

  resolveSummarize?.();
  await finalizePromise;
});

test("_finalizeRunSession uses code builtin memory summarize async default without config", async () => {
  let finalizeCompleted = false;
  let summarizeStarted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(buildFinalizeInput({ memory: { postprocess_async: false } }))
    .then(() => {
      finalizeCompleted = true;
    });

  await waitFor(() => summarizeStarted === true);
  await waitFor(() => finalizeCompleted === true);
  assert.equal(typeof resolveSummarize, "function");

  resolveSummarize?.();
  await finalizePromise;
});

test("_finalizeRunSession ignores user memory summarize async false and still runs background", async () => {
  let finalizeCompleted = false;
  let summarizeStarted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(
      buildFinalizeInput({
        memory: { postprocess_async: false, summarize_async: false },
      }),
    )
    .then(() => {
      finalizeCompleted = true;
    });

  await waitFor(() => summarizeStarted === true);
  await waitFor(() => finalizeCompleted === true);
  assert.equal(typeof resolveSummarize, "function");

  resolveSummarize?.();
  await finalizePromise;
});

test("_finalizeRunSession ignores legacy user memorySummarizeAsync false and still runs background", async () => {
  let finalizeCompleted = false;
  let summarizeStarted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(
      buildFinalizeInput({
        memory: { postprocess_async: false },
        memorySummarizeAsync: false,
      }),
    )
    .then(() => {
      finalizeCompleted = true;
    });

  await waitFor(() => summarizeStarted === true);
  await waitFor(() => finalizeCompleted === true);
  assert.equal(typeof resolveSummarize, "function");

  resolveSummarize?.();
  await finalizePromise;
});

test("_finalizeRunSession ignores global memory summarize async false and still runs background", async () => {
  let finalizeCompleted = false;
  let summarizeStarted = false;
  let resolveSummarize = null;
  const engine = createEngine({
    globalConfig: { memory: { summarize_async: false } },
    maybeSummarize: async () => {
      summarizeStarted = true;
      await new Promise((resolve) => {
        resolveSummarize = resolve;
      });
    },
  });

  const finalizePromise = engine
    ._finalizeRunSession(buildFinalizeInput({ memory: { postprocess_async: false } }))
    .then(() => {
      finalizeCompleted = true;
    });

  await waitFor(() => summarizeStarted === true);
  await waitFor(() => finalizeCompleted === true);
  assert.equal(typeof resolveSummarize, "function");

  resolveSummarize?.();
  await finalizePromise;
});
