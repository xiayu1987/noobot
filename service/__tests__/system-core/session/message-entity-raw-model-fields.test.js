import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessageEntity } from "../../../system-core/session/entities.js";

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
