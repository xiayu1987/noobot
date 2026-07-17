/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { emitFinalStreamingAppendDeltaAfterHooks } from "../../../../src/system-core/agent/core/engine.js";
import {
  buildLoopResult,
  FINAL_STREAMING_RESULT_META_KEY,
} from "../../../../src/system-core/agent/core/turn/turn-result-aggregator.js";

test("final streaming append delta: emits only hook-appended suffix after final output mutation", () => {
  const events = [];
  const result = buildLoopResult({
    output: "模型最终回答",
    traces: [],
    loopState: { turnMessages: [], turnTasks: [] },
    modelMessages: [],
    finalStreaming: {
      streamed: true,
      output: "模型最终回答",
      mode: "final_stream_no_tools",
    },
  });

  assert.equal(Object.keys(result).includes(FINAL_STREAMING_RESULT_META_KEY), false);

  result.output = "模型最终回答\n\n---\n[Plugin-验收] 通过";

  const emitted = emitFinalStreamingAppendDeltaAfterHooks({
    result,
    runtime: {
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
      systemRuntime: {
        sessionId: "s1",
        dialogProcessId: "dp1",
      },
    },
  });

  assert.equal(emitted, true);
  const delta = events.find((item) => item?.event === "llm_delta");
  assert.ok(delta);
  assert.equal(delta.data.text, "\n\n---\n[Plugin-验收] 通过");
  assert.equal(delta.data.type, "final_output_append_delta");
});


test("final streaming append delta: tolerates finalizer trim before appending", () => {
  const events = [];
  const result = buildLoopResult({
    output: "模型最终回答   ",
    traces: [],
    loopState: { turnMessages: [], turnTasks: [] },
    finalStreaming: {
      streamed: true,
      output: "模型最终回答   ",
      mode: "final_stream_no_tools",
    },
  });
  result.output = "模型最终回答\n\n---\n验收";

  const emitted = emitFinalStreamingAppendDeltaAfterHooks({
    result,
    runtime: {
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
    },
  });

  assert.equal(emitted, true);
  assert.equal(
    events.find((item) => item?.event === "llm_delta")?.data?.text,
    "\n\n---\n验收",
  );
});

test("final streaming append delta: skips when hook rewrites instead of appends", () => {
  const events = [];
  const result = buildLoopResult({
    output: "旧回答",
    traces: [],
    loopState: { turnMessages: [], turnTasks: [] },
    finalStreaming: {
      streamed: true,
      output: "旧回答",
      mode: "final_stream_no_tools",
    },
  });
  result.output = "新回答\n\n---\n验收";

  const emitted = emitFinalStreamingAppendDeltaAfterHooks({
    result,
    runtime: {
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
    },
  });

  assert.equal(emitted, false);
  assert.equal(events.some((item) => item?.event === "llm_delta"), false);
  assert.equal(
    events.some((item) => item?.event === "llm_final_stream_append_delta_skipped"),
    true,
  );
});
