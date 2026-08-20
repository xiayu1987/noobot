/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";

import { AttachmentService } from "../../src/artifacts/service/attachment-service.js";
import { resolveCanonicalSourceAttachment } from "../../src/artifacts/source-attachment-resolver.js";
import { BUILTIN_ATTACHMENT_POLICY } from "../../src/config/index.js";
import { readAttachIndex, writeAttachIndex } from "../../src/artifacts/index-manager.js";
import {
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
  validateAttachmentPolicy,
} from "../../src/artifacts/policy/policy-validator.js";
import {
  getMimeTypeFromExtension,
  isValidMimeType,
} from "../../src/artifacts/policy/mime-utils.js";
import {
  readSessionArtifact,
  writeSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION } from "../../src/session/session-summary-builders.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

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
      sessionId: "s1",
      attachmentSource: "user",
    });

    assert.ok(loaded);
    assert.equal(loaded.attachmentId, saved[0].attachmentId);
    assert.equal(loaded.size, Buffer.from("hello-attach", "utf8").length);
    assert.ok(
      String(loaded.absolutePath).includes(path.join("runtime", "attach", "scoped", "s1", "user")),
    );
  });
});

test("AttachmentService.ingest accepts arbitrary and extensionless user files", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const contentBase64 = Buffer.from("opaque-content", "utf8").toString("base64");

    const saved = await service.ingest({
      userId: "u1",
      sessionId: "arbitrary-files",
      attachmentSource: "user",
      attachments: [
        {
          name: "release.zip",
          mimeType: "application/zip",
          contentBase64,
        },
        {
          name: "payload.custombin",
          mimeType: "application/x-custom-binary",
          contentBase64,
        },
        {
          name: "extensionless",
          mimeType: "application/octet-stream",
          contentBase64,
        },
      ],
    });

    assert.deepEqual(
      saved.map((item) => [item.name, item.mimeType]),
      [
        ["release.zip", "application/zip"],
        ["payload.custombin", "application/x-custom-binary"],
        ["extensionless", "application/octet-stream"],
      ],
    );
    await Promise.all(saved.map((item) => stat(item.path)));
  });
});

test("attachment storage encodes logical scope identities before filesystem projection", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const sessionId = "session/../../outside";
    const [saved] = await service.ingest({
      userId: "u1",
      sessionId,
      attachmentSource: "user",
      attachments: [
        {
          name: "safe.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("safe", "utf8").toString("base64"),
        },
      ],
    });

    const loaded = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId,
      attachmentSource: "user",
    });

    assert.ok(loaded);
    assert.equal(loaded.sessionId, sessionId);
    assert.equal(loaded.relativePath.includes(encodeURIComponent(sessionId)), true);
    assert.equal(loaded.absolutePath.startsWith(path.join(workspaceRoot, "u1")), true);
  });
});

test("attachment index rejects storage references outside their declared scope", async () => {
  await withTempDir(async (workspaceRoot) => {
    const basePath = path.join(workspaceRoot, "u1");
    const scope = { sessionId: "s1", attachmentSource: "user" };

    await assert.rejects(
      writeAttachIndex(
        basePath,
        {
          attachments: {
            a1: {
              attachmentId: "a1",
              sessionId: scope.sessionId,
              attachmentSource: scope.attachmentSource,
              name: "secret.txt",
              mimeType: "text/plain",
              relativePath: "../secret.txt",
            },
          },
        },
        scope,
      ),
      /attachment_storage_ref_scope_mismatch/,
    );
  });
});

test("attachment query rejects symbolic links that escape the canonical scope", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [saved] = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          name: "linked.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("original", "utf8").toString("base64"),
        },
      ],
    });
    const original = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId: "s1",
      attachmentSource: "user",
    });
    const outsidePath = path.join(workspaceRoot, "outside-secret.txt");
    await writeFile(outsidePath, "outside", "utf8");
    await rm(original.absolutePath);
    await symlink(outsidePath, original.absolutePath);

    const escaped = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId: "s1",
      attachmentSource: "user",
    });
    assert.equal(escaped, null);
  });
});

test("attachment stream keeps execution paths inside the attachment service", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [saved] = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          name: "stream.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("streamed", "utf8").toString("base64"),
        },
      ],
    });

    const opened = await service.openAttachmentStream({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId: "s1",
      attachmentSource: "user",
    });
    assert.ok(opened?.stream);
    assert.equal(opened.absolutePath, undefined);
    assert.equal(opened.path, undefined);
    assert.equal(opened.relativePath, undefined);
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), "streamed");
  });
});

