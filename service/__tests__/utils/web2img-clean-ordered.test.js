/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isNoiseOrAdLine,
  cleanAndDedupLines,
} from "../../system-core/utils/web/web2img/web2img-clean.js";
import { segmentsToMarkdown } from "../../system-core/utils/web/web2img/web2img-ordered.js";

test("web2img clean: isNoiseOrAdLine identifies ad/noise lines", () => {
  assert.equal(isNoiseOrAdLine("广告", ["广告"]), true);
  assert.equal(isNoiseOrAdLine("相关推荐", ["推荐"]), true);
  assert.equal(isNoiseOrAdLine("This is normal content line", ["广告"]), false);
});

test("web2img clean: cleanAndDedupLines removes ads and duplicate lines", () => {
  const lines = [
    "This is normal content line",
    "广告",
    "This is normal content line",
    "This is normal content line  ",
    "Another valid content line",
  ];
  const cleaned = cleanAndDedupLines(lines, ["广告"]);

  assert.deepEqual(cleaned, ["This is normal content line", "Another valid content line"]);
});

test("web2img ordered: segmentsToMarkdown renders text and code", () => {
  const segments = [
    { type: "text", text: "This is normal content line" },
    { type: "text", text: "This is normal content line" },
    { type: "code", lang: "js", text: "console.log('x')" },
  ];

  const md = segmentsToMarkdown(segments, [], 9999);
  assert.match(md, /This is normal content line/);
  assert.match(md, /```js/);
});

test("web2img ordered: segmentsToMarkdown appends truncation marker", () => {
  const segments = [
    { type: "text", text: "This is normal content line" },
    { type: "code", lang: "js", text: "console.log('x')" },
  ];

  const md = segmentsToMarkdown(segments, [], 20);
  assert.match(md, /内容过长，已截断|content too long, truncated/);
});
