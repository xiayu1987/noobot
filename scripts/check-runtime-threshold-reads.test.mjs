/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findModuleScopeThresholdReads } from "./check-runtime-threshold-reads.mjs";

function reads(source, file = "agent/src/example.js") {
  return findModuleScopeThresholdReads(file, source).map(({ line, key }) => [line, key]);
}

test("configurable leaves read at module scope are violations", () => {
  assert.deepEqual(
    reads(
      [
        "const limit = QUANTITY_THRESHOLDS.memory.maxItems;",
        "export const config = { timeoutMs: TIME_THRESHOLDS.agent.runTimeoutMs };",
        "class Store { static max = QUANTITY_THRESHOLDS.memory.maxItems; }",
      ].join("\n"),
    ),
    [
      [1, "QUANTITY_THRESHOLDS.memory.maxItems"],
      [2, "TIME_THRESHOLDS.agent.runTimeoutMs"],
      [3, "QUANTITY_THRESHOLDS.memory.maxItems"],
    ],
  );
});

test("call-time reads, group references and fixed parameters are allowed", () => {
  assert.deepEqual(
    reads(
      [
        "const memory = QUANTITY_THRESHOLDS.memory;",
        "const files = QUANTITY_THRESHOLDS.attachments.maxFileCount;",
        "function limit() { return QUANTITY_THRESHOLDS.memory.maxItems; }",
        "const run = () => TIME_THRESHOLDS.agent.runTimeoutMs;",
        "class Store { max = QUANTITY_THRESHOLDS.memory.maxItems; read() { return TIME_THRESHOLDS.agent.runTimeoutMs; } }",
        "function load({ timeoutMs = TIME_THRESHOLDS.agent.runTimeoutMs } = {}) { return timeoutMs; }",
      ].join("\n"),
    ),
    [],
  );
});

test("vue script blocks are scanned with their file line numbers", () => {
  const source = [
    "<template><div /></template>",
    "<script>",
    "const delay = TIME_THRESHOLDS.agent.runTimeoutMs;",
    "export default {};",
    "</script>",
  ].join("\n");
  assert.deepEqual(reads(source, "client/noobot-chat/src/Example.vue"), [
    [3, "TIME_THRESHOLDS.agent.runTimeoutMs"],
  ]);
});
