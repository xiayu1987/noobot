/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitModelContextTrace } from "../../../src/observability/model-context-trace-emitter.js";

function createListener() {
  const events = [];
  return { events, listener: { onEvent: (envelope) => events.push(envelope) } };
}

describe("context diagnostics", () => {
  it("emits model context trace to the explicit event listener", () => {
    const { events, listener } = createListener();
    emitModelContextTrace(listener, "resolved", { count: 2 });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "model_context_trace");
    assert.deepEqual(events[0]?.data, { count: 2, stage: "resolved" });
  });

  it("rejects a missing stage instead of defaulting it", () => {
    const { events, listener } = createListener();
    assert.throws(() => emitModelContextTrace(listener, "", {}), /stage is required/);
    assert.equal(events.length, 0);
  });
});
