/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectSessionAttachmentState } from "../../src/session/services/session-attachment-projection.js";

test("session display projection joins current attachment state by canonical identity", async () => {
  const identity = {
    attachmentId: "attachment-1",
    sessionId: "session-1",
    attachmentSource: "user",
  };
  const relation = {
    relationType: "parsed_result",
    sourceIdentity: identity,
    targetIdentity: {
      attachmentId: "parsed-1",
      sessionId: "session-1",
      attachmentSource: "model",
    },
    createdAt: "2026-08-17T00:00:00.000Z",
  };
  const source = {
    sessionId: "session-1",
    messages: [
      {
        role: "user",
        attachments: [{ ...identity, name: "source.png", mimeType: "image/png" }],
      },
    ],
  };
  const calls = [];
  const projected = await projectSessionAttachmentState({
    userId: "admin",
    session: source,
    attachmentService: {
      async readAttachmentMetas(scope) {
        calls.push(scope);
        return [{ ...identity, name: "source.png", mimeType: "image/png", relations: [relation] }];
      },
    },
  });

  assert.deepEqual(calls, [
    { userId: "admin", sessionId: "session-1", attachmentSource: "user" },
  ]);
  assert.deepEqual(projected.messages[0].attachments[0].relations, [relation]);
  assert.equal(source.messages[0].attachments[0].relations, undefined);
});
