/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitModelContextTrace } from "../../../src/observability/model-context-trace-emitter.js";

describe("context diagnostics", () => {
  it("always emits model context trace without a runtime switch", () => {
    const events = [];
    const eventListener = {
      onEvent(envelope) {
        events.push(envelope);
      },
    };
    assert.equal(emitModelContextTrace({ eventListener }, "resolved", { count: 2 }), true);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "model_context_trace");
    assert.deepEqual(events[0]?.data, { stage: "resolved", count: 2 });
  });
});
