import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { AttachmentService } from "../../../src/system-core/attach/service/attachment-service.js";
import { BUILTIN_ATTACHMENT_POLICY } from "../../../src/system-core/config/index.js";
import {
  readAttachIndex,
  writeAttachIndex,
} from "../../../src/system-core/attach/index-manager.js";
import {
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
  validateAttachmentPolicy,
} from "../../../src/system-core/attach/policy/policy-validator.js";
import { getMimeTypeFromExtension, isValidMimeType } from "../../../src/system-core/attach/policy/mime-utils.js";

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

test("AttachmentService.ingestGeneratedArtifacts preserves attachment owner metadata", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const content = Buffer.from("plugin artifact", "utf8").toString("base64");

    const saved = await service.ingestGeneratedArtifacts({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "model",
      generationSource: "harness_checklist",
      owner: { type: "plugin", id: "harness-plugin" },
      artifacts: [{ name: "checklist.txt", mimeType: "text/plain", contentBase64: content }],
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].owner?.type, "plugin");
    assert.equal(saved[0].owner?.id, "harness-plugin");

    const loaded = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved[0].attachmentId,
    });
    assert.equal(loaded.owner?.type, "plugin");
    assert.equal(loaded.owner?.id, "harness-plugin");
  });
});

test("AttachmentService.linkParsedResultToAttachment syncs runtime and plugin snapshots", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const userId = "u1";
    const rootSessionId = "root_s1";
    const pluginDialogId = "wf_d1";
    const sourceContent = Buffer.from("source-attach", "utf8").toString("base64");
    const parsedContent = Buffer.from("# parsed", "utf8").toString("base64");

    const [sourceAttachment] = await service.ingest({
      userId,
      sessionId: rootSessionId,
      attachmentSource: "user",
      attachments: [{ name: "raw.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentBase64: sourceContent }],
    });
    const [parsedAttachment] = await service.ingestGeneratedArtifacts({
      userId,
      sessionId: "node_child_s1",
      attachmentSource: "model",
      artifacts: [{ name: "raw.md", mimeType: "text/markdown", contentBase64: parsedContent }],
    });

    const basePath = path.join(workspaceRoot, userId);
    const runtimeSessionFile = path.join(basePath, "runtime/session", rootSessionId, "session.json");
    const pluginSessionFile = path.join(
      basePath,
      "runtime/plugin/session",
      rootSessionId,
      pluginDialogId,
      "session.json",
    );
    const snapshotPayload = {
      sessionId: rootSessionId,
      messages: [
        {
          role: "user",
          content: "test",
          attachmentMetas: [
            {
              attachmentId: sourceAttachment.attachmentId,
              path: sourceAttachment.path,
              relativePath: sourceAttachment.relativePath,
              sessionId: sourceAttachment.sessionId,
              attachmentSource: sourceAttachment.attachmentSource,
            },
          ],
          attachments: [
            {
              attachmentId: sourceAttachment.attachmentId,
              path: sourceAttachment.path,
              relativePath: sourceAttachment.relativePath,
              sessionId: sourceAttachment.sessionId,
              attachmentSource: sourceAttachment.attachmentSource,
            },
          ],
        },
      ],
    };
    await mkdir(path.dirname(runtimeSessionFile), { recursive: true });
    await writeFile(runtimeSessionFile, `${JSON.stringify(snapshotPayload, null, 2)}\n`, "utf8");
    await mkdir(path.dirname(pluginSessionFile), { recursive: true });
    await writeFile(pluginSessionFile, `${JSON.stringify(snapshotPayload, null, 2)}\n`, "utf8");

    const linked = await service.linkParsedResultToAttachment({
      userId,
      sourceAttachmentId: sourceAttachment.attachmentId,
      parsedAttachmentMeta: parsedAttachment,
      toolName: "doc_to_data",
      sourceSessionId: rootSessionId,
      sourceAttachmentSource: "user",
      sourceAttachmentPath: sourceAttachment.path,
    });

    assert.ok(linked);
    assert.equal(linked.parsedResult?.attachmentId, parsedAttachment.attachmentId);

    const runtimeSnapshot = JSON.parse(await readFile(runtimeSessionFile, "utf8"));
    const pluginSnapshot = JSON.parse(await readFile(pluginSessionFile, "utf8"));
    const runtimeAttachment = runtimeSnapshot?.messages?.[0]?.attachments?.[0] || {};
    const pluginAttachment = pluginSnapshot?.messages?.[0]?.attachments?.[0] || {};
    assert.equal(runtimeAttachment.parsedResult?.attachmentId, parsedAttachment.attachmentId);
    assert.equal(pluginAttachment.parsedResult?.attachmentId, parsedAttachment.attachmentId);
    assert.equal(runtimeAttachment.parsedResult?.tool, "doc_to_data");
    assert.equal(pluginAttachment.parsedResult?.tool, "doc_to_data");
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

  assert.equal(policy.maxFileSizeBytes, BUILTIN_ATTACHMENT_POLICY.maxFileSizeBytes);
  assert.deepEqual(policy.allowedMimeTypes, BUILTIN_ATTACHMENT_POLICY.allowedMimeTypes);
  assert.equal(policy.allowedExtensions.includes(".png"), true);
  assert.equal(policy.allowedExtensions.includes(".txt"), true);
  assert.deepEqual(validateAttachmentPolicy(policy), policy);

  assert.equal(isMimeTypeAllowed("image/png", policy.allowedMimeTypes), true);
  assert.equal(isExtensionAllowed("a.png", policy.allowedExtensions), true);
  assert.equal(getMimeTypeFromExtension("photo.png"), "image/png");
  assert.equal(isValidMimeType("text/plain"), true);
});