test("AttachmentService concurrent model artifact writes preserve one canonical index", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const batches = Array.from({ length: 8 }, (_, batch) =>
      service.ingestGeneratedArtifacts({
        userId: "u1",
        sessionId: "concurrent-session",
        attachmentSource: "model",
        artifacts: [
          {
            name: `result-${batch}.txt`,
            mimeType: "text/plain",
            contentBase64: Buffer.from(`result-${batch}`, "utf8").toString("base64"),
          },
        ],
      }),
    );
    const saved = (await Promise.all(batches)).flat();
    assert.equal(saved.length, 8);
    const index = await readAttachIndex(path.join(workspaceRoot, "u1"), {
      sessionId: "concurrent-session",
      attachmentSource: "model",
    });
    assert.equal(Object.keys(index.attachments).length, 8);
    for (const record of saved) {
      assert.ok(index.attachments[record.attachmentId]);
    }
  });
});

test("AttachmentService.resolveSourceAttachment requires the complete scoped identity", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [source] = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          clientAttachmentId: "client-source",
          name: "same-name.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("source", "utf8").toString("base64"),
        },
      ],
    });
    const [otherSource] = await service.ingest({
      userId: "u1",
      sessionId: "s2",
      attachmentSource: "user",
      attachments: [
        {
          name: "same-name.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("other session", "utf8").toString("base64"),
        },
      ],
    });
    const [sameSessionOtherSource] = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          name: "other.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("same session other", "utf8").toString("base64"),
        },
      ],
    });

    const byId = await service.resolveSourceAttachment({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachmentId: source.attachmentId,
    });
    const wrongSession = await service.resolveSourceAttachment({
      userId: "u1",
      sessionId: "s2",
      attachmentSource: "user",
      attachmentId: source.attachmentId,
    });
    const wrongSource = await service.resolveSourceAttachment({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "model",
      attachmentId: source.attachmentId,
    });
    const missingId = await service.resolveSourceAttachment({
      userId: "u1",
      sessionId: "s1",
      attachmentId: "",
    });

    assert.equal(byId?.attachmentId, source.attachmentId);
    assert.equal(wrongSession, null);
    assert.equal(wrongSource, null);
    assert.equal(missingId, null);
    assert.notEqual(otherSource.attachmentId, source.attachmentId);
  });
});

test("resolveCanonicalSourceAttachment resolves an exact attachment identity", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [source] = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentBase64: Buffer.from("source", "utf8").toString("base64"),
        },
      ],
    });
    const runtime = {
      userId: "u1",
      basePath: workspaceRoot,
      attachmentService: service,
      userMessageAttachments: [],
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
      userConfig: {},
      systemRuntime: {
        sessionId: "s1",
        config: {},
      },
    };
    const agentContext = createTestAgentExecutionScope(runtime, {
      identity: { userId: "u1", sessionId: "s1" },
      environment: { workspace: { basePath: workspaceRoot } },
    });

    const resolved = await resolveCanonicalSourceAttachment({
      attachmentIdentity: {
        attachmentId: source.attachmentId,
        sessionId: "s1",
        attachmentSource: "user",
      },
      agentContext,
    });

    assert.equal(resolved?.attachmentId, source.attachmentId);
  });
});

test("AttachmentService.ingest is idempotent by clientAttachmentId", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const basePayload = {
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        {
          clientAttachmentId: "client-1",
          name: "note.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("same", "utf8").toString("base64"),
        },
      ],
    };

    const first = await service.ingest(basePayload);
    const replay = await service.ingest(basePayload);
    assert.equal(replay[0].attachmentId, first[0].attachmentId);
    assert.equal(replay[0].clientAttachmentId, "client-1");

    await assert.rejects(
      service.ingest({
        ...basePayload,
        attachments: [
          {
            ...basePayload.attachments[0],
            contentBase64: Buffer.from("different", "utf8").toString("base64"),
          },
        ],
      }),
      (error) => error?.code === "CLIENT_ATTACHMENT_ID_CONFLICT",
    );
  });
});

test("AttachmentService links parsed results to one attachment identity only", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const contentBase64 = Buffer.from("same document", "utf8").toString("base64");
    const saved = await service.ingest({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachments: [
        { clientAttachmentId: "client-a", name: "a.txt", mimeType: "text/plain", contentBase64 },
        { clientAttachmentId: "client-b", name: "b.txt", mimeType: "text/plain", contentBase64 },
      ],
    });
    const [parsed] = await service.ingestGeneratedArtifacts({
      userId: "u1",
      sessionId: "s1",
      artifacts: [
        {
          name: "parsed.md",
          mimeType: "text/markdown",
          contentBase64: Buffer.from("parsed", "utf8").toString("base64"),
        },
      ],
    });

    await service.linkParsedResultToAttachment({
      userId: "u1",
      sourceIdentity: {
        attachmentId: saved[0].attachmentId,
        sessionId: "s1",
        attachmentSource: "user",
      },
      targetAttachment: parsed,
      producerId: "multimodal_parse",
    });

    const otherAttachment = await service.getAttachmentById({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachmentId: saved[1].attachmentId,
    });
    const linkedAttachment = await service.getAttachmentById({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "user",
      attachmentId: saved[0].attachmentId,
    });
    assert.equal(linkedAttachment.relations.length, 1);
    assert.deepEqual(linkedAttachment.relations[0].sourceIdentity, {
      attachmentId: saved[0].attachmentId,
      sessionId: "s1",
      attachmentSource: "user",
    });
    assert.deepEqual(linkedAttachment.relations[0].targetIdentity, {
      attachmentId: parsed.attachmentId,
      sessionId: parsed.sessionId,
      attachmentSource: parsed.attachmentSource,
    });
    assert.deepEqual(otherAttachment.relations, []);
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
      sessionId: "s1",
      attachmentSource: "model",
    });
    assert.equal(loaded.owner?.type, "plugin");
    assert.equal(loaded.owner?.id, "harness-plugin");
  });
});

