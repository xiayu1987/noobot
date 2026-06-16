import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExecutionEvent,
  normalizeSseLogEvent,
} from "../../../src/system-core/tracking/event-log/log-normalizer.js";

test("classifyExecutionEvent classifies semantic-transfer events", () => {
  assert.deepEqual(classifyExecutionEvent("semantic_transfer_validation"), {
    category: "semantic_transfer",
    type: "semantic_transfer",
  });
  assert.deepEqual(classifyExecutionEvent("semantic_transfer_legacy_input_warning"), {
    category: "semantic_transfer",
    type: "semantic_transfer",
  });
});

test("normalizeSseLogEvent normalizes semantic-transfer validation event", () => {
  const normalized = normalizeSseLogEvent({
    event: "semantic_transfer_validation",
    data: { scenario: "tool_output", invalidCount: 0 },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.event, "thinking");
  assert.equal(normalized.data.category, "semantic_transfer");
  assert.equal(normalized.data.type, "semantic_transfer");
  assert.equal(normalized.data.event, "semantic_transfer");
  assert.equal(normalized.data.semanticTransferType, "validation");
  assert.equal(normalized.data.scenario, "tool_output");
});

test("normalizeSseLogEvent normalizes semantic-transfer legacy warning event", () => {
  const normalized = normalizeSseLogEvent({
    event: "semantic_transfer_legacy_input_warning",
    data: { api: "getTransferFiles" },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.event, "thinking");
  assert.equal(normalized.data.category, "semantic_transfer");
  assert.equal(normalized.data.semanticTransferType, "legacy_input_warning");
  assert.equal(normalized.data.api, "getTransferFiles");
});



test("normalizeSseLogEvent keeps tool_call_start text compact", () => {
  const normalized = normalizeSseLogEvent({
    event: "tool_call_start",
    data: { tool: "write_file", args: { content: "x".repeat(1000) } },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.data.text, "write_file started");
  assert.equal(normalized.data.args.content.length, 1000);
});

test("normalizeSseLogEvent keeps tool_call_end result intact and text compact", () => {
  const result = { ok: true, content: "x".repeat(1000) };
  const normalized = normalizeSseLogEvent({
    event: "tool_call_end",
    data: { tool: "read_file", result },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.data.text, "read_file completed");
  assert.equal(normalized.data.result.content.length, 1000);
});

test("normalizeSseLogEvent marks compact text when result has semantic-transfer info", () => {
  const result = {
    ok: true,
    transferEnvelopes: [{ protocol: "noobot.semantic-transfer" }],
  };
  const normalized = normalizeSseLogEvent({
    event: "tool_call_end",
    data: { tool: "read_file", result },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.data.text, "read_file completed semantic-transfer");
  assert.equal(normalized.data.result, result);
});

test("normalizeSseLogEvent keeps generic event text compact", () => {
  const normalized = normalizeSseLogEvent({
    event: "custom_event",
    data: { payload: "x".repeat(1000) },
    ts: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(normalized.data.text, "custom_event");
  assert.equal(normalized.data.payload.length, 1000);
});
