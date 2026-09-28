/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createModelAccessServer } from "../../scripts/model-access-test/server.js";
import {
  parseImportedRequest,
  createParameterEditor,
} from "../../scripts/model-access-test/public/editor.js";
import { JSDOM } from "jsdom";

test("local server protects credential-bearing requests and preserves omitted parameters", async (context) => {
  const models = [
    {
      alias: "test",
      model: "gpt-test",
      base_url: "https://example.test/v1",
      api_key: "secret-key",
    },
  ];
  let received;
  const server = createModelAccessServer({
    models,
    execute: async (input) => {
      received = input;
      return { ok: true, traces: [], output: { text: "secret-key" } };
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await (await fetch(`${base}/api/models`)).json();
  assert.equal(JSON.stringify(bootstrap).includes("secret-key"), false);
  assert.equal(bootstrap.models[0].hasCredential, true);
  const payload = {
    alias: "test",
    protocol: "responses",
    body: { model: "gpt-test", input: "OK?" },
  };
  const headers = { "content-type": "application/json", "x-diagnostic-token": bootstrap.token };
  assert.equal(
    (await fetch(`${base}/api/run`, { method: "POST", body: JSON.stringify(payload) })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { ...headers, origin: "https://untrusted.test" },
        body: JSON.stringify(payload),
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      http
        .get(`${base}/api/models`, { headers: { host: "untrusted.test" } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
        .on("error", reject);
    }),
    403,
  );
  assert.equal(received, undefined);
  const result = await (
    await fetch(`${base}/api/run`, { method: "POST", headers, body: JSON.stringify(payload) })
  ).json();
  assert.deepEqual(received.body, payload.body);
  assert.equal(received.modelSpec.api_key, "secret-key");
  assert.equal(received.modelSpec.useResponsesApi, true);
  assert.equal(result.output.text, "[REDACTED]");
  assert.equal(models[0].useResponsesApi, undefined);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test("imports proxy logs, JSON bodies, and exported diagnostics", () => {
  const body = { model: "gpt-test", input: [{ role: "user", content: "OK?" }], temperature: 0.7 };
  const log = `[Request]\nURL: /v1/responses\nBody:\n${JSON.stringify(body)}\n========================\n[Terminal]\nStatus: 400\nBody:\n{}`;
  assert.deepEqual(parseImportedRequest(log), { body, protocol: "responses" });
  assert.deepEqual(parseImportedRequest(JSON.stringify(body)).body, body);
  assert.deepEqual(
    parseImportedRequest(JSON.stringify({ traces: [{ request: { body } }] })).body,
    body,
  );
  assert.throws(() => parseImportedRequest("[]"));
});

test("tool binding can be toggled without replacing imported messages or parameter edits", () => {
  const browser = new JSDOM('<div id="parameters"></div>');
  const previousDocument = globalThis.document;
  globalThis.document = browser.window.document;
  try {
    const editor = createParameterEditor(document.getElementById("parameters"), () => undefined);
    const body = {
      model: "gpt-test",
      input: [{ role: "user", content: "Original context" }],
      temperature: 0.4,
      tools: [{ type: "function", name: "echo", parameters: { type: "object" } }],
      tool_choice: "required",
      parallel_tool_calls: false,
    };
    editor.setToolBinding(true);
    editor.load(body);
    assert.deepEqual(editor.read(), body);
    editor.setToolBinding(false);
    assert.deepEqual(editor.read(), { model: body.model, input: body.input, temperature: 0.4 });
    editor.restore();
    assert.equal(Object.hasOwn(editor.read(), "tools"), false);
    editor.setToolBinding(true);
    assert.deepEqual(editor.read(), body);
  } finally {
    globalThis.document = previousDocument;
    browser.window.close();
  }
});
