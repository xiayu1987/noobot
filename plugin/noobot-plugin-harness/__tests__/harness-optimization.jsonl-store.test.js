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












test("appendJsonlBuffered supports adaptive flush by reason", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-"));
  const filePath = path.join(base, "events.jsonl");
  const strategy = { maxSize: 100, maxTime: 60000, onTerminal: true, onError: true };

  await appendJsonlBuffered(filePath, { id: 1 }, strategy, 0, { reason: "terminal" });
  const first = await fs.readFile(filePath, "utf8");
  assert.match(first, /"id":1/);

  await appendJsonlBuffered(filePath, { id: 2 }, strategy, 0, { reason: "error" });
  const second = await fs.readFile(filePath, "utf8");
  assert.match(second, /"id":2/);

  await flushAllJsonlBuffers();
});

test("appendJsonlBuffered rotates active JSONL and prunes old archives", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-rotate-"));
  const filePath = path.join(base, "events.jsonl");
  const strategy = {
    maxSize: 1,
    maxTime: 60000,
    onTerminal: true,
    onError: true,
    maxFileBytes: 80,
    maxFiles: 2,
  };

  await appendJsonlBuffered(filePath, { id: 1, payload: "x".repeat(120) }, strategy, 0, {
    reason: "terminal",
  });
  await appendJsonlBuffered(filePath, { id: 2, payload: "y".repeat(120) }, strategy, 0, {
    reason: "terminal",
  });

  const afterSecond = await fs.readdir(base);
  const rotatedAfterSecond = afterSecond.filter(
    (name) => name !== "events.jsonl" && name.startsWith("events.") && name.endsWith(".jsonl"),
  );
  assert.equal(rotatedAfterSecond.length, 1);

  const activeAfterSecond = await fs.readFile(filePath, "utf8");
  assert.match(activeAfterSecond, /"id":2/);
  assert.doesNotMatch(activeAfterSecond, /"id":1/);

  await appendJsonlBuffered(filePath, { id: 3, payload: "z".repeat(120) }, strategy, 0, {
    reason: "terminal",
  });
  await appendJsonlBuffered(filePath, { id: 4, payload: "w".repeat(120) }, strategy, 0, {
    reason: "terminal",
  });

  const entries = await fs.readdir(base);
  const rotated = entries.filter(
    (name) => name !== "events.jsonl" && name.startsWith("events.") && name.endsWith(".jsonl"),
  );
  assert.equal(rotated.length, 2);
  const active = await fs.readFile(filePath, "utf8");
  assert.match(active, /"id":4/);
});





































