/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";

const identity = { userId: "u1", sessionId: "s1", persistenceScope: null };

test("user meta reuses source content without reading or encoding any message body", async (t) =>
  withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ session, runtime }) => {
    for (const turnScopeId of ["source", "unrelated"])
      await session.appendTurns({
        ...identity,
        turns: [
          {
            role: "user",
            messageOrigin: "natural",
            messageUid: `sm_${turnScopeId}`,
            dialogProcessId: turnScopeId,
            turnScopeId,
            attachments: [],
            transferEnvelopes: [],
            content: turnScopeId === "source" ? "source 中文".repeat(20000) : turnScopeId,
          },
        ],
      });
    const repository = runtime.repositories.sessionRepository;
    const options = { persistenceContext: repository.treePersistenceContext("u1", "s1") };
    await using beforeReader = await repository.requireSessionReader("u1", "s1", options);
    const before = await beforeReader.readMetadata();
    const get = ImmutableSessionStore.prototype.get;
    const bodyReads = t.mock.method(
      ImmutableSessionStore.prototype,
      "get",
      function (snapshot, collection, key) {
        if (collection === "messages") assert.fail("user meta must not read any message body");
        return get.call(this, snapshot, collection, key);
      },
    );
    const putValue = ImmutableRecordStore.prototype.putValue;
    const bodyWrites = t.mock.method(
      ImmutableRecordStore.prototype,
      "putValue",
      function (value, options) {
        if (value?.message) {
          assert.equal(value.message.content, null);
          assert.equal(options.parts.length, 1);
        }
        return putValue.call(this, value, options);
      },
    );
    const original = repository.findById;
    repository.findById = () => {
      throw new Error("user meta must use the source turn view");
    };
    const result = { sourceAttachmentRef: "attach://source", summary: "parsed source" };
    try {
      await session.recordUserMetaParsedResult({
        ...identity,
        userMetaSourceMessageUid: "sm_source",
        result,
      });
      await assert.rejects(
        session.recordUserMetaParsedResult({
          ...identity,
          userMetaSourceMessageUid: "sm_missing",
          result,
        }),
        { code: "USER_META_SOURCE_NOT_FOUND" },
      );
    } finally {
      repository.findById = original;
      bodyReads.mock.restore();
      bodyWrites.mock.restore();
    }
    await using afterReader = await repository.requireSessionReader("u1", "s1", options);
    const after = await afterReader.readMetadata();
    assert.equal(afterReader.generation, beforeReader.generation + 1);
    assert.equal(after.aggregateVersion, before.aggregateVersion);
    assert.ok(Date.parse(after.updatedAt) >= Date.parse(before.updatedAt));
    assert.deepEqual((await afterReader.readMessage("sm_source")).message.userMetaParsedResults, [
      result,
    ]);
    assert.equal((await afterReader.readMessage("sm_unrelated")).message.content, "unrelated");
    assert.equal(
      (await afterReader.readMessage("sm_source")).message.content,
      "source 中文".repeat(20000),
    );
    assert.equal(
      (await beforeReader.readMessage("sm_source")).message.userMetaParsedResults,
      undefined,
    );
  }));
