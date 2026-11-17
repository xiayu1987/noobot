/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitModelContextTrace } from "../../../src/observability/model-context-trace-emitter.js";
import { useRuntimeEventsEnv } from "../../helpers/runtime-events-env.js";
import { summarizeDiagnosticMessages } from "@noobot/shared/message-diagnostics";

function createListener() {
  const events = [];
  return { events, listener: { onEvent: (envelope) => events.push(envelope) } };
}

describe("context diagnostics", () => {
  it("reuses evidence without changing results and invalidates all mutable inputs", () => {
    const message = {
      role: "assistant",
      content: "original body",
      tool_calls: [{ id: "call-1", args: { value: 1 } }],
      additional_kwargs: { messageUid: "m1" },
    };
    const summarize = () => summarizeDiagnosticMessages([message]);
    const fresh = () => summarizeDiagnosticMessages([structuredClone(message)]);
    const initial = summarize();
    assert.deepEqual(summarize(), initial);
    for (const mutate of [
      () => {
        message.tool_calls[0].args.value = 2;
      },
      () => {
        message.content = "changed body";
      },
      () => {
        message.additional_kwargs.summarized = true;
      },
      () => {
        message.role = "tool";
        message.tool_call_id = "call-1";
      },
      () => {
        message.content = [{ type: "text", text: "multimodal" }];
      },
      () => {
        message.content[0].text = "changed in place";
      },
    ]) {
      mutate();
      assert.deepEqual(summarize(), fresh());
    }
    assert.notDeepEqual(summarize(), initial);
  });

  it("does not expose cached evidence through mutable result objects", () => {
    const message = { role: "user", content: "body", additional_kwargs: { messageUid: "m2" } };
    const first = summarizeDiagnosticMessages([message]);
    first.fingerprints[0] = "spoofed";
    first.evidence[0].contentHash = "spoofed";
    first.preview[0].contentPreview = "spoofed";
    const next = summarizeDiagnosticMessages([message]);
    assert.deepEqual(next, summarizeDiagnosticMessages([structuredClone(message)]));
  });

  it("builds and emits complete evidence when the protocol enables tracing", (t) => {
    useRuntimeEventsEnv(t, { debug: { modelContextTrace: true } });
    const { events, listener } = createListener();
    emitModelContextTrace(listener, "resolved", () => ({ count: 2 }));
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "model_context_trace");
    assert.deepEqual(events[0]?.data, { count: 2, stage: "resolved" });
  });

  it("does not access historical evidence when tracing is disabled", (t) => {
    useRuntimeEventsEnv(t, { debug: { modelContextTrace: false } });
    const { events, listener } = createListener();
    emitModelContextTrace(listener, "resolved", () => {
      throw new Error("historical evidence must not be accessed");
    });
    assert.equal(events.length, 0);
  });

  it("does not build evidence without a consumer", (t) => {
    useRuntimeEventsEnv(t, { debug: { modelContextTrace: true } });
    emitModelContextTrace(null, "resolved", () => {
      throw new Error("unconsumed evidence must not be built");
    });
  });

  it("propagates evidence construction errors when tracing is enabled", (t) => {
    useRuntimeEventsEnv(t, { debug: { modelContextTrace: true } });
    const { events, listener } = createListener();
    assert.throws(
      () =>
        emitModelContextTrace(listener, "resolved", () => {
          throw new Error("invalid evidence");
        }),
      /invalid evidence/,
    );
    assert.equal(events.length, 0);
  });

  it("rejects eager evidence instead of retaining a second interface", () => {
    const { listener } = createListener();
    assert.throws(() => emitModelContextTrace(listener, "resolved", {}), /payload builder/);
  });

  it("rejects a missing stage instead of defaulting it", () => {
    const { events, listener } = createListener();
    assert.throws(() => emitModelContextTrace(listener, "", () => ({})), /stage is required/);
    assert.equal(events.length, 0);
  });
});
