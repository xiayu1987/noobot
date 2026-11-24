/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

function session() {
  return { ...createTestSessionRequiredFields(), sessionId: "session", aggregateVersion: 0 };
}

for (const field of ["version", "revision", "sessionArtifacts", "turnTerminalCommits"]) {
  test(`normalization rejects retired ${field} without changing the source`, () => {
    const source = { ...session(), [field]: null };
    const before = structuredClone(source);
    assert.throws(() => normalizeSessionEntity(source), {
      code: "SESSION_PROTOCOL_INVALID",
      protocolErrors: [`retired_session_field:${field}`],
    });
    assert.deepEqual(source, before);
  });
}

test("normalization rejects retired short-memory checkpoints without rewriting the source", () => {
  assert.equal(Object.hasOwn(normalizeSessionEntity(session()), "shortMemoryCheckpoint"), false);
  for (const shortMemoryCheckpoint of [null, "7", "invalid", 9]) {
    const source = { ...session(), shortMemoryCheckpoint };
    assert.throws(() => normalizeSessionEntity(source), {
      code: "SESSION_PROTOCOL_INVALID",
      protocolErrors: ["retired_session_field:shortMemoryCheckpoint"],
    });
    assert.equal(source.shortMemoryCheckpoint, shortMemoryCheckpoint);
  }
});
