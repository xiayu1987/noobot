import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessageEntity } from "../../../src/system-core/session/entities.js";

test("normalizeMessageEntity does not persist heavy raw model fields", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "fallback",
    rawModelContent: [{ type: "text", text: "x", thought_signature: "sig" }],
    modelAdditionalKwargs: { opaque: true, tool_calls: [{ id: "call_1" }] },
    modelResponseMetadata: {
      finish_reason: "tool_calls",
      model_name: "qwen3.6-plus-2026-04-02",
      model_provider: "openai",
      usage: { total_tokens: 1234, prompt_tokens: 1000 },
    },
  });

  assert.equal("rawModelContent" in normalized, false);
  assert.equal("modelAdditionalKwargs" in normalized, false);
  assert.equal("modelResponseMetadata" in normalized, false);
});

test("normalizeMessageEntity persists compact transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [
      {
        filePath: "/workspace/a.md",
        attachmentMeta: {
          attachmentId: "att_1",
          name: "a.md",
          owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
        },
        pathView: { sandboxPath: "/sandbox/a.md", hostPath: "/host/a.md" },
      },
    ],
  };
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelopes: [envelope],
  });
  assert.equal("transferEnvelopes" in normalized, true);
  assert.deepEqual(normalized.transferEnvelopes, [
    {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [
        {
          attachmentId: "att_1",
          name: "a.md",
          path: "/workspace/a.md",
          sandboxPath: "/sandbox/a.md",
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    },
  ]);
  assert.equal("attachmentMeta" in normalized.transferEnvelopes[0], false);
  assert.equal("pathView" in normalized.transferEnvelopes[0], false);
  assert.equal("id" in normalized.transferEnvelopes[0].files[0], false);
  assert.equal("type" in normalized.transferEnvelopes[0].files[0], false);
  assert.equal("source" in normalized.transferEnvelopes[0].files[0], false);
});

test("normalizeMessageEntity ignores non-array transferEnvelopes", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelopes: { protocol: "noobot.semantic-transfer" },
  });

  assert.equal("transferEnvelopes" in normalized, false);
});

test("normalizeMessageEntity omits empty attachments", () => {
  const withoutAttachments = normalizeMessageEntity({
    role: "user",
    content: "hello",
  });
  const withEmptyAttachments = normalizeMessageEntity({
    role: "user",
    content: "hello",
    attachments: [],
  });

  assert.equal("attachments" in withoutAttachments, false);
  assert.equal("attachments" in withEmptyAttachments, false);
});

test("normalizeMessageEntity preserves compact non-empty attachments", () => {
  const attachments = [{
    attachmentId: "att_1",
    filename: "a.txt",
    mimeType: "text/plain",
    raw: "drop",
    owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
  }];
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachments,
  });

  assert.deepEqual(normalized.attachments, [
    {
      attachmentId: "att_1",
      name: "a.txt",
      mimeType: "text/plain",
      owner: { type: "plugin", id: "harness-plugin" },
    },
  ]);
  assert.equal("attachmentMetas" in normalized, false);
  assert.equal("raw" in normalized.attachments[0], false);
  assert.equal("id" in normalized.attachments[0], false);
  assert.equal("type" in normalized.attachments[0], false);
  assert.equal("source" in normalized.attachments[0], false);
});

test("normalizeMessageEntity preserves user attachment source fields for history rebuild", () => {
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachments: [
      {
        attachmentId: "att_source_1",
        name: "source.md",
        mimeType: "text/markdown",
        attachmentSource: "user",
        sessionId: "s-source",
        path: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
        relativePath: "runtime/attach/scoped/s-source/user/source.md",
        sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
        size: 42,
        isSandbox: true,
        raw: "drop",
      },
    ],
  });

  assert.deepEqual(normalized.attachments, [
    {
      attachmentId: "att_source_1",
      name: "source.md",
      mimeType: "text/markdown",
      size: 42,
      attachmentSource: "user",
      sessionId: "s-source",
      relativePath: "runtime/attach/scoped/s-source/user/source.md",
      sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
      path: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
      isSandbox: true,
    },
  ]);
  assert.equal("raw" in normalized.attachments[0], false);
});

test("normalizeMessageEntity ignores legacy attachment mirror fields", () => {
  const camelAttachments = [{ attachmentId: "att_camel", filename: "camel.txt" }];
  const snakeAttachments = [{ attachmentId: "att_snake", filename: "snake.txt" }];

  assert.equal(
    "attachments" in normalizeMessageEntity({ role: "user", content: "camel", attachmentMetas: camelAttachments }),
    false,
  );
  assert.equal(
    "attachments" in normalizeMessageEntity({ role: "user", content: "snake", attachment_metas: snakeAttachments }),
    false,
  );
});
