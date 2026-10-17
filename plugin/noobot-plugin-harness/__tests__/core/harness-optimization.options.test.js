/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { HARNESS_PLANNING_GUIDANCE_MODE } from "../../src/core/constants.js";
import {
  assertHarnessAgentHostCapabilities,
  DEFAULT_HARNESS_DENY_TOOL_NAMES,
  normalizeOptions,
} from "../../src/core/options.js";

const INJECT_MODE = { planningGuidanceMode: HARNESS_PLANNING_GUIDANCE_MODE.INJECT };

test("normalizeOptions applies schema defaults and coercion", () => {
  const options = normalizeOptions({
    ...INJECT_MODE,
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
  assert.equal(options.capabilityModelTimeoutMs, 180000);
  assert.deepEqual(options.denyToolNames, [...DEFAULT_HARNESS_DENY_TOOL_NAMES]);
  assert.equal(options.jsonlFlushStrategy.maxFileBytes, 5 * 1024 * 1024);
  assert.equal(options.jsonlFlushStrategy.maxFiles, 20);
});

test("normalizeOptions requires capability calls to finish before the hook deadline", () => {
  assert.throws(
    () => normalizeOptions({ ...INJECT_MODE, timeoutMs: 1000, capabilityModelTimeoutMs: 1000 }),
    /capabilityModelTimeoutMs/,
  );
});

test("normalizeOptions does not expose workflow strategy options", () => {
  const options = normalizeOptions({
    ...INJECT_MODE,
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
  const options = normalizeOptions({ ...INJECT_MODE, enableToolBurstSummary: true });
  assert.equal(options.summaryOnToolBurstThreshold, true);
});

test("normalizeOptions can explicitly enable non-main model context clipping", () => {
  const options = normalizeOptions({ ...INJECT_MODE, clipNonMainModelContextMessages: true });
  assert.equal(options.clipNonMainModelContextMessages, true);
});

test("normalizeOptions keeps custom harness denyToolNames", () => {
  const options = normalizeOptions({
    ...INJECT_MODE,
    denyToolNames: ["task_summary", "", "task_summary"],
  });
  assert.deepEqual(options.denyToolNames, ["task_summary"]);
});

test("agent host capabilities reject separate_model without capabilityModelInvoker", () => {
  const options = normalizeOptions({
    planningGuidanceMode: HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL,
  });
  assert.throws(
    () => assertHarnessAgentHostCapabilities(options),
    /separate_model mode requires capabilityModelInvoker/,
  );
});

test("normalizeOptions keeps separate_model with injected capabilityModelInvoker", () => {
  const capabilityModelInvoker = async () => null;
  const options = normalizeOptions({
    planningGuidanceMode: HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL,
    capabilityModelInvoker,
  });
  assert.equal(options.planningGuidanceMode, HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL);
  assert.equal(options.capabilityModelInvoker, capabilityModelInvoker);
});
