/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertSessionRunRequest } from "../src/session-run-request.js";

function request() {
  return {
    userId: "user-1",
    sessionId: "session-1",
    message: "task",
    attachments: [],
    systemMessages: [],
    eventListener: null,
    caller: "bot",
    parentSessionId: "",
    parentDialogProcessId: "",
    dialogProcessId: "dialog-1",
    abortSignal: new AbortController().signal,
    userInteractionBridge: null,
    userInterjectionPort: null,
    runConfig: {},
    turnAcceptance: null,
    turnScopeId: "turn-1",
    persistenceScope: null,
  };
}

test("session run request preserves explicit fields and permits an unallocated dialog", () => {
  const payload = request();
  assert.equal(assertSessionRunRequest(payload), payload);
  payload.dialogProcessId = "";
  assert.equal(assertSessionRunRequest(payload), payload);
});

test("session run request rejects omitted ports and unknown identity fields", () => {
  const payload = request();
  delete payload.eventListener;
  assert.throws(() => assertSessionRunRequest(payload), /requires: eventListener/);
  assert.throws(
    () => assertSessionRunRequest({ ...request(), messageId: "legacy" }),
    /unknown fields: messageId/,
  );
});

test("session run request rejects malformed identity and storage ownership", () => {
  for (const patch of [
    { turnScopeId: " " },
    { dialogProcessId: " dialog-1 " },
    { parentDialogProcessId: null },
    { parentSessionId: null },
    { persistenceScope: {} },
    { attachments: null },
    { systemMessages: null },
    { runConfig: [] },
  ]) {
    assert.throws(() => assertSessionRunRequest({ ...request(), ...patch }), TypeError);
  }
  for (const payload of [null, [], "request"]) {
    assert.throws(() => assertSessionRunRequest(payload), /must be a plain object/);
  }
});
