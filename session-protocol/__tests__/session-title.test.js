/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveSessionNamedTitle, resolveSessionTitle } from "../src/index.js";

test("session titles prioritize the user title over the message-derived title", () => {
  const session = Object.freeze({
    sessionId: "session-12345678",
    customTitle: "Project notes",
    autoTitle: "First question",
  });
  assert.equal(resolveSessionNamedTitle(session), "Project notes");
  assert.equal(resolveSessionTitle(session), "Project notes");
  assert.equal(resolveSessionNamedTitle({ ...session, customTitle: "" }), "First question");
  assert.equal(resolveSessionTitle({ ...session, customTitle: "" }), "First question");
});

test("an unavailable named title remains explicit while ordinary session display retains its identity", () => {
  const session = { sessionId: "session-12345678", title: "Unverified projection" };
  assert.equal(resolveSessionNamedTitle(session), "");
  assert.equal(resolveSessionTitle(session), "session-");
});
