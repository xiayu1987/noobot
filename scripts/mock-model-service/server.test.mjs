/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createMockModelServer } from "./server.mjs";
import { nextReply, scenarioSteps } from "./scenario.mjs";
import { PERF_HARNESS_MODELS } from "./performance-contract.mjs";
import { createNamespacedToolId } from "@noobot/model-protocol/tool-identity-node";
import { projectAuxiliaryHistoryMessages } from "../../context-protocol/src/assembly/auxiliary-history.js";

const marker =
  "NOOBOT_PERF_CASE:runtime/ops_workdir/e2e-unit/perf-1.txt NOOBOT_PERF_ROUND:1 NOOBOT_PERF_CONNECTOR:connector-unit";
const tools = scenarioSteps("runtime/ops_workdir/e2e-unit/perf-1.txt").map(({ name }) => ({
  type: "function",
  function: { name },
}));

test("replay progress is request-local, resets on a new turn, and fails for an unavailable tool", () => {
  const first = { tools, messages: [{ role: "user", content: marker }] };
  assert.equal(nextReply(first).tool.name, "write_file");
  assert.equal(
    nextReply({
      ...first,
      messages: [
        ...first.messages,
        { role: "assistant", tool_calls: [{ id: nextReply(first).callId }] },
        { role: "tool", tool_call_id: nextReply(first).callId, content: '{"ok":true}' },
      ],
    }).tool.name,
    "read_file",
  );
  assert.equal(nextReply(first).tool.name, "write_file");
  const nextTurn = nextReply({
    tools,
    messages: [
      ...first.messages,
      { role: "user", content: marker.replace("perf-1.txt", "perf-2.txt") },
    ],
  });
  assert.equal(nextTurn.tool.name, "write_file");
  assert.notEqual(
    nextTurn.callId,
    nextReply(first).callId,
    "interaction call IDs must be unique across turns",
  );
  assert.equal(
    nextReply({
      ...first,
      messages: [...first.messages, { role: "tool", content: "ok" }, ...first.messages],
    }).tool.name,
    "write_file",
  );
  assert.throws(() => nextReply({ ...first, tools: [] }), /Required tool is not offered/);
  assert.throws(
    () => nextReply({ tools, messages: [{ role: "user", content: "NOOBOT_PERF_CASE:/etc/file" }] }),
    /Invalid performance scenario path/,
  );
});

test("late continuation resets scenario progress and accepts isolated stop paths", () => {
  for (const file of ["perf-stop-1.txt", "perf-stop-2.txt", "perf-7.txt", "perf-8.txt"]) {
    const reply = nextReply({
      tools,
      messages: [
        { role: "user", content: marker },
        { role: "assistant", tool_calls: [{ id: "perf_step_9_01234567" }] },
        { role: "user", content: marker.replace("perf-1.txt", file) },
      ],
    });
    assert.equal(reply.tool.name, "write_file");
    assert.match(reply.callId, /^perf_step_1_/);
  }
  for (const file of ["../perf-7.txt", "perf-0.txt", "perf-stop-0.txt", "perf-7.txt/other"]) {
    assert.throws(
      () =>
        nextReply({
          tools,
          messages: [{ role: "user", content: marker.replace("perf-1.txt", file) }],
        }),
      /Invalid performance scenario path/,
    );
  }
});

test("Harness summary preserves replay progress and connector identity after context compaction", () => {
  const user = { role: "user", content: marker };
  const initial = nextReply({ tools, messages: [user] });
  const evidence = (from, to) =>
    Array.from({ length: to - from + 1 }, (_, index) => {
      const id = initial.callId.replace("perf_step_1_", `perf_step_${from + index}_`);
      return [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id, type: "function", function: { name: "write_file", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: id, content: '{"ok":true}' },
      ];
    }).flat();
  const reply = nextReply({
    model: PERF_HARNESS_MODELS.summary,
    messages: projectAuxiliaryHistoryMessages([user, ...evidence(1, 23)]),
  });
  assert.match(reply.content, /NOOBOT_PERF_PROGRESS:23/);
  const compacted = { role: "user", content: reply.content };
  assert.match(nextReply({ tools, messages: [compacted] }).callId, /^perf_step_24_[a-f0-9]{8}$/);
  const connector = nextReply({
    tools,
    messages: [compacted, ...evidence(24, 39), compacted],
  });
  assert.equal(connector.tool.name, "access_connector");
  assert.equal(connector.tool.args.connector_id, "connector-unit");
  assert.match(
    nextReply({ tools, messages: [compacted, user] }).callId,
    /^perf_step_1_[a-f0-9]{8}$/,
  );
});

