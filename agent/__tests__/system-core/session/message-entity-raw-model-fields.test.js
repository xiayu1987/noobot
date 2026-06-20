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

test("normalizeMessageEntity merges legacy transferEnvelope into transferEnvelopes", () => {
  const transferEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/a.md",
  };
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelope,
    transferEnvelopes: [transferEnvelope],
  });
  assert.equal("transferEnvelope" in normalized, false);
  assert.deepEqual(normalized.transferEnvelopes, [transferEnvelope]);
});

test("normalizeMessageEntity omits empty attachmentMetas", () => {
  const withoutAttachmentMetas = normalizeMessageEntity({
    role: "user",
    content: "hello",
  });
  const withEmptyAttachmentMetas = normalizeMessageEntity({
    role: "user",
    content: "hello",
    attachmentMetas: [],
  });

  assert.equal("attachmentMetas" in withoutAttachmentMetas, false);
  assert.equal("attachmentMetas" in withEmptyAttachmentMetas, false);
});

test("normalizeMessageEntity preserves non-empty attachmentMetas", () => {
  const attachmentMetas = [{ attachmentId: "att_1", filename: "a.txt" }];
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachmentMetas,
  });

  assert.deepEqual(normalized.attachmentMetas, attachmentMetas);
});
