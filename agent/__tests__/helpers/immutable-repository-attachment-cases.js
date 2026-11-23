/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { submitTestSessionRequest } from "./session-services.js";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { observeStorageIo } from "./storage-io-observation.js";

export function registerImmutableAttachmentRepositoryTests({ fixture, message, ts }) {
  test("attachment binding uses point reads, preserves replay and atomically rejects conflicting commands", async (t) => {
    const { runtime, repository, persistenceContext, scope } = await fixture(t);
    const before = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    await submitTestSessionRequest(
      repository,
      "u1",
      "s1",
      await before.prepareRequest({
        operationId: "seed-binding",
        committedAt: ts,
        changes: {
          messages: [{ ...message("m1"), content: randomBytes(512 * 1024).toString("hex") }],
        },
      }),
      persistenceContext,
    );
    await writeFile(scope.sessionFile, "invalid legacy manifest");
    repository.requireById = () => assert.fail("binding must not export the session");
    repository.save = () => assert.fail("binding must not save a whole session");
    const withSessionReader = repository.withSessionReader.bind(repository);
    repository.withSessionReader = (userId, sessionId, run, options) =>
      withSessionReader(
        userId,
        sessionId,
        ({ reader, commitChanges, readCurrent }) =>
          run({
            reader,
            commitChanges,
            readCurrent: (read) =>
              readCurrent((current) =>
                read({ readAttachmentBindingTarget: current.readAttachmentBindingTarget }),
              ),
          }),
        options,
      );
    const request = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      messageUid: "m1",
      commandId: "bind",
      expectedAggregateVersion: 0,
      attachments: [
        {
          attachmentId: "a1",
          sessionId: "s1",
          attachmentSource: "user",
          name: "one.txt",
          mimeType: "text/plain",
        },
      ],
    };
    const bind = (changes = {}) =>
      runtime.sessionMessageService.bindTurnAttachments({ ...request, ...changes });
    await assert.rejects(bind({ expectedAggregateVersion: 9 }), {
      code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
    });
    await assert.rejects(bind({ turnScopeId: "other" }), { statusCode: 404 });
    const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    setFsAdapter({
      rename: async (from, target) => {
        if (target === path.join(scope.sessionDir, "head.json"))
          throw Object.assign(new Error("binding fault"), { code: "EIO" });
        return rename(from, target);
      },
    });
    try {
      await assert.rejects(bind(), { code: "SESSION_COMMIT_UNCERTAIN" });
    } finally {
      resetFsAdapter();
    }
    const failed = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.equal(failed.generation, pinned.generation);
    assert.deepEqual((await failed.readMessage("m1")).message.attachments, []);
    const { result: first, work: firstIo } = await observeStorageIo(scope.sessionDir, bind);
    assert.equal(first.aggregateVersion, 1);
    assert.equal(first.deduplicated, false);
    assert.equal(first.messageUid, "m1");
    assert.deepEqual(first.attachments, request.attachments);
    assert.deepEqual((await pinned.readMessage("m1")).message.attachments, []);
    const committed = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    const { result: replay, work: replayIo } = await observeStorageIo(scope.sessionDir, () =>
      bind({ attachments: [{ ...request.attachments[0], name: "retry.txt" }] }),
    );
    assert.deepEqual(replay, {
      ...first,
      deduplicated: true,
    });
    for (const { readBytes } of [firstIo, replayIo])
      assert.ok(readBytes > 0 && readBytes < 128 * 1024, `attachment binding read ${readBytes} B`);
    t.diagnostic(
      `Attachment binding read bytes: first=${firstIo.readBytes}, replay=${replayIo.readBytes}`,
    );
    assert.equal(
      (await repository.requireSessionReader("u1", "s1", { persistenceContext })).generation,
      committed.generation,
    );
    await assert.rejects(
      bind({ attachments: [{ ...request.attachments[0], attachmentId: "a2" }] }),
      {
        code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
      },
    );
    await assert.rejects(bind({ commandId: "another", expectedAggregateVersion: 1 }), {
      code: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
    });
  });
}
