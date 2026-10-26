/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

const TEST_SHORT_DELAY_MS = 5;
const TEST_MEDIUM_DELAY_MS = 20;

function createEngine({
  captureDialogToShortMemory = async () => true,
  maybeSummarize = async () => undefined,
  globalConfig = {},
  appendTurns = async (payload = {}) => ({ appended: true, reason: "", turns: payload.turns }),
  upsertTurnTiming = async () => {},
} = {}) {
  const session = {
    async appendExecutionLog() {},
    appendTurns,
    upsertTurnTiming,
    async saveCurrentTurnTasks() {},
    async getExecutionTurnLogs() {
      return [];
    },
    async saveExecutionReport() {},
    async getSessionTurns() {
      return [];
    },
  };
  const memory = { captureDialogToShortMemory, maybeSummarize };
  return createTestSessionExecutionEngine({
    globalConfig,
    session,
    memory,
    attach: {},
    skill: {},
    configService: {
      async loadUserConfig() {
        return {};
      },
    },
    workspaceService: {
      async ensureUserWorkspace() {
        return "/tmp";
      },
      getWorkspacePath() {
        return "/tmp";
      },
    },
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
    caller: SESSION_CALLER.USER,
    dialogProcessId: "d1",
    turnScopeId: "turn-1",
    thinkingStartedAt: "2026-07-08T16:49:44.113Z",
    agentResult: {
      output: "ok",
      turnMessages: [{ role: "assistant", type: "message", content: "ok", messageUid: "sm_final" }],
      turnTasks: [],
    },
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
    runtimeEventListener: null,
    userConfig,
    persistenceScope: null,
  };
}

test("_finalizeRunSession persists only thinking finish facts to turn timing", async () => {
  const appendTurnPayloads = [];
  const timingPayloads = [];
  const engine = createEngine({
    appendTurns: async (payload = {}) => {
      appendTurnPayloads.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
    },
    upsertTurnTiming: async (payload) => timingPayloads.push(payload),
  });

  await engine._finalizeRunSession(buildFinalizeInput({ memory: { postprocess_async: true } }));

  assert.equal(appendTurnPayloads.length, 1);
  for (const key of [
    "thinkingStartedAt",
    "thinkingFinishedAt",
    "turnTimingThinkingStartedAt",
    "turnTimingThinkingFinishedAt",
  ]) {
    assert.equal(Object.hasOwn(appendTurnPayloads[0], key), false);
  }
  assert.equal(timingPayloads.length, 1);
  assert.ok(timingPayloads[0].thinkingFinishedAt);
  assert.equal(Object.hasOwn(timingPayloads[0], "thinkingStartedAt"), false);
});

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
    captureDialogToShortMemory: async () => {
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
    captureDialogToShortMemory: async () => {
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
    captureDialogToShortMemory: async () => {
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
