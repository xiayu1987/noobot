/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { AttachmentService } from "../../src/artifacts/service/attachment-service.js";
import { DatabaseSync } from "node:sqlite";
import {
  listAttachmentRecords,
  publishAttachmentCatalog,
} from "../../src/artifacts/index-manager.js";
import { toPersistedAttachmentRecord } from "../../src/artifacts/service/persisted-record-adapter.js";
import { attachmentScopeIndexPath } from "../../src/artifacts/service/attachment-storage-layout.js";

async function writeFixtureRecords(basePath, { attachments }, scope) {
  const records = Object.values(attachments).map((record) =>
    toPersistedAttachmentRecord(basePath, record),
  );
  await publishAttachmentCatalog(basePath, scope, { records, migrationDigest: null });
}

async function readFixtureRecords(basePath, scope) {
  const records = await listAttachmentRecords(basePath, scope);
  return {
    attachments: Object.fromEntries(records.map((record) => [record.attachmentId, record])),
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("attachment index rejects storage references outside their declared scope", async () => {
  await withTempDir(async (workspaceRoot) => {
    const basePath = path.join(workspaceRoot, "u1");
    const scope = { sessionId: "s1", attachmentSource: "user" };

    await assert.rejects(
      writeFixtureRecords(
        basePath,
        {
          attachments: {
            a1: {
              attachmentId: "a1",
              sessionId: scope.sessionId,
              attachmentSource: scope.attachmentSource,
              name: "secret.txt",
              mimeType: "text/plain",
              path: path.join(basePath, "../secret.txt"),
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
        scope,
      ),
      /attachment_storage_ref_scope_mismatch/,
    );
  });
});

test("index-manager persists only versioned protocol records and isolates every attachment scope", async () => {
  await withTempDir(async (workspaceRoot) => {
    const basePath = path.join(workspaceRoot, "u1");
    const scope = { sessionId: "s1", attachmentSource: "user" };

    const empty = await readFixtureRecords(basePath, scope);
    assert.deepEqual(empty.attachments, {});

    await assert.rejects(
      writeFixtureRecords(
        basePath,
        { attachments: { a1: { attachmentId: "a1", name: "x.txt" } } },
        scope,
      ),
      /attachment_storage_ref_required/,
    );

    await writeFixtureRecords(
      basePath,
      {
        attachments: {
          a2: {
            attachmentId: "a2",
            sessionId: "s1",
            attachmentSource: "user",
            name: "x.txt",
            mimeType: "text/plain",
            path: path.join(basePath, "runtime/attach/scoped/s1/user/a2/x.txt"),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            relations: [],
            sandboxPath: "/workspace/sandbox/runtime/attach/scoped/s1/user/a2/x.txt",
            previewUrl: "/preview/a2",
          },
        },
      },
      scope,
    );
    const canonicalLoaded = await readFixtureRecords(basePath, scope);
    assert.equal(canonicalLoaded.attachments.a2?.name, "x.txt");
    assert.equal(canonicalLoaded.attachments.a2?.sandboxPath, undefined);
    assert.equal(canonicalLoaded.attachments.a2?.previewUrl, undefined);

    const otherScope = { sessionId: "s2", attachmentSource: "user" };
    await writeFixtureRecords(
      basePath,
      {
        attachments: {
          a2: {
            attachmentId: "a2",
            sessionId: "s2",
            attachmentSource: "user",
            name: "other.txt",
            relations: [],
            mimeType: "text/plain",
            path: path.join(basePath, "runtime/attach/scoped/s2/user/a2/other.txt"),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      otherScope,
    );
    const isolated = await readFixtureRecords(basePath, otherScope);
    assert.equal(isolated.attachments.a2?.sessionId, "s2");
    assert.equal(isolated.attachments.a2?.attachmentSource, "user");
    assert.equal(isolated.attachments.a2?.name, "other.txt");

    const database = new DatabaseSync(attachmentScopeIndexPath(basePath, scope), {
      readOnly: true,
    });
    try {
      const payload = JSON.parse(
        database.prepare("SELECT json FROM records WHERE attachmentId = ?").get("a2").json,
      );
      assert.deepEqual(payload.identity, { ...scope, attachmentId: "a2" });
    } finally {
      database.close();
    }
  });
});

test("attachment catalog reads selected metadata without decoding unrelated records", async () => {
  await withTempDir(async (workspaceRoot) => {
    const userId = "u1";
    const scope = { sessionId: "s1", attachmentSource: "model" };
    const service = new AttachmentService({ workspaceRoot });
    const records = await service.ingestGeneratedArtifacts({
      userId,
      ...scope,
      artifacts: Array.from({ length: 120 }, (_, index) => ({
        name: `a-${index}.txt`,
        contentBase64: "YQ==",
      })),
    });
    const [first, second] = records;
    const file = attachmentScopeIndexPath(path.join(workspaceRoot, userId), scope);
    const database = new DatabaseSync(file);
    try {
      const query = database.prepare(
        "EXPLAIN QUERY PLAN SELECT json FROM records WHERE attachmentId = ?",
      );
      assert.match(query.get(first.attachmentId).detail, /SEARCH records USING INDEX/);
      database
        .prepare("UPDATE records SET json = ? WHERE attachmentId = ?")
        .run("invalid record", second.attachmentId);
    } finally {
      database.close();
    }
    const identities = [
      { ...scope, attachmentId: first.attachmentId },
      { ...scope, attachmentId: "absent" },
      { ...scope, attachmentId: first.attachmentId },
    ];
    const selected = await service.readAttachmentMetadata({ userId, identities });
    assert.equal(selected[0].attachmentId, first.attachmentId);
    assert.equal(selected[1], null);
    assert.deepEqual(selected[2], selected[0]);
    await assert.rejects(
      service.readAttachmentMetadata({
        userId,
        identities: [{ ...scope, attachmentId: second.attachmentId }],
      }),
      { code: "ATTACHMENT_CATALOG_INVALID" },
    );
  });
});

test("published metadata and missing or truncated attachment bodies have distinct outcomes", async () => {
  await withTempDir(async (workspaceRoot) => {
    const userId = "u1";
    const scope = { sessionId: "s1", attachmentSource: "model" };
    const service = new AttachmentService({ workspaceRoot });
    const [record] = await service.ingestGeneratedArtifacts({
      userId,
      ...scope,
      artifacts: [{ name: "body.txt", contentBase64: "Ym9keQ==" }],
    });
    const identity = { ...scope, attachmentId: record.attachmentId };
    assert.equal(
      await service.openAttachmentStream({ userId, ...scope, attachmentId: "missing" }),
      null,
    );
    await writeFile(record.path, "b");
    await assert.rejects(service.openAttachmentStream({ userId, ...identity }), {
      code: "ATTACHMENT_BODY_UNAVAILABLE",
    });
    await rm(record.path);
    await assert.rejects(service.openAttachmentStream({ userId, ...identity }), {
      code: "ATTACHMENT_BODY_UNAVAILABLE",
    });
    assert.equal(
      (await service.readAttachmentMetadata({ userId, identities: [identity] }))[0].size,
      4,
    );
  });
});
