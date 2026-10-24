/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { validateRequestLogOrder } from "./request-log-audit.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function requestEntry({ operation, messages, body }) {
  const headers = operation ? { "x-model-operation": operation } : {};
  return `
=== now ===
[Request]
Flow: test.flow
Headers: ${JSON.stringify(headers, null, 2)}
Body:
${JSON.stringify(body || { messages })}
========================
`;
}

function terminalEntry(bodyText = JSON.stringify({ messages: [{ role: "assistant" }] })) {
  return `
--- now ---
[Terminal]
Headers: ${JSON.stringify({ "x-model-operation": "web_search" })}
Body:
${bodyText}
----------------
`;
}

function auditLog(text) {
  const dir = mkdtempSync(path.join(tmpdir(), "request-log-audit-"));
  tempDirs.push(dir);
  const logPath = path.join(dir, "requests.log");
  writeFileSync(logPath, text);
  const failures = [];
  const passes = [];
  validateRequestLogOrder(logPath, {
    fail: (title) => failures.push(title),
    pass: (title) => passes.push(title),
  });
  return { failures, passes };
}

const userOnly = [{ role: "user", content: "query" }];

test("chat requests without constructed system fail", () => {
  const { failures } = auditLog(requestEntry({ operation: "chat", messages: userOnly }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /missing constructed system block/);
});

test("missing or unknown x-model-operation fails instead of defaulting to chat", () => {
  for (const operation of ["", "completion"]) {
    const { failures, passes } = auditLog(requestEntry({ operation, messages: userOnly }));
    assert.deepEqual(passes, []);
    assert.match(failures[0], /unknown x-model-operation/);
  }
});

test("image_generation audits the gateway prompt and the Responses input shapes", () => {
  const { failures, passes } = auditLog(
    requestEntry({ operation: "image_generation", body: { model: "m", prompt: "red square" } }) +
      requestEntry({ operation: "image_generation", body: { input: userOnly } }),
  );
  assert.deepEqual(failures, []);
  assert.match(passes[0], /\(2 requests\)/);

  const empty = auditLog(requestEntry({ operation: "image_generation", body: { prompt: " " } }));
  assert.match(empty.failures[0], /no auditable request messages/);
});

test("provider operations are exempt from the constructed system requirement", () => {
  const { failures, passes } = auditLog(
    requestEntry({ operation: "web_search", messages: userOnly }),
  );
  assert.deepEqual(failures, []);
  assert.equal(passes.length, 1);
});

test("provider operations still enforce system-before-conversation order", () => {
  const { failures } = auditLog(
    requestEntry({
      operation: "web_search",
      messages: [...userOnly, { role: "system", content: "late" }],
    }),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /order violation/);
});

test("operation kind is read from the request header of the same entry", () => {
  const text =
    requestEntry({ operation: "web_search", messages: userOnly }) +
    terminalEntry() +
    requestEntry({ operation: "chat", messages: userOnly });
  const { failures } = auditLog(text);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Body#2/);
});

test("Responses input is audited, with instructions as the constructed system", () => {
  const system = { role: "system", content: "constructed" };
  const ok = auditLog(
    requestEntry({ operation: "chat", body: { input: [system, ...userOnly] } }) +
      requestEntry({ operation: "chat", body: { instructions: "constructed", input: userOnly } }),
  );
  assert.deepEqual(ok.failures, []);
  assert.match(ok.passes[0], /\(2 requests\)/);

  const missing = auditLog(requestEntry({ operation: "chat", body: { input: userOnly } }));
  assert.match(missing.failures[0], /missing constructed system block/);
});

test("role-less Responses items count as conversation for order checks", () => {
  const { failures } = auditLog(
    requestEntry({
      operation: "chat",
      body: {
        input: [
          { role: "system", content: "constructed" },
          { type: "function_call", call_id: "c1", name: "t", arguments: "{}" },
          { role: "developer", content: "late" },
        ],
      },
    }),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /order violation/);
});

test("plain-text terminal bodies are ignored and never shift request bodies", () => {
  const system = { role: "system", content: "constructed" };
  const { failures, passes } = auditLog(
    terminalEntry("plain text answer with { brace") +
      requestEntry({ operation: "chat", messages: [system, ...userOnly] }),
  );
  assert.deepEqual(failures, []);
  assert.match(passes[0], /\(1 requests\)/);
});

test("a log without auditable request messages fails instead of passing silently", () => {
  for (const text of [terminalEntry(), requestEntry({ operation: "chat", messages: [] })]) {
    const { failures, passes } = auditLog(text);
    assert.deepEqual(passes, []);
    assert.match(failures[0], /no auditable request messages/);
  }
});
