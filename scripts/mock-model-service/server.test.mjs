/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createMockModelServer } from "./server.mjs";
import { nextReply, scenarioSteps } from "./scenario.mjs";

const marker = "NOOBOT_PERF_CASE:runtime/ops_workdir/e2e-unit/perf-1.txt";
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
        { role: "assistant", tool_calls: [{ id: "perf_step_1_01234567" }] },
        { role: "tool", content: "ok" },
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

test("summary preserves replay progress and connector identity after context compaction", () => {
  const user = { role: "user", content: `${marker} NOOBOT_PERF_CONNECTOR:connector-unit` };
  const reply = nextReply({
    tools,
    messages: [
      user,
      { role: "assistant", tool_calls: [{ id: "perf_step_23_01234567" }] },
      { role: "user", content: "The phase-summary threshold is reached." },
    ],
  });
  assert.equal(reply.tool.name, "task_summary");
  assert.match(reply.tool.args.summaryContent, /NOOBOT_PERF_PROGRESS:23/);
  const compacted = { role: "user", content: reply.tool.args.summaryContent };
  assert.match(nextReply({ tools, messages: [compacted] }).callId, /^perf_step_24_[a-f0-9]{8}$/);
  const connector = nextReply({
    tools,
    messages: [compacted, { role: "assistant", tool_calls: [{ id: "perf_step_39_01234567" }] }],
  });
  assert.equal(connector.tool.name, "access_connector");
  assert.equal(connector.tool.args.connector_id, "connector-unit");
  assert.match(
    nextReply({ tools, messages: [compacted, user] }).callId,
    /^perf_step_1_[a-f0-9]{8}$/,
  );
});

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
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
  const search = await fetch(`${url}/search?q=NOOBOT-PERF-SEARCH`);
  assert.equal((await search.json()).results[0].title, "NOOBOT-PERF-SEARCH");
  const image = await fetch(`${url}/v1/images/generations`, {
    method: "POST",
    body: JSON.stringify({ prompt: "NOOBOT-PERF-IMAGE" }),
  });
  const bytes = Buffer.from((await image.json()).data[0].b64_json, "base64");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const parsed = await fetch(`${url}/v1/responses`, {
    method: "POST",
    body: JSON.stringify({ model: "e2e_mock", input: [] }),
  });
  assert.equal((await parsed.json()).output[0].content[0].text, "NOOBOT-PERF-PARSED-IMAGE");
  const request = (body) =>
    fetch(`${url}/v1/chat/completions`, { method: "POST", body: JSON.stringify(body) });
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
  const plain = await request({ messages: [] });
  assert.equal((await plain.json()).choices[0].message.content, "NOOBOT-PERF-OK");
  assert.equal(
    (await request({ tools: [], messages: [{ role: "user", content: marker }] })).status,
    400,
  );
});
