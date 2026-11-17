/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { sessionStorageMessageHash } from "@noobot/session-protocol";
import { normalizeMessageEntity } from "../../src/session/entities/message-entity.js";

const timestamp = "2026-09-18T01:00:00.000Z";
function assistant(messageUid) {
  return {
    role: "assistant",
    messageUid,
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    chatPresentation: true,
    workspaceRootDirectory: "/workspace",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "client-turn:one",
    content: messageUid,
    attachments: [],
    transferEnvelopes: [],
    ts: timestamp,
  };
}

test("canonical frozen normalization retains storage identity and byte digest", () => {
  const canonical = deepFreeze(normalizeMessageEntity(assistant("one")));
  const digest = sessionStorageMessageHash(canonical);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(normalizeMessageEntity(canonical), canonical);
    assert.equal(sessionStorageMessageHash(normalizeMessageEntity(canonical)), digest);
  }
  const mutable = structuredClone(canonical);
  assert.notEqual(normalizeMessageEntity(mutable), mutable);
  const noncanonical = deepFreeze({ ...canonical, additional_kwargs: { obsolete: true } });
  assert.equal(Object.hasOwn(normalizeMessageEntity(noncanonical), "additional_kwargs"), false);
  const reordered = deepFreeze(Object.fromEntries(Object.entries(canonical).reverse()));
  const normalized = normalizeMessageEntity(reordered);
  assert.notEqual(normalized, reordered);
  assert.equal(JSON.stringify(normalized), JSON.stringify(canonical));
  const withUndefined = deepFreeze({ ...canonical, ignored: undefined });
  assert.equal(Object.hasOwn(normalizeMessageEntity(withUndefined), "ignored"), false);
});
