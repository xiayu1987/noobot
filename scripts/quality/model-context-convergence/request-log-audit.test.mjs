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
import { formatModelRequestBodyCompleteness } from "@noobot/model-protocol/protocol";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function requestEntry({ operation, messages, body, bodyComplete = true }) {
  const headers = operation ? { "x-model-operation": operation } : {};
  return `
=== now ===
[Request]
RequestId: test-request
Model: test-model
Flow: test.flow
SessionId: test-session
ParentSessionId: [root]
Headers: ${JSON.stringify(headers, null, 2)}
${formatModelRequestBodyCompleteness(bodyComplete)}
Body:
${JSON.stringify(body || { messages })}
========================
`;
}

function terminalEntry(bodyText = JSON.stringify({ messages: [{ role: "assistant" }] })) {
  return `
--- now ---
[Terminal]
RequestId: test-request
Model: test-model
Flow: test.flow
SessionId: test-session
ParentSessionId: [root]
Outcome: client_aborted
Headers: ${JSON.stringify({ "x-model-operation": "web_search" })}
Body:
${bodyText}
----------------
`;
}

function auditLog(...texts) {
  const dir = mkdtempSync(path.join(tmpdir(), "request-log-audit-"));
  tempDirs.push(dir);
  const logPaths = texts.map((text, index) => {
    const logPath = path.join(dir, `requests-${index}.log`);
    writeFileSync(logPath, text);
    return logPath;
  });
  const failures = [];
  const passes = [];
  validateRequestLogOrder(logPaths, {
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

test("media_generation audits native image and video prompt shapes", () => {
  const { failures, passes } = auditLog(
    requestEntry({ operation: "media_generation", body: { model: "m", prompt: "red square" } }) +
      requestEntry({ operation: "media_generation", body: { input: userOnly } }),
  );
  assert.deepEqual(failures, []);
  assert.match(passes[0], /\(2 requests\)/);

  const empty = auditLog(requestEntry({ operation: "media_generation", body: { prompt: " " } }));
  assert.match(empty.failures[0], /no auditable request messages/);
});

test("native generation audits every message container without hiding later system roles", () => {
  const late = [...userOnly, { role: "system", content: "late" }];
  for (const body of [
    { contents: late },
    { content: late },
    { input: late },
    { input: { messages: late } },
    { prompt: "image", contents: late },
    { contents: [], input: late },
  ]) {
    const { failures } = auditLog(requestEntry({ operation: "media_generation", body }));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /order violation/);
  }
  const { failures, passes } = auditLog(
    requestEntry({ operation: "media_generation", body: { input: { prompt: "video" } } }),
  );
  assert.deepEqual(failures, []);
  assert.equal(passes.length, 1);
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

test("transport-incomplete JSON is reported separately from audited complete requests", () => {
  const complete = requestEntry({
    operation: "chat",
    messages: [{ role: "system", content: "constructed" }, ...userOnly],
  });
  const partial = requestEntry({ operation: "chat", bodyComplete: false }).replace(
    "{}",
    '{"messages":[{"role":"us',
  );
  const { failures, passes } = auditLog(complete + partial + terminalEntry());
  assert.deepEqual(failures, []);
  assert.equal(passes.length, 1);
  assert.match(passes[0], /\(1 requests\) \(incomplete transport bodies=1\)/);
  assert.match(auditLog(partial).failures[0], /incomplete request terminal invalid/);
});

test("complete malformed bodies and invalid completeness fields still fail", () => {
  const complete = requestEntry({ operation: "chat", messages: userOnly });
  assert.match(
    auditLog(complete.replace('{"messages":', '{"broken":\n"')).failures[0],
    /Body JSON parse failed/,
  );
  for (const field of ["", "BodyComplete: unknown", "BodyComplete: true\nBodyComplete: false"]) {
    assert.match(
      auditLog(complete.replace("BodyComplete: true", field)).failures[0],
      /body completeness invalid/,
    );
  }
  const partial = requestEntry({ operation: "unknown", bodyComplete: false });
  assert.match(auditLog(partial).failures[0], /unknown x-model-operation/);
});

test("incomplete requests require a unique matching error terminal with identical ownership", () => {
  const complete = requestEntry({ operation: "web_search", messages: userOnly });
  const partial = requestEntry({ operation: "chat", bodyComplete: false });
  const terminal = terminalEntry();
  for (const invalid of [
    "",
    terminal + terminal,
    terminal.replace("RequestId: test-request", "RequestId: another-request"),
    terminal.replace("Outcome: client_aborted", "Outcome: response"),
    terminal.replace("Outcome: client_aborted", "Outcome: unknown"),
    ...["RequestId", "Model", "Flow", "SessionId", "ParentSessionId"].map((name) =>
      terminal.replace(new RegExp(`^${name}: .*`, "m"), `${name}: wrong`),
    ),
  ]) {
    const result = auditLog(complete + partial + invalid);
    assert.match(result.failures[0], /incomplete request terminal invalid/);
  }
});

test("rotation and interleaving preserve request-terminal correlation across files", () => {
  const complete = requestEntry({ operation: "web_search", messages: userOnly });
  const partial = requestEntry({ operation: "chat", bodyComplete: false });
  const terminal = terminalEntry();
  const otherPartial = partial.replace("RequestId: test-request", "RequestId: second-request");
  const otherTerminal = terminal.replace("RequestId: test-request", "RequestId: second-request");
  for (const entries of [
    [complete + partial, terminal],
    [terminal, complete + partial],
    [complete + partial + otherPartial, otherTerminal, terminal],
  ])
    assert.deepEqual(auditLog(...entries).failures, []);
  assert.match(auditLog(complete + partial, terminal, terminal).failures[0], /terminal invalid/);
  assert.match(auditLog(complete + partial, otherTerminal).failures[0], /terminal invalid/);
});
