/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAgentTransportCommand } from "../src/index.js";

test("transport diagnostics expose correlation metadata without business payloads", () => {
  const summary = summarizeAgentTransportCommand({
    protocolVersion: 2,
    commandType: "send",
    commandId: "command-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1", userId: "secret-user" },
    input: { message: "secret message", attachments: [{ content: "secret attachment" }] },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 7 },
    session: { createIfAbsent: false },
    interaction: { response: { token: "secret-token" } },
  });

  assert.equal(summary.commandId, "command-1");
  assert.equal(summary.sessionId, "session-1");
  assert.equal(summary.messageLength, 14);
  assert.equal(summary.attachmentCount, 1);
  assert.equal(summary.expectedTurnRevision, 0);
  assert.equal(summary.expectedAggregateVersion, 7);
  assert.equal(summary.createSessionIfAbsent, false);
  assert.equal(summary.hasUserIdField, true);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /secret message|secret attachment|secret-user|secret-token/);
});
