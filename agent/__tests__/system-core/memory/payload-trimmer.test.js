/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { trimPromptPayloadByCharLimit } from "../../../src/system-core/memory/utils/payload-trimmer.js";

test("trimPromptPayloadByCharLimit keeps payload when within limit", () => {
  const payload = [{ records: [{ role: "user", content: "hello" }] }];
  const trimmed = trimPromptPayloadByCharLimit(payload, { maxChars: 1000 });
  assert.deepEqual(trimmed, payload);
});

test("trimPromptPayloadByCharLimit removes oldest one-third repeatedly", () => {
  const payload = Array.from({ length: 9 }, (_, index) => ({
    records: [{ role: "user", content: `msg-${index}-${"x".repeat(40000)}` }],
  }));
  const trimmed = trimPromptPayloadByCharLimit(payload, { maxChars: 150000 });
  assert.equal(trimmed.length, 2);
  assert.equal(
    trimmed[0]?.records?.[0]?.content?.startsWith("msg-7-"),
    true,
  );
});

test("trimPromptPayloadByCharLimit can shrink to empty when single item exceeds limit", () => {
  const payload = [
    { records: [{ role: "user", content: "x".repeat(200000) }] },
  ];
  const trimmed = trimPromptPayloadByCharLimit(payload, { maxChars: 150000 });
  assert.deepEqual(trimmed, []);
});
