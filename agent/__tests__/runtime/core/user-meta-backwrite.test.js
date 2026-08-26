/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { appendUserMetaParsedResult } from "../../../src/context/assembly/message-builder/user-meta.js";

const content = `[用户元信息]\n${JSON.stringify({ attachments: [{ attachmentRef: "a1" }] })}\n[/用户元信息]`;

test("user_meta parsed result is a finite per-attachment projection", () => {
  const next = appendUserMetaParsedResult(content, {
    sourceAttachmentRef: "a1",
    parsedAttachmentRef: "parsed-a1",
    name: "scan.md",
    mimeType: "text/markdown",
    size: 12,
  });
  assert.match(next, /parsedResults/);
  assert.match(next, /parsed-a1/);
  const replaced = appendUserMetaParsedResult(next, {
    sourceAttachmentRef: "a1",
    parsedAttachmentRef: "parsed-a1-new",
  });
  assert.equal((replaced.match(/sourceAttachmentRef/g) || []).length, 1);
  assert.match(replaced, /parsed-a1-new/);
  assert.doesNotMatch(replaced, /parsed-a1\\"/);
});
