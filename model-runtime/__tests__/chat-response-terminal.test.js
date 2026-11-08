/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ModelProtocolError, requireModelResponseTerminal } from "@noobot/model-protocol";
import { createOpenAiCompatibleClient } from "../src/adapters/openai-compatible-adapter.js";

for (const choices of [
  undefined,
  null,
  {},
  [],
  [null],
  [{}],
  [{ finish_reason: null }],
  [{ finish_reason: "" }],
  [{ finish_reason: " " }],
  [{ finish_reason: 7 }],
  [{ finish_reason: "stop" }, { finish_reason: null }],
]) {
  test(`Chat protocol rejects incomplete body choices ${JSON.stringify(choices)}`, () => {
    assert.throws(
      () => requireModelResponseTerminal("chat", { choices }),
      (error) => error instanceof ModelProtocolError && /finish_reason/.test(error.message),
    );
  });
}

for (const reason of ["stop", "tool_calls", "length", "content_filter", "function_call"]) {
  test(`Chat terminal ${reason} is shared between protocol and real SDK`, async () => {
    const body = {
      id: "chat_test",
      object: "chat.completion",
      model: "gpt-test",
      choices: [
        { index: 0, message: { role: "assistant", content: "result" }, finish_reason: reason },
      ],
    };
    assert.deepEqual(requireModelResponseTerminal("chat", body), {
      status: "completed",
      outputUsageFinal: true,
    });
    const client = createOpenAiCompatibleClient({
      modelSpec: {
        model: "gpt-test",
        operatorId: "openai",
        adapterId: "openai-compatible",
        use_responses_api: false,
        reasoning_effort: "none",
        reasoning_effort_options: ["none"],
        reasoning_effort_parameter: "reasoning_effort",
      },
      credential: "test-key",
      fetch: async () => Response.json(body),
    });
    assert.equal((await client.invoke("hello")).content, "result");
    body.choices[0].finish_reason = null;
    await assert.rejects(
      client.invoke("hello"),
      (error) => error instanceof ModelProtocolError && /finish_reason/.test(error.message),
    );
  });
}