test("AttachmentService persists zero-byte generated artifacts as canonical attachments", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    const [saved] = await service.ingestGeneratedArtifacts({
      userId: "u1",
      sessionId: "s1",
      attachmentSource: "model",
      generationSource: "execute_native_script",
      artifacts: [{ name: "empty.bin", mimeType: "application/octet-stream", contentBase64: "" }],
    });

    assert.equal(saved.name, "empty.bin");
    assert.equal(saved.size, 0);
    const loaded = await service.getAttachmentById({
      userId: "u1",
      attachmentId: saved.attachmentId,
      sessionId: "s1",
      attachmentSource: "model",
    });
    assert.equal(loaded.name, "empty.bin");
    assert.equal(loaded.size, 0);
    assert.equal((await stat(loaded.absolutePath)).size, 0);
  });
});

test("AttachmentService rejects a malformed generated batch before persisting any item", async () => {
  await withTempDir(async (workspaceRoot) => {
    const service = new AttachmentService({ workspaceRoot });
    await assert.rejects(
      service.ingestGeneratedArtifacts({
        userId: "u1",
        sessionId: "atomic-session",
        attachmentSource: "model",
        artifacts: [
          { name: "valid.txt", mimeType: "text/plain", contentBase64: "dmFsaWQ=" },
          { name: "invalid.txt", mimeType: "text/plain" },
        ],
      }),
      /artifacts\[1\]\.contentBase64 must be a string/,
    );
    const index = await readAttachIndex(path.join(workspaceRoot, "u1"), {
      sessionId: "atomic-session",
      attachmentSource: "model",
    });
    assert.equal(Object.keys(index.attachments).length, 0);
  });
});

test("AttachmentService.linkParsedResultToAttachment updates only the attachment store relation", async () => {
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
      attachments: [
        {
          name: "raw.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentBase64: sourceContent,
        },
      ],
    });
    const [parsedAttachment] = await service.ingestGeneratedArtifacts({
      userId,
      sessionId: "node_child_s1",
      attachmentSource: "model",
      artifacts: [{ name: "raw.md", mimeType: "text/markdown", contentBase64: parsedContent }],
    });

    const basePath = path.join(workspaceRoot, userId);
    const runtimeSessionFile = path.join(
      basePath,
      "runtime/session",
      rootSessionId,
      "session.json",
    );
    const runtimeSummaryFile = path.join(
      basePath,
      "runtime/session",
      rootSessionId,
      "session-summary.json",
    );
    const pluginSessionFile = path.join(
      basePath,
      "runtime/plugin/session",
      rootSessionId,
      pluginDialogId,
      "session.json",
    );
    const pluginSummaryFile = path.join(
      basePath,
      "runtime/plugin/session",
      rootSessionId,
      pluginDialogId,
      "session-summary.json",
    );
    const snapshotPayload = {
      sessionId: rootSessionId,
      messages: [
        {
          messageUid: "sm_attachment_source",
          role: "user",
          content: "test",
          dialogProcessId: "dialog-attachment-source",
          turnScopeId: "turn-attachment-source",
          attachments: [
            {
              ...sourceAttachment,
            },
          ],
        },
      ],
    };
    await writeSessionArtifact({
      sessionDir: path.dirname(runtimeSessionFile),
      sessionPayload: snapshotPayload,
    });
    await writeFile(
      runtimeSummaryFile,
      `${JSON.stringify({ schemaVersion: 5, sessionId: rootSessionId, depth: 2, messages: [] }, null, 2)}\n`,
      "utf8",
    );
    await writeSessionArtifact({
      sessionDir: path.dirname(pluginSessionFile),
      sessionPayload: snapshotPayload,
    });
    await writeFile(
      pluginSummaryFile,
      `${JSON.stringify({ schemaVersion: 5, sessionId: rootSessionId, depth: 3, messages: [] }, null, 2)}\n`,
      "utf8",
    );

    const linked = await service.linkParsedResultToAttachment({
      userId,
      sourceIdentity: {
        attachmentId: sourceAttachment.attachmentId,
        sessionId: rootSessionId,
        attachmentSource: "user",
      },
      targetAttachment: parsedAttachment,
      producerId: "multimodal_parse",
    });

    assert.ok(linked);
    assert.equal(linked.relations.length, 1);
    assert.deepEqual(linked.relations[0].sourceIdentity, {
      attachmentId: sourceAttachment.attachmentId,
      sessionId: rootSessionId,
      attachmentSource: "user",
    });
    assert.deepEqual(linked.relations[0].targetIdentity, {
      attachmentId: parsedAttachment.attachmentId,
      sessionId: parsedAttachment.sessionId,
      attachmentSource: parsedAttachment.attachmentSource,
    });

    const runtimeSnapshot = await readSessionArtifact({
      sessionDir: path.dirname(runtimeSessionFile),
    });
    const pluginSnapshot = await readSessionArtifact({
      sessionDir: path.dirname(pluginSessionFile),
    });
    assert.equal(runtimeSnapshot.messages[0].attachments[0].parsedResult, undefined);
    assert.equal(pluginSnapshot.messages[0].attachments[0].parsedResult, undefined);
    const stored = await service.getAttachmentById({
      userId,
      attachmentId: sourceAttachment.attachmentId,
      sessionId: rootSessionId,
      attachmentSource: "user",
    });
    assert.deepEqual(stored.relations, linked.relations);
  });
});

