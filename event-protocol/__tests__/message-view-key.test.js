/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveMessageViewKey } from "../src/message-event.js";

test("message view identity selects the role-owned field without repairing it", () => {
  assert.equal(
    resolveMessageViewKey({
      role: "assistant",
      presentationMessageId: "view-1",
      messageUid: "uid-1",
    }),
    "view-1",
  );
  assert.equal(
    resolveMessageViewKey({ role: "user", messageUid: "uid-1", presentationMessageId: "view-1" }),
    "uid-1",
  );
  assert.equal(resolveMessageViewKey({ role: "assistant", messageUid: "uid-1" }), "");
  assert.equal(resolveMessageViewKey({ role: "assistant", presentationMessageId: "" }), "");
  for (const key of [null, 42, " view-1", "view-1 "]) {
    assert.throws(
      () => resolveMessageViewKey({ role: "assistant", presentationMessageId: key }),
      TypeError,
    );
    assert.throws(() => resolveMessageViewKey({ role: "user", messageUid: key }), TypeError);
  }
  assert.throws(() => resolveMessageViewKey(), TypeError);
});
