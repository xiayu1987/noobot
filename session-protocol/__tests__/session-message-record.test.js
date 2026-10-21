/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_AUTO_TITLE_MAX_LENGTH,
  deriveSessionAutoTitle,
  resolveSessionAutoTitle,
} from "../src/aggregate/session-message-record.js";

test("session auto title comes from the first non-injected user message with content", () => {
  assert.equal(
    deriveSessionAutoTitle([
      { role: "assistant", content: "hello" },
      { role: "user", injectedMessage: true, content: "injected" },
      { role: "user", content: "   " },
      { role: "USER", content: "first real question" },
      { role: "user", content: "second question" },
    ]),
    "first real question",
  );
});

test("session auto title truncates to the protocol length", () => {
  const content = "x".repeat(SESSION_AUTO_TITLE_MAX_LENGTH + 5);
  assert.equal(resolveSessionAutoTitle({ role: "user", content }).length, 20);
});

test("session auto title is empty when no message qualifies", () => {
  assert.equal(deriveSessionAutoTitle([{ role: "assistant", content: "a" }]), "");
  assert.equal(resolveSessionAutoTitle({ role: "user", content: "" }), "");
});
