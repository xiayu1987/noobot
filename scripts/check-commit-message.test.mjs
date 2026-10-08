/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findCoAuthorTrailers } from "./check-commit-message.mjs";

test("commit message check rejects co-author trailers for any contributor", () => {
  const message = [
    "fix: something",
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "co-authored-by: Someone Else <someone@example.com>",
    "  CO-AUTHORED-BY : Spaced Out <spaced@example.com>",
  ].join("\n");
  assert.equal(findCoAuthorTrailers(message).length, 3);
});

test("commit message check accepts messages without co-author trailers", () => {
  const message =
    "feat: add thing\n\nMentions co-authored-by in prose only.\nSigned-off-by: xiayu\n";
  assert.deepEqual(findCoAuthorTrailers(message), []);
});

test("commit message check ignores git comment lines", () => {
  assert.deepEqual(findCoAuthorTrailers("fix: x\n# Co-Authored-By: template hint\n"), []);
});
