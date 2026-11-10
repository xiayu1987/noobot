/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readOpenAiResponsesResponse } from "../src/adapters/openai-json-response.js";
import {
  collectResponsesStream,
  requireCompletedResponsesResponse,
} from "../src/adapters/openai-responses-stream.js";
import { resolveModelStreamTerminal } from "@noobot/model-protocol";
import { validatedModelResponseTerminal } from "../src/normalization/response-terminal.js";

for (const structured of [false, true]) {
  test(`request ID survives final projection, structured=${structured}`, async () => {
    const body = {
      id: "resp-1",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          id: "msg-1",
          status: "completed",
          content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }],
        },
      ],
    };
    const result = await readOpenAiResponsesResponse(
      {
        asResponse: async () =>
          Response.json(body, { headers: { "x-request-id": "request-probe" } }),
      },
      structured
        ? {
            text: {
              format: {
                type: "json_schema",
                name: "answer",
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
                strict: true,
              },
            },
          }
        : {},
    );
    assert.equal(result._request_id, "request-probe");
    assert.equal(Object.keys(result).includes("_request_id"), false);
    assert.equal(result.output_text, body.output[0].content[0].text);
    if (structured) assert.deepEqual(result.output_parsed, { ok: true });
  });
}

test("measurement and adapter reuse one terminal validation of the decoded response", () => {
  let traversals = 0;
  const body = {
    id: "resp-1",
    status: "completed",
    get output() {
      traversals += 1;
      return [];
    },
  };
  validatedModelResponseTerminal("responses", body);
  const validatedTraversals = traversals;
  assert.ok(validatedTraversals > 0);
  assert.equal(requireCompletedResponsesResponse(body), body);
  assert.equal(traversals, validatedTraversals);
  assert.throws(
    () => validatedModelResponseTerminal("responses", { status: "completed", output: null }),
    { kind: "protocol" },
  );
});

test("Responses collector validates a terminal event only once", async () => {
  let traversals = 0;
  const response = {
    status: "completed",
    get output() {
      traversals += 1;
      return [];
    },
  };
  const event = { type: "response.completed", response };
  resolveModelStreamTerminal("responses", event);
  const singleValidationTraversals = traversals;
  traversals = 0;
  async function* stream() {
    yield event;
  }
  assert.equal(await collectResponsesStream(stream()), response);
  assert.equal(traversals, singleValidationTraversals);
});
