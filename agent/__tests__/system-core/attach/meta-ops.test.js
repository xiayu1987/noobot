/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransferPayloadFromAttachmentMetas,
  mapAttachmentRecordsToMetas,
  normalizeAttachmentMetas,
  normalizeAttachmentParsedResultMeta,
  normalizeAttachmentTurnScopeMeta,
} from "../../../src/system-core/attach/meta-ops.js";

test("normalizeAttachmentMetas accepts legacy aliases but emits canonical attachment fields", () => {
  const [meta] = normalizeAttachmentMetas([
    {
      id: "att_legacy",
      client_attachment_id: "client_legacy",
      content_sha256: "sha_legacy",
      session_id: "session_legacy",
      attachment_source: "user",
      fileName: "legacy.txt",
      type: "text/plain",
      bytes: "25",
      filePath: "/tmp/legacy.txt",
      relative_path: "runtime/legacy.txt",
      sandboxViewPath: "/workspace/legacy.txt",
      sandboxEnabled: true,
      generation_source: "semantic_transfer_tool_output",
    },
  ]);

  assert.deepEqual(meta, {
    attachmentId: "att_legacy",
    clientAttachmentId: "client_legacy",
    contentSha256: "sha_legacy",
    sessionId: "session_legacy",
    attachmentSource: "user",
    name: "legacy.txt",
    mimeType: "text/plain",
    size: 25,
    path: "/tmp/legacy.txt",
    relativePath: "runtime/legacy.txt",
    sandboxPath: "/workspace/legacy.txt",
    isSandbox: true,
    generationSource: "semantic_transfer_tool_output",
  });
  assert.equal("id" in meta, false);
  assert.equal("filePath" in meta, false);
  assert.equal("type" in meta, false);
  assert.equal("sandboxViewPath" in meta, false);
  assert.equal("sandboxEnabled" in meta, false);
});

test("nested attachment metadata normalizers remove known alias fields", () => {
  const turnScope = normalizeAttachmentTurnScopeMeta({
    turnScope: {
      turnScopeId: "turn_1",
      session_id: "s1",
      dialog_process_id: "dialog_legacy",
    },
  });
  const parsedResult = normalizeAttachmentParsedResultMeta({
    parsedResult: {
      attachment_id: "parsed_legacy",
      fileName: "parsed.md",
      type: "text/markdown",
      file_path: "/tmp/parsed.md",
      relative_path: "runtime/parsed.md",
      updated_at: "2026-07-11T00:00:00.000Z",
      sandbox_enabled: true,
      tool: "doc_to_data",
    },
  });

  assert.deepEqual(turnScope, {
    turnScopeId: "turn_1",
    dialogProcessId: "dialog_legacy",
    sessionId: "s1",
  });
  assert.deepEqual(parsedResult, {
    attachmentId: "parsed_legacy",
    name: "parsed.md",
    mimeType: "text/markdown",
    path: "/tmp/parsed.md",
    relativePath: "runtime/parsed.md",
    tool: "doc_to_data",
    updatedAt: "2026-07-11T00:00:00.000Z",
    isSandbox: true,
  });
  assert.equal("dialog_process_id" in turnScope, false);
  assert.equal("attachment_id" in parsedResult, false);
  assert.equal("file_path" in parsedResult, false);
  assert.equal("relative_path" in parsedResult, false);
  assert.equal("updated_at" in parsedResult, false);
  assert.equal("sandbox_enabled" in parsedResult, false);
});

test("mapAttachmentRecordsToMetas canonicalizes aliases before exposing attachment metadata", () => {
  const [meta] = mapAttachmentRecordsToMetas([
    {
      id: "att_alias",
      client_attachment_id: "client_alias",
      filename: "alias.md",
      mime: "text/markdown",
      filePath: "/tmp/alias.md",
      relative_path: "runtime/alias.md",
      sandboxViewPath: "/workspace/alias.md",
      sandboxEnabled: false,
      generation_source: "semantic_transfer_tool_output",
      parsedResult: {
        id: "parsed_alias",
        updated_at: "2026-07-11T00:00:00.000Z",
      },
      turnScope: {
        dialog_process_id: "dialog_alias",
      },
    },
  ]);

  assert.equal(meta.attachmentId, "att_alias");
  assert.equal(meta.clientAttachmentId, "client_alias");
  assert.equal(meta.name, "alias.md");
  assert.equal(meta.mimeType, "text/markdown");
  assert.equal(meta.path, "/tmp/alias.md");
  assert.equal(meta.relativePath, "runtime/alias.md");
  assert.equal(meta.sandboxPath, "/workspace/alias.md");
  assert.equal(meta.isSandbox, false);
  assert.equal(meta.generationSource, "semantic_transfer_tool_output");
  assert.equal(meta.parsedResult?.attachmentId, "parsed_alias");
  assert.equal(meta.parsedResult?.updatedAt, "2026-07-11T00:00:00.000Z");
  assert.equal(meta.turnScope?.dialogProcessId, "dialog_alias");
  assert.equal(JSON.stringify(meta).includes("sandboxViewPath"), false);
  assert.equal(JSON.stringify(meta).includes("updated_at"), false);
  assert.equal(JSON.stringify(meta).includes("dialog_process_id"), false);
});

test("buildTransferPayloadFromAttachmentMetas emits canonical attachmentMeta in transfer files", () => {
  const payload = buildTransferPayloadFromAttachmentMetas([
    {
      id: "att_transfer",
      name: "transfer.txt",
      type: "text/plain",
      sandboxViewPath: "/workspace/transfer.txt",
      sandboxEnabled: true,
      generationSource: "semantic_transfer_tool_output",
    },
  ]);
  const file = payload.transferEnvelopes?.[0]?.files?.[0] || {};

  assert.equal(file.filePath, "/workspace/transfer.txt");
  assert.equal(file.attachmentMeta?.attachmentId, "att_transfer");
  assert.equal(file.attachmentMeta?.mimeType, "text/plain");
  assert.equal(file.attachmentMeta?.sandboxPath, "/workspace/transfer.txt");
  assert.equal(file.attachmentMeta?.isSandbox, true);
  assert.equal("type" in file.attachmentMeta, false);
  assert.equal("sandboxViewPath" in file.attachmentMeta, false);
  assert.equal("sandboxEnabled" in file.attachmentMeta, false);
});
