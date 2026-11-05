/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";

const TEST_NOW = () => "2026-01-01T00:00:00.000Z";

test("memory-postprocess: resolveMemorySummaryTimeoutMs supports canonical keys", () => {
  const service = new MemoryPostProcessService({
    now: TEST_NOW,
    globalConfig: {
      memory: {
        summarizeTimeoutMs: 11111,
      },
    },
    session: {},
    memory: {},
    errorLogger: null,
  });

  const fromUser = service.resolveMemorySummaryTimeoutMs({
    memory: {
      summarizeTimeoutMs: 22222,
    },
  });
  assert.equal(fromUser, 22222);

  const fromUserCanonical = service.resolveMemorySummaryTimeoutMs({
    memory: {
      summarizeTimeoutMs: 33333,
    },
  });
  assert.equal(fromUserCanonical, 33333);
});
