/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";

test("memory-postprocess reads turns through the session facade with the run persistence scope", async () => {
  const persistenceScope = { scopeId: "scope-1" };
  const messages = [{ role: "user", content: "hi", dialogProcessId: "d1" }];
  const turnReads = [];
  const captures = [];
  const service = new MemoryPostProcessService({
    globalConfig: {},
    session: {
      async getSessionTurns(payload) {
        turnReads.push(payload);
        return messages;
      },
    },
    memory: {
      async captureDialogToShortMemory(payload) {
        captures.push(payload);
        return true;
      },
      async maybeSummarize() {},
    },
    errorLogger: null,
  });

  await service.runMemoryPostProcessFlow({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    dialogProcessId: "d1",
    persistenceScope,
    userConfig: {},
    runtimeEventListener: null,
    mode: "sync",
  });

  assert.deepEqual(turnReads, [{ userId: "u1", sessionId: "s1", persistenceScope }]);
  assert.deepEqual(captures, [
    { userId: "u1", sessionId: "s1", parentSessionId: "p1", dialogProcessId: "d1", messages },
  ]);
});
