/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteScopedAttachmentsBySessionIds } from "../../src/artifacts/service/attachment-service-cleanup.js";
import { attachScopeRoot } from "../../src/artifacts/service/attachment-storage-layout.js";

test("cleanup uses the same session identity as attachment persistence", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "attachment-cleanup-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "user";
  const service = { globalConfig: { workspaceRoot } };
  const basePath = path.join(workspaceRoot, userId);
  const retainedId = "branch/a%";
  const deletedId = "branch/b%";
  const scopePath = (sessionId) =>
    attachScopeRoot(basePath, { sessionId, attachmentSource: "user" });
  await mkdir(scopePath(retainedId), { recursive: true });
  await mkdir(scopePath(deletedId), { recursive: true });
  assert.deepEqual(
    await deleteScopedAttachmentsBySessionIds(service, { userId, sessionIds: [deletedId] }),
    {
      deletedSessionIds: [deletedId],
      deletedCount: 1,
    },
  );
  await assert.rejects(readdir(scopePath(deletedId)), { code: "ENOENT" });
  await assert.rejects(
    deleteScopedAttachmentsBySessionIds(service, { userId, sessionIds: [retainedId, ".."] }),
    TypeError,
  );
  assert.deepEqual(await readdir(scopePath(retainedId)), []);
  assert.deepEqual(
    await deleteScopedAttachmentsBySessionIds(service, { userId, sessionIds: [retainedId] }),
    {
      deletedSessionIds: [retainedId],
      deletedCount: 1,
    },
  );
  await assert.rejects(readdir(scopePath(retainedId)), { code: "ENOENT" });
});
