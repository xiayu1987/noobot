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

import { normalizeOptions } from "../src/options.js";
import { appendJsonlBuffered, flushAllJsonlBuffers } from "../src/lib/store.js";
import { createCapabilityRuntime } from "../src/capabilities/runtime.js";
import { HARNESS_HOOK_POINTS } from "../src/constants.js";
import { inferFsmTarget, HARNESS_FSM_STATES } from "../src/fsm/transitions.js";
import { buildEvent } from "../src/data/record-builders.js";

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
});

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

test("takeover priority pipeline keeps higher priority takeover effective", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: true, priority: 0 },
      guidance: { enabled: true, priority: 0 },
    },
    handlers: {
      planning: async ({ point }) =>
        point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: { content: "planning", id: "planning", mode: "prepend", priority: 5 },
            }
          : null,
      guidance: async ({ point }) =>
        point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: { content: "guidance", id: "guidance", mode: "prepend", priority: 20 },
            }
          : null,
    },
  });

  const ctx = { messages: [{ role: "user", content: "hello" }] };
  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT, ctx, {});

  assert.match(String(ctx.messages[0]?.content || ""), /guidance/);
  assert.match(String(ctx.messages[1]?.content || ""), /planning/);
});

test("inferFsmTarget uses rule table consistently", () => {
  const toPlanning = inferFsmTarget(HARNESS_HOOK_POINTS.BEFORE_TURN, {}, HARNESS_FSM_STATES.IDLE);
  const toPlanned = inferFsmTarget(
    HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
    { agentContext: { payload: { harness: { taskChecklist: [{ task: "x" }] } } } },
    HARNESS_FSM_STATES.PLANNING,
  );
  const toFailed = inferFsmTarget(HARNESS_HOOK_POINTS.ON_ERROR, {}, HARNESS_FSM_STATES.EXECUTING);

  assert.equal(toPlanning, HARNESS_FSM_STATES.PLANNING);
  assert.equal(toPlanned, HARNESS_FSM_STATES.PLANNED);
  assert.equal(toFailed, HARNESS_FSM_STATES.FAILED);
});

test("buildEvent promotes mini-runner tool turn limit flag to top level", () => {
  const event = buildEvent({
    point: "before_llm_call",
    ctx: {
      harnessCapabilityLogs: [
        {
          domain: "planning",
          event: "capability_model_trace",
          detail: {
            purpose: "planning",
            toolTurnLimitReached: true,
            traces: [{ turn: 5, toolTurnLimitReached: true }],
          },
        },
      ],
    },
    pluginName: "noobot-plugin-harness",
    pluginVersion: "0.1.0",
  });

  assert.equal(event.toolTurnLimitReached, true);
});
