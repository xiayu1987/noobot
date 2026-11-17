/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { createOpenAiCompatibleClient } from "../src/adapters/openai-compatible-adapter.js";

function clients() {
  return [
    new ChatOpenAI({ apiKey: "local", model: "gpt-4o-mini", maxRetries: 0 }),
    createOpenAiCompatibleClient({
      credential: "local",
      modelSpec: {
        model: "gpt-4o-mini",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high"],
      },
    }),
  ].map((client) => client.completions);
}

test("adapter preserves native tokenization after encoder state and method changes", async () => {
  for (const sdk of clients()) {
    const encoder = {
      count: 2,
      encode() {
        return Array(this.count).fill(1);
      },
    };
    sdk._encoding = encoder;
    assert.equal(await sdk.getNumTokens("same input"), 2);
    encoder.count = 5;
    assert.equal(await sdk.getNumTokens("same input"), 5);
    encoder.encode = () => [1];
    assert.equal(await sdk.getNumTokens("same input"), 1);
    sdk._encoding = { encode: () => [1, 2, 3] };
    assert.equal(await sdk.getNumTokens("same input"), 3);
  }
});

test("adapter preserves lazy initialization and dynamic content serialization", async () => {
  const [control, actual] = clients();
  const content = [{ type: "text", text: "first" }];
  for (const text of ["native initialization", "中文🙂", "", "repeat", "repeat", content]) {
    assert.equal(await actual.getNumTokens(text), await control.getNumTokens(text));
  }
  content[0].text = "updated content with more tokens";
  assert.equal(await actual.getNumTokens(content), await control.getNumTokens(content));
});
