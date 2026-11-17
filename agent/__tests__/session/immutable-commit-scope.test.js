/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { IMMUTABLE_READER_RETENTION } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableSessionMethods } from "../../src/session/repositories/file-system-session-repository/immutable-methods.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-commit-scope-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "scope", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: "scope", parentSessionId: "parent" },
      },
    ],
  });
  const repository = {
    withSessionMutation: (_userId, _sessionId, run) =>
      run({ sessionDir, resolvedParentSessionId: "parent" }),
  };
  const request = {
    expectedGeneration: 1,
    operationId: "invalid-delta",
    committedAt: "2026-01-01T00:00:00.000Z",
    changes: { unsupported: [] },
  };
  return { store, sessionDir, repository, request };
}

test("locked commit identity validation performs no reader retention publication even for invalid deltas", async (t) => {
  const { store, sessionDir, repository, request } = await fixture(t);
  const retentionDirectory = path.join(sessionDir, IMMUTABLE_READER_RETENTION.directory);
  setFsAdapter({
    open: async (file, flags, ...args) => {
      assert.ok(
        !String(file).startsWith(retentionDirectory),
        "mutation identity validation must not create reader retention",
      );
      return open(file, flags, ...args);
    },
  });
  await assert.rejects(
    immutableSessionMethods.commitChanges.call(repository, "user", "scope", request),
    /Unsupported session change/,
  );
  assert.equal((await store.snapshot()).generation, 1);
});

test("locked commit rejects foreign parent identity before delta processing", async (t) => {
  const { store, sessionDir, repository, request } = await fixture(t);
  repository.withSessionMutation = (_userId, _sessionId, run) =>
    run({ sessionDir, resolvedParentSessionId: "foreign" });
  await assert.rejects(
    immutableSessionMethods.commitChanges.call(repository, "user", "scope", request),
    { code: SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT },
  );
  assert.equal((await store.snapshot()).generation, 1);
});

test(
  "commit entry acquires the storage lock before identity reads",
  { timeout: 5000 },
  async (t) => {
    const { store, repository, request } = await fixture(t);
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    t.after(() => resume.resolve());
    let paused = false;
    setFsAdapter({
      open: async (file, flags, ...args) => {
        if (
          !paused &&
          flags === "r" &&
          String(file).startsWith(store.objects.segments.directory + path.sep)
        ) {
          paused = true;
          entered.resolve();
          await resume.promise;
        }
        return open(file, flags, ...args);
      },
    });
    const committing = assert.rejects(
      immutableSessionMethods.commitChanges.call(repository, "user", "scope", request),
      /Unsupported session change/,
    );
    await entered.promise;
    let acquired = false;
    const competing = sessionMutationCoordinator.run(store.lockPath, () => {
      acquired = true;
    });
    await setImmediate();
    assert.equal(acquired, false, "storage lock must cover metadata identity validation");
    resume.resolve();
    await committing;
    await competing;
    assert.equal(acquired, true);
    assert.equal((await store.snapshot()).generation, 1);
  },
);
