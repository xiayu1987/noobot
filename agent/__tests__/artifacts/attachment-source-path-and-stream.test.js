/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm } from "node:fs/promises";

import { AttachmentService } from "../../src/artifacts/service/attachment-service.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ORIGIN = Object.freeze({ view: "host", path: "D:/work/report.xlsx" });

test("AttachmentService persists a canonical origin and reads it back", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [saved] = await service.ingestGeneratedArtifacts({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "model",
      generationSource: "execute_script_output_file",
      artifacts: [
        {
          name: "report.xlsx",
          mimeType: "application/octet-stream",
          contentBase64: "cmVwb3J0",
          origin: ORIGIN,
        },
      ],
    });
    assert.deepEqual(saved.origin, ORIGIN);
    const loaded = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId: "s1",
      attachmentSource: "model",
    });
    assert.deepEqual(loaded.origin, ORIGIN);
  });
});

test("AttachmentService persists no origin field for artifacts without one", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [saved] = await service.ingestGeneratedArtifacts({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "model",
      artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" }],
    });
    assert.equal("origin" in saved, false);
  });
});

test("AttachmentService rejects a non-canonical origin instead of persisting it", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    await assert.rejects(
      service.ingestGeneratedArtifacts({
        userId: "u1",
        sessionId: "s1",
        attachmentSource: "model",
        artifacts: [
          {
            name: "report.xlsx",
            mimeType: "application/octet-stream",
            contentBase64: "cmVwb3J0",
            origin: { view: "host", path: "d:\\work\\report.xlsx" },
          },
        ],
      }),
      /invalid_attachment_origin/,
    );
  });
});

test(
  "openAttachmentStream surfaces storage I/O failures instead of reporting not found",
  { skip: process.getuid?.() === 0 },
  async () => {
    await withTempDir(async (workspaceRoot) => {
      const service = new AttachmentService({ workspaceRoot });
      const [saved] = await service.ingest({
        userId: "u1",
        sessionId: "s1",
        attachmentSource: "user",
        attachments: [
          {
            name: "locked.txt",
            mimeType: "text/plain",
            contentBase64: Buffer.from("locked", "utf8").toString("base64"),
          },
        ],
      });
      const identity = {
        userId: "u1",
        attachmentId: saved.attachmentId,
        sessionId: "s1",
        attachmentSource: "user",
      };
      const record = await service.getAttachmentById(identity);
      await chmod(record.absolutePath, 0o000);
      await assert.rejects(() => service.openAttachmentStream(identity), { code: "EACCES" });
    });
  },
);
