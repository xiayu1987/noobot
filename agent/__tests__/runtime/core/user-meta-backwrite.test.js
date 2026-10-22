/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readContextMessageField } from "@noobot/context-protocol/message/codec";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { buildHumanMessagesForUser } from "../../../src/context/assembly/message-builder/user-meta.js";

function sourceMessage(userMetaParsedResults) {
  return projectSessionRecordToContextMessage({
    messageUid: "sm_user_1",
    role: "user",
    content: "hello",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    messageOrigin: "natural",
    ...(userMetaParsedResults ? { userMetaParsedResults } : {}),
  });
}

test("user_meta is a projection derived from the source user message", () => {
  const parsed = { sourceAttachmentRef: "a1", parsedAttachmentRef: "parsed-a1" };
  const [content, meta] = buildHumanMessagesForUser({}, sourceMessage([parsed]));

  assert.equal(readContextMessageField(content, "messageUid"), "sm_user_1");
  assert.equal(readContextMessageField(meta, "messageUid"), "");
  assert.equal(readContextMessageField(meta, "projectionType"), "user_meta");
  assert.equal(readContextMessageField(meta, "sourceMessageUid"), "sm_user_1");
  assert.match(String(meta.content), /parsedResults/);
  assert.match(String(meta.content), /parsed-a1/);
});

test("user_meta omits parsedResults when the source has none", () => {
  const [, meta] = buildHumanMessagesForUser({}, sourceMessage());
  assert.doesNotMatch(String(meta.content), /parsedResults/);
});
