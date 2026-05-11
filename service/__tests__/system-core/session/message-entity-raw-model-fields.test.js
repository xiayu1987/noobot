import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessageEntity } from "../../../system-core/session/entities.js";

test("normalizeMessageEntity keeps raw model content and provider kwargs", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "fallback",
    rawModelContent: [{ type: "text", text: "x", thought_signature: "sig" }],
    modelAdditionalKwargs: { opaque: true },
    modelResponseMetadata: { finish_reason: "tool_calls" },
  });

  assert.deepEqual(normalized.rawModelContent, [
    { type: "text", text: "x", thought_signature: "sig" },
  ]);
  assert.deepEqual(normalized.modelAdditionalKwargs, { opaque: true });
  assert.deepEqual(normalized.modelResponseMetadata, {
    finish_reason: "tool_calls",
  });
});
