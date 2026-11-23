/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_METADATA_ERROR_CODE } from "@noobot/attachment-protocol";

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
        attachments: [{ ...identity, name: "old-name.png", mimeType: "image/png", size: 99 }],
      },
    ],
  };
  const calls = [];
  const projected = await projectSessionAttachmentState({
    userId: "admin",
    session: source,
    attachmentService: {
      async readAttachmentMetadata(request) {
        calls.push(request);
        return [{ ...identity, name: "source.png", mimeType: "image/png", relations: [relation] }];
      },
    },
  });

  assert.deepEqual(calls, [{ userId: "admin", identities: [identity] }]);
  assert.deepEqual(projected.messages[0].attachments[0], {
    ...identity,
    name: "source.png",
    mimeType: "image/png",
    relations: [relation],
  });
  assert.equal(source.messages[0].attachments[0].relations, undefined);
});

test("session display distinguishes missing metadata from an unreadable canonical scope", async () => {
  const identity = { attachmentId: "id", sessionId: "session", attachmentSource: "user" };
  const session = { messages: [{ attachments: [{ ...identity, name: "historical.png" }] }] };
  const project = (readAttachmentMetadata) =>
    projectSessionAttachmentState({
      userId: "admin",
      session,
      attachmentService: { readAttachmentMetadata },
    });

  await assert.rejects(
    project(async () => [null]),
    {
      code: ATTACHMENT_METADATA_ERROR_CODE.MISSING,
      details: identity,
    },
  );
  const cause = new SyntaxError("corrupt index");
  await assert.rejects(
    project(async () => {
      throw cause;
    }),
    {
      code: ATTACHMENT_METADATA_ERROR_CODE.UNREADABLE,
      cause,
    },
  );
  await assert.rejects(
    project(async () => [{ ...identity, sessionId: "other" }]),
    {
      code: ATTACHMENT_METADATA_ERROR_CODE.UNREADABLE,
    },
  );
  await assert.rejects(
    project(async () => [identity, identity]),
    {
      code: ATTACHMENT_METADATA_ERROR_CODE.UNREADABLE,
    },
  );
});
