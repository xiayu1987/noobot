/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

export function registerImmutableAttachmentRepositoryTests({ fixture, message, ts }) {
  test("attachment binding uses point reads, preserves replay and atomically rejects conflicting commands", async (t) => {
    const { runtime, repository, persistenceContext, scope } = await fixture(t);
    const before = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    await repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: before.generation,
      operationId: "seed-binding",
      committedAt: ts,
      changes: { messages: [message("m1")] },
    });
    await writeFile(scope.sessionFile, "invalid legacy manifest");
    repository.requireById = () => assert.fail("binding must not export the session");
    repository.save = () => assert.fail("binding must not save a whole session");
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
    const first = await bind();
    assert.equal(first.aggregateVersion, 1);
    assert.equal(first.deduplicated, false);
    assert.equal(first.userMessage.attachments[0].attachmentId, "a1");
    assert.deepEqual((await pinned.readMessage("m1")).message.attachments, []);
    const committed = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.equal((await bind()).deduplicated, true);
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
