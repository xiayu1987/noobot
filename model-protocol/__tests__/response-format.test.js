/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelResponseFormat } from "../src/index.js";

test("response format maps provider endpoints consistently for fetch input types", () => {
  for (const [path, expected] of [
    ["/v1/messages", "anthropic"],
    ["/v1/responses", "responses"],
    ["/proxy/v1/chat/completions", "chat"],
    ["/v1/images/generations", null],
    ["/v1/not-responses", null],
    ["/v1/responses/extra", null],
    ["/v1/other?endpoint=/responses", null],
    ["/v1/responses?stream=true#fragment", "responses"],
  ]) {
    const url = `https://provider.test${path}`;
    for (const input of [url, new URL(url), new Request(url)])
      assert.equal(resolveModelResponseFormat(input), expected);
  }
});

test("response format rejects an invalid URL instead of treating it as unsupported", () => {
  assert.throws(() => resolveModelResponseFormat("invalid"), TypeError);
});
