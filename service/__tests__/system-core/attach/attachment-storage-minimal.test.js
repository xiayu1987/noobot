import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { AttachmentService } from "../../../system-core/attach/service/attachment-service.js";
import {
  readAttachIndex,
  writeAttachIndex,
} from "../../../system-core/attach/index-manager.js";
import {
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
  validateAttachmentPolicy,
} from "../../../system-core/attach/policy/policy-validator.js";
import { getMimeTypeFromExtension, isValidMimeType } from "../../../system-core/attach/policy/mime-utils.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("AttachmentService.ingest + getAttachmentById keeps core behavior", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const content = Buffer.from("hello-attach", "utf8").toString("base64");

    const saved = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [{ name: "note.txt", mimeType: "text/plain", contentBase64: content }],
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, "note.txt");
    assert.equal(saved[0].sessionId, "s1");
    assert.equal(saved[0].attachmentSource, "user");

    const loaded = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved[0].attachmentId,
    });

    assert.ok(loaded);
    assert.equal(loaded.attachmentId, saved[0].attachmentId);
    assert.equal(loaded.size, Buffer.from("hello-attach", "utf8").length);
    assert.ok(String(loaded.absolutePath).includes(path.join("runtime", "attach", "scoped", "s1", "user")));
  });
});

test("index-manager read/write persists attachments", async () => {
  await withTempDir(async (workspaceRoot) => {
    const basePath = path.join(workspaceRoot, "u1");
    const scope = { sessionId: "s1", attachmentSource: "user" };

    const empty = await readAttachIndex(basePath, scope);
    assert.deepEqual(empty.attachments, {});

    await writeAttachIndex(
      basePath,
      {
        attachments: {
          a1: { attachmentId: "a1", name: "x.txt" },
        },
      },
      scope,
    );

    const loaded = await readAttachIndex(basePath, scope);
    assert.equal(loaded.attachments.a1?.name, "x.txt");
  });
});

test("policy + mime minimal compatibility", () => {
  const policy = resolveAttachmentPolicy({
    maxFileSizeBytes: "12.9",
    allowedMimeTypes: ["IMAGE/*", "text/plain"],
    allowedExtensions: ["PNG", ".txt"],
  });

  assert.equal(policy.maxFileSizeBytes, 12);
  assert.deepEqual(policy.allowedMimeTypes, ["image/*", "text/plain"]);
  assert.deepEqual(policy.allowedExtensions, [".png", ".txt"]);
  assert.deepEqual(validateAttachmentPolicy(policy), policy);

  assert.equal(isMimeTypeAllowed("image/png", policy.allowedMimeTypes), true);
  assert.equal(isExtensionAllowed("a.png", policy.allowedExtensions), true);
  assert.equal(getMimeTypeFromExtension("photo.png"), "image/png");
  assert.equal(isValidMimeType("text/plain"), true);
});