test("index-manager persists only versioned protocol records and isolates every attachment scope", async () => {
  await withTempDir(async (workspaceRoot) => {
    const basePath = path.join(workspaceRoot, "u1");
    const scope = { sessionId: "s1", attachmentSource: "user" };

    const empty = await readAttachIndex(basePath, scope);
    assert.deepEqual(empty.attachments, {});

    await assert.rejects(
      writeAttachIndex(
        basePath,
        { attachments: { a1: { attachmentId: "a1", name: "x.txt" } } },
        scope,
      ),
      /invalid_persisted_attachment_record/,
    );

    await writeAttachIndex(
      basePath,
      {
        attachments: {
          a2: {
            attachmentId: "a2",
            sessionId: "s1",
            attachmentSource: "user",
            name: "x.txt",
            mimeType: "text/plain",
            relativePath: "runtime/attach/scoped/s1/user/a2/x.txt",
            sandboxPath: "/workspace/sandbox/runtime/attach/scoped/s1/user/a2/x.txt",
            previewUrl: "/preview/a2",
          },
        },
      },
      scope,
    );
    const canonicalLoaded = await readAttachIndex(basePath, scope);
    assert.equal(canonicalLoaded.attachments.a2?.name, "x.txt");
    assert.equal(canonicalLoaded.attachments.a2?.sandboxPath, undefined);
    assert.equal(canonicalLoaded.attachments.a2?.previewUrl, undefined);

    const otherScope = { sessionId: "s2", attachmentSource: "user" };
    await writeAttachIndex(
      basePath,
      {
        attachments: {
          a2: {
            attachmentId: "a2",
            sessionId: "s2",
            attachmentSource: "user",
            name: "other.txt",
            mimeType: "text/plain",
            relativePath: "runtime/attach/scoped/s2/user/a2/other.txt",
          },
        },
      },
      otherScope,
    );
    const isolated = await readAttachIndex(basePath, otherScope);
    assert.equal(isolated.attachments.a2?.sessionId, "s2");
    assert.equal(isolated.attachments.a2?.attachmentSource, "user");
    assert.equal(isolated.attachments.a2?.name, "other.txt");

    const migratedIndexFile = path.join(basePath, "runtime/attach/scoped/s1/user/attachments.json");
    const migratedPayload = JSON.parse(await readFile(migratedIndexFile, "utf8"));
    assert.equal(migratedPayload.attachments.a2?.identity?.attachmentId, "a2");
    assert.equal(migratedPayload.attachments.a2?.identity?.sessionId, "s1");
    assert.equal(migratedPayload.attachments.a2?.identity?.attachmentSource, "user");
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
  assert.deepEqual(policy.allowedExtensions, []);
  assert.deepEqual(validateAttachmentPolicy(policy), policy);

  assert.equal(isMimeTypeAllowed("image/png", policy.allowedMimeTypes), true);
  assert.equal(isExtensionAllowed("a.png", policy.allowedExtensions), true);
  assert.equal(isExtensionAllowed("archive.unknown-format", policy.allowedExtensions), true);
  assert.equal(isExtensionAllowed("extensionless", policy.allowedExtensions), true);
  assert.equal(getMimeTypeFromExtension("photo.png"), "image/png");
  assert.equal(isValidMimeType("text/plain"), true);
});