test("replay rejects failed or missing results and does not count declarations", () => {
  const user = { role: "user", content: marker };
  const initial = nextReply({ tools, messages: [user] });
  const call = { role: "assistant", tool_calls: [{ id: initial.callId }] };
  assert.equal(nextReply({ tools, messages: [user, call] }).callId, initial.callId);
  assert.throws(
    () =>
      nextReply({
        tools,
        messages: [
          user,
          call,
          {
            role: "tool",
            tool_call_id: initial.callId,
            content: '{"ok":false,"error":"failed"}',
          },
        ],
      }),
    /Performance tool failed/,
  );
  assert.throws(
    () =>
      nextReply({
        tools,
        messages: [
          user,
          {
            role: "tool",
            tool_call_id: initial.callId.replace("step_1_", "step_2_"),
            content: '{"ok":true}',
          },
        ],
      }),
    /Non-contiguous/,
  );
});

test("semantic acceptance consumes its dedicated final-output payload without replay history", () => {
  const model = PERF_HARNESS_MODELS.acceptance_semantic_validation;
  const payload = {
    finalOutput: "NOOBOT-PERF-DONE:runtime/ops_workdir/e2e-unit/perf-1.txt",
    toolSignals: {},
  };
  const request = {
    model,
    messages: [
      { role: "user", content: `Acceptance request\n${JSON.stringify(payload, null, 2)}` },
    ],
  };
  assert.match(nextReply(request).content, /status=pass/);
  assert.throws(() => nextReply({ model, messages: [] }), /Missing semantic/);
  assert.throws(
    () =>
      nextReply({
        model,
        messages: [{ role: "user", content: JSON.stringify({ finalOutput: "unfinished" }) }],
      }),
    /Invalid semantic/,
  );
});

test("MCP replay uses the protocol tool identity and completes after its result", () => {
  const name = createNamespacedToolId("mcp", "e2e_mcp", "echo");
  const request = {
    tools: [{ type: "function", function: { name } }],
    messages: [{ role: "user", content: "NOOBOT-PERF-MCP" }],
  };
  assert.equal(nextReply(request).tool.name, name);
  assert.equal(
    nextReply({
      ...request,
      messages: [...request.messages, { role: "tool", content: '{"ok":true}' }],
    }).content,
    "NOOBOT-PERF-ECHO",
  );
});

function requestMockServer(url, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method }, (response) => {
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("mock HTTP provider supports streaming tool deltas, plain responses, and invalid requests", async (t) => {
  const server = createMockModelServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await requestMockServer(`${url}/health`)).status, 200);
  assert.equal((await requestMockServer(`${url}/unknown`)).status, 404);
  const search = await requestMockServer(`${url}/search?q=NOOBOT-PERF-SEARCH`);
  assert.equal((await search.json()).results[0].title, "NOOBOT-PERF-SEARCH");
  const image = await requestMockServer(`${url}/v1/images/generations`, {
    method: "POST",
    body: JSON.stringify({ prompt: "NOOBOT-PERF-IMAGE" }),
  });
  const bytes = Buffer.from((await image.json()).data[0].b64_json, "base64");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const parsed = await requestMockServer(`${url}/v1/responses`, {
    method: "POST",
    body: JSON.stringify({ model: "e2e_mock", input: [] }),
  });
  assert.equal((await parsed.json()).output[0].content[0].text, "NOOBOT-PERF-PARSED-IMAGE");
  const request = (body) =>
    requestMockServer(`${url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const streamed = await request({
    stream: true,
    tools,
    messages: [{ role: "user", content: marker }],
  });
  const events = (await streamed.text())
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  assert.equal(events.at(-1), "[DONE]");
  const chunks = events.slice(0, -1).map((line) => JSON.parse(line));
  assert.equal(chunks[1].choices[0].delta.tool_calls[0].function.name, "write_file");
  assert.equal(
    JSON.parse(chunks[2].choices[0].delta.tool_calls[0].function.arguments).riskLevel,
    "low",
  );
  const plain = await request({
    messages: [{ role: "user", content: "Initialize performance session" }],
  });
  assert.equal((await plain.json()).choices[0].message.content, "NOOBOT-PERF-INITIALIZED");
  assert.equal((await request({ messages: [] })).status, 400);
  assert.equal(
    (await request({ tools: [], messages: [{ role: "user", content: marker }] })).status,
    400,
  );
});
