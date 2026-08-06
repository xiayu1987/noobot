/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loopControlSource = readFileSync(
  new URL("../../src/runtime/loop-control.js", import.meta.url),
  "utf8",
);
const orchestratorSource = readFileSync(
  new URL("../../src/runtime/turn/orchestrator.js", import.meta.url),
  "utf8",
);
const loopConstantsSource = readFileSync(
  new URL("../../src/runtime/constants/loop.js", import.meta.url),
  "utf8",
);

test("checkpoint is the only runtime boundary allowed to remove prior model input", () => {
  for (const source of [loopControlSource, orchestratorSource, loopConstantsSource]) {
    assert.doesNotMatch(source, /removePhaseSummaryPromptMessages/);
    assert.doesNotMatch(source, /removeTaskCheckPromptMessages/);
  }
  assert.doesNotMatch(loopConstantsSource, /noobot\.phase_summary_prompt/);
  assert.doesNotMatch(loopConstantsSource, /noobot\.task_check_prompt/);
  assert.doesNotMatch(orchestratorSource, /modelContext\.messages\.(?:pop|splice)\s*\(/);
  assert.doesNotMatch(orchestratorSource, /consumeInjectedContextMessages/);
  assert.doesNotMatch(orchestratorSource, /MODEL_INVOCATION_COMPLETED/);
  assert.doesNotMatch(orchestratorSource, /TOOL_CALLS_COMPLETED/);
});
