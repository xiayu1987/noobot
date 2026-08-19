/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDebugAttachments } from "../debug-projection.js";

test("debug attachment projection exposes bounded non-sensitive facts", () => {
  const attachments = Array.from({ length: 10 }, (_, index) => ({
    attachmentId: `att-${index}`,
    filename: `file-${index}.txt`,
    mime: "text/plain",
    size: index,
    url: `https://private/${index}`,
  }));
  const projected = summarizeDebugAttachments(attachments);
  assert.equal(projected.count, 10);
  assert.equal(projected.items.length, 8);
  assert.equal(projected.items[0].url, "present");
  assert.equal(projected.items[0].id, "att-0");
});
