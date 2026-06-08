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

