/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAgentTransportCommand } from "../src/index.mjs";

test("transport diagnostics expose correlation metadata without business payloads", () => {
  const summary = summarizeAgentTransportCommand({
    protocolVersion: 1,
    commandType: "send",
    commandId: "command-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1", userId: "secret-user" },
    input: { message: "secret message", attachments: [{ content: "secret attachment" }] },
    interaction: { response: { token: "secret-token" } },
  });

  assert.equal(summary.commandId, "command-1");
  assert.equal(summary.sessionId, "session-1");
  assert.equal(summary.messageLength, 14);
  assert.equal(summary.attachmentCount, 1);
  assert.equal(summary.hasUserIdField, true);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /secret message|secret attachment|secret-user|secret-token/);
});
