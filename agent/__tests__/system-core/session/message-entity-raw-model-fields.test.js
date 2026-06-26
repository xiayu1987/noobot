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

test("normalizeMessageEntity persists transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/a.md",
  };
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelopes: [envelope],
  });
  assert.equal("transferEnvelopes" in normalized, true);
  assert.deepEqual(normalized.transferEnvelopes, [envelope]);
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

test("normalizeMessageEntity preserves non-empty attachments", () => {
  const attachments = [{ attachmentId: "att_1", filename: "a.txt" }];
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachments,
  });

  assert.deepEqual(normalized.attachments, attachments);
  assert.equal("attachmentMetas" in normalized, false);
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
