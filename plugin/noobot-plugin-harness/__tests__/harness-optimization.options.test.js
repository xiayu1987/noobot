// Tests split by responsibility from harness-optimization.test.js.
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_HARNESS_DENY_TOOL_NAMES, normalizeOptions } from "../src/core/options.js";
import { normalizeHookContextProtocol } from "../src/core/context.js";
import { appendJsonlBuffered, flushAllJsonlBuffers } from "../src/store/store.js";
import { createCapabilityRuntime } from "../src/capabilities/runtime.js";
import { HARNESS_HOOK_POINTS } from "../src/core/constants.js";
import { inferFsmTarget, HARNESS_FSM_STATES } from "../src/fsm/transitions.js";
import { buildEvent } from "../src/data/record-builders.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";
import { markGuidanceSummarizedMessages } from "../src/capabilities/handlers/guidance/signal-tracker.js";
import { invokeWithReasoningRetry } from "../src/capabilities/handlers/shared/model/invocation-utils.js";
import {
  markMessagesSummarized,
  relaySeparateModelOutputAsUserMessage,
} from "../src/capabilities/handlers/shared.js";

test("normalizeOptions applies schema defaults and coercion", () => {
  const options = normalizeOptions({
    miniRunnerMaxTurns: "15",
    manifestDebounceMs: "0",
    jsonlFlushStrategy: { maxSize: "100", maxTime: "5000", onTerminal: false },
    fsmEnabled: false,
  });

  assert.equal(options.miniRunnerMaxTurns, 15);
  assert.equal(options.manifestDebounceMs, 0);
  assert.equal(options.jsonlFlushStrategy.maxSize, 100);
  assert.equal(options.jsonlFlushStrategy.maxTime, 5000);
  assert.equal(options.jsonlFlushStrategy.onTerminal, false);
  assert.equal(options.jsonlFlushStrategy.onError, true);
  assert.equal(options.fsmEnabled, false);
  assert.equal(Object.hasOwn(options, "nonProgramming" + "Workflow" + "Strategy"), false);
  assert.equal(Object.hasOwn(options, "nonProgramming" + "Execution" + "First"), false);
  assert.equal(options.summaryOnToolBurstThreshold, false);
  assert.equal(options.clipNonMainModelContextMessages, false);
  assert.deepEqual(options.denyToolNames, [...DEFAULT_HARNESS_DENY_TOOL_NAMES]);
  assert.equal(options.jsonlFlushStrategy.maxFileBytes, 5 * 1024 * 1024);
  assert.equal(options.jsonlFlushStrategy.maxFiles, 20);
});

test("normalizeOptions does not expose workflow strategy options", () => {
  const options = normalizeOptions({
    ["nonProgramming" + "Workflow" + "Strategy"]: "risk" + "_first",
    ["workflow" + "Strategy"]: "execution" + "-first",
    ["prompt" + "Strategy"]: "risk" + "First",
    ["nonProgramming" + "Execution" + "First"]: false,
    ["execution" + "First"]: false,
    ["action" + "First"]: false,
    ["execution" + "FirstForNonProgramming"]: false,
  });
  assert.equal(Object.hasOwn(options, "nonProgramming" + "Workflow" + "Strategy"), false);
  assert.equal(Object.hasOwn(options, "nonProgramming" + "Execution" + "First"), false);
  assert.equal(Object.hasOwn(options, "workflow" + "Strategy"), false);
  assert.equal(Object.hasOwn(options, "prompt" + "Strategy"), false);
  assert.equal(Object.hasOwn(options, "execution" + "First"), false);
  assert.equal(Object.hasOwn(options, "action" + "First"), false);
});


test("normalizeOptions enables optional tool-burst summary trigger", () => {
  const options = normalizeOptions({ enableToolBurstSummary: true });
  assert.equal(options.summaryOnToolBurstThreshold, true);
});

test("normalizeOptions can explicitly enable non-main model context clipping", () => {
  const options = normalizeOptions({ clipNonMainModelContextMessages: true });
  assert.equal(options.clipNonMainModelContextMessages, true);
});

test("normalizeOptions keeps custom harness denyToolNames", () => {
  const options = normalizeOptions({
    denyToolNames: ["plan_multi_task_collaboration", "", "plan_multi_task_collaboration"],
  });
  assert.deepEqual(options.denyToolNames, ["plan_multi_task_collaboration"]);
});









































