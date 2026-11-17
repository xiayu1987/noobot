/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pruneOrphanScopedAttachments } from "../../src/artifacts/service/attachment-service-cleanup.js";
import { attachScopedRoot } from "../../src/artifacts/service/attachment-storage-layout.js";

for (const preserveOtherSource of [false, true]) {
  test(`source cleanup removes selected attachments and preserves remaining sources: ${preserveOtherSource}`, async (t) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "attachment-cleanup-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const root = attachScopedRoot(path.join(workspaceRoot, "user"));
    const orphan = path.join(root, "orphan");
    const retained = path.join(root, "retained", "user");
    await mkdir(path.join(orphan, "user"), { recursive: true });
    await mkdir(retained, { recursive: true });
    await writeFile(path.join(orphan, "user", "selected.txt"), "selected");
    await writeFile(path.join(retained, "keep.txt"), "kept");
    if (preserveOtherSource) {
      await mkdir(path.join(orphan, "tool"));
      await writeFile(path.join(orphan, "tool", "other.txt"), "other");
    }
    const request = { userId: "user", keepSessionIds: ["retained"], attachmentSources: ["user"] };
    const service = { globalConfig: { workspaceRoot } };
    assert.deepEqual(await pruneOrphanScopedAttachments(service, request), {
      deletedSessionIds: ["orphan"],
      deletedCount: 1,
    });
    await assert.rejects(readdir(path.join(orphan, "user")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(retained, "keep.txt"), "utf8"), "kept");
    if (preserveOtherSource)
      assert.equal(await readFile(path.join(orphan, "tool", "other.txt"), "utf8"), "other");
    else await assert.rejects(readdir(orphan), { code: "ENOENT" });
    assert.deepEqual(await pruneOrphanScopedAttachments(service, request), {
      deletedSessionIds: [],
      deletedCount: 0,
    });
  });
}
