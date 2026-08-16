/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  mapAttachmentRecordsToMetas,
  normalizeAttachmentMetas,
  normalizeAttachmentTurnScopeMeta,
  attachmentMatchKeys,
  findMatchingAttachmentMeta,
  projectCanonicalAttachmentIdentity,
} from "../../src/artifacts/meta-ops.js";

test("projectCanonicalAttachmentIdentity delegates identity to the shared protocol", () => {
  assert.deepEqual(
    projectCanonicalAttachmentIdentity(
      {
        attachmentId: "att_1",
        sessionId: "s1",
        attachmentSource: "user",
        path: "/runtime/att_1.txt",
        contentSha256: "sha_1",
        name: "display.txt",
        downloadUrl: "/api/attachments/att_1",
        previewUrl: "",
        relations: [],
      },
      "s1",
    ),
    {
      attachmentId: "att_1",
      sessionId: "s1",
      attachmentSource: "user",
    },
  );
});

test("projectCanonicalAttachmentIdentity ignores access fields but rejects incomplete ownership", () => {
  assert.deepEqual(
    projectCanonicalAttachmentIdentity(
      {
        attachmentId: "att_1",
        sessionId: "s1",
        attachmentSource: "user",
        path: "/runtime/att_1.txt",
        relativePath: "runtime/att_1.txt",
      },
      "s1",
    ),
    {
      attachmentId: "att_1",
      sessionId: "s1",
      attachmentSource: "user",
    },
  );

  for (const attachment of [
    { id: "att_1", sessionId: "s1", attachmentSource: "user", path: "/runtime/att_1.txt" },
    { attachmentId: "att_1", attachmentSource: "user", path: "/runtime/att_1.txt" },
    {
      attachmentId: "att_1",
      sessionId: "s2",
      attachmentSource: "user",
      path: "/runtime/att_1.txt",
    },
    { attachmentId: "att_1", sessionId: "s1", path: "/runtime/att_1.txt" },
  ]) {
    assert.throws(
      () => projectCanonicalAttachmentIdentity(attachment, "s1"),
      (error) => error?.errorCode === "INVALID_CANONICAL_ATTACHMENT",
    );
  }
});

test("attachment matching uses only the shared three-field identity", () => {
  const canonical = {
    attachmentId: "att_1",
    sessionId: "s1",
    attachmentSource: "user",
    name: "same.txt",
    mimeType: "text/plain",
    path: "/one/same.txt",
  };
  const sameIdentity = { ...canonical, name: "renamed.txt", path: "/two/renamed.txt" };
  const differentIdentity = { ...canonical, attachmentId: "att_2" };

  assert.deepEqual(attachmentMatchKeys(canonical), [JSON.stringify(["s1", "user", "att_1"])]);
  assert.equal(
    findMatchingAttachmentMeta(canonical, [differentIdentity, sameIdentity]),
    sameIdentity,
  );
  assert.equal(
    findMatchingAttachmentMeta({ ...canonical, path: "/other/same.txt" }, [sameIdentity]),
    sameIdentity,
  );
  assert.equal(
    findMatchingAttachmentMeta({ attachmentId: "att_1", name: "same.txt" }, [canonical]),
    null,
  );
});

test("normalizeAttachmentMetas accepts only canonical attachment fields", () => {
  const [meta] = normalizeAttachmentMetas([
    {
      attachmentId: "att_1",
      clientAttachmentId: "client_1",
      contentSha256: "sha_1",
      sessionId: "session_1",
      attachmentSource: "user",
      name: "canonical.txt",
      mimeType: "text/plain",
      size: 25,
      path: "/tmp/canonical.txt",
      relativePath: "runtime/canonical.txt",
      sandboxPath: "/workspace/canonical.txt",
      isSandbox: true,
      generationSource: "semantic_transfer_tool_output",
    },
  ]);

  assert.deepEqual(meta, {
    attachmentId: "att_1",
    clientAttachmentId: "client_1",
    contentSha256: "sha_1",
    sessionId: "session_1",
    attachmentSource: "user",
    name: "canonical.txt",
    mimeType: "text/plain",
    size: 25,
    path: "/tmp/canonical.txt",
    relativePath: "runtime/canonical.txt",
    sandboxPath: "/workspace/canonical.txt",
    isSandbox: true,
    generationSource: "semantic_transfer_tool_output",
  });
  assert.throws(
    () =>
      normalizeAttachmentMetas([
        { id: "att_legacy", sessionId: "session_1", attachmentSource: "user" },
      ]),
    (error) => error?.errorCode === "INVALID_CANONICAL_ATTACHMENT",
  );
});

test("nested attachment metadata normalizers preserve only canonical fields", () => {
  const turnScope = normalizeAttachmentTurnScopeMeta({
    turnScope: {
      turnScopeId: "turn_1",
      sessionId: "s1",
      dialogProcessId: "dialog_1",
    },
  });
  assert.deepEqual(turnScope, {
    turnScopeId: "turn_1",
    dialogProcessId: "dialog_1",
    sessionId: "s1",
  });
});

test("mapAttachmentRecordsToMetas projects canonical runtime records without inferring facts", () => {
  const [meta] = mapAttachmentRecordsToMetas([
    {
      attachmentId: "att_1",
      sessionId: "s1",
      attachmentSource: "model",
      clientAttachmentId: "client_1",
      name: "result.md",
      mimeType: "text/markdown",
      path: "/tmp/result.md",
      relativePath: "runtime/result.md",
      sandboxPath: "/workspace/result.md",
      isSandbox: false,
      generationSource: "semantic_transfer_tool_output",
      relations: [
        {
          relationType: "parsed_result",
          sourceIdentity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" },
          targetIdentity: { attachmentId: "parsed_1", sessionId: "s1", attachmentSource: "parsed" },
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      ],
      turnScope: {
        dialogProcessId: "dialog_1",
      },
    },
  ]);

  assert.equal(meta.attachmentId, "att_1");
  assert.equal(meta.clientAttachmentId, "client_1");
  assert.equal(meta.name, "result.md");
  assert.equal(meta.mimeType, "text/markdown");
  assert.equal(meta.path, "/tmp/result.md");
  assert.equal(meta.relativePath, "runtime/result.md");
  assert.equal(meta.sandboxPath, "/workspace/result.md");
  assert.equal(meta.isSandbox, false);
  assert.equal(meta.generationSource, "semantic_transfer_tool_output");
  assert.deepEqual(meta.relations, [
    {
      relationType: "parsed_result",
      sourceIdentity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" },
      targetIdentity: { attachmentId: "parsed_1", sessionId: "s1", attachmentSource: "parsed" },
      createdAt: "2026-07-11T00:00:00.000Z",
    },
  ]);
  assert.equal(meta.turnScope?.dialogProcessId, "dialog_1");
});
