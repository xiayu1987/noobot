/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "../../shared/testing/runtime-params.js";
import test from "node:test";
import assert from "node:assert/strict";
import { describeFilePreview } from "../src/preview.js";

test("preview types are identical for attachments and workspace paths", () => {
  for (const [name, type] of [
    ["file.md", "markdown"],
    ["page.HTML", "html"],
    ["data.json", "json"],
    ["data.xml", "xml"],
    ["data.csv", "csv"],
    ["data.tsv", "tsv"],
    ["code.ts", "code"],
    ["notes.txt", "text"],
    ["image.jfif", "image"],
    ["film.mp4", "video"],
    ["sound.mp3", "audio"],
    ["book.pdf", "pdf"],
    ["book.docx", "office"],
    ["archive.zip", "unsupported"],
  ]) {
    assert.equal(describeFilePreview({ name, mimeType: "application/octet-stream" }).type, type);
    assert.equal(describeFilePreview({ name: `runtime/files/${name}` }).type, type);
  }
});
test("MIME parameters and filename-less structured documents use the same contract", () => {
  assert.equal(
    describeFilePreview({ name: "document", mimeType: "Text/HTML; charset=utf-8" }).type,
    "html",
  );
  assert.equal(
    describeFilePreview({ name: "document", mimeType: "application/json" }).type,
    "json",
  );
  assert.equal(describeFilePreview({ name: "unknown", isText: true }).type, "text");
  assert.equal(describeFilePreview({ name: "bad.txt", isText: false }).type, "unsupported");
});
test("preview size uses only canonical size and the shared configured limit", () => {
  const descriptor = describeFilePreview({ name: "data.json" });
  assert.equal(
    describeFilePreview({ name: "data.json", size: descriptor.maxBytes }).overLimit,
    false,
  );
  assert.equal(
    describeFilePreview({ name: "data.json", size: descriptor.maxBytes + 1 }).overLimit,
    true,
  );
  assert.equal(
    describeFilePreview({ name: "image.png", size: descriptor.maxBytes + 1 }).overLimit,
    false,
  );
  const media = describeFilePreview({ name: "film.mp4" });
  assert.ok(media.maxBytes > descriptor.maxBytes);
  assert.equal(describeFilePreview({ name: "film.mp4", size: media.maxBytes + 1 }).overLimit, true);
});

test("text representations retain their display type and use the text snapshot budget", () => {
  const text = describeFilePreview({ name: "note.txt", isText: true });
  const svg = describeFilePreview({ name: "icon.svg", isText: true, size: text.maxBytes + 1 });
  assert.equal(svg.type, "image");
  assert.equal(svg.mimeType, "image/svg+xml");
  assert.equal(svg.maxBytes, text.maxBytes);
  assert.equal(svg.overLimit, true);
});
