/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeEmailCommand } from "../../../../src/system-core/connectors/emails/email-connector-channel.js";

test("executeEmailCommand rejects empty command", async () => {
  const result = await executeEmailCommand({ command: "" });
  assert.equal(result.ok, false);
  assert.ok(result.stderr.length > 0);
});

test("executeEmailCommand rejects invalid JSON", async () => {
  const result = await executeEmailCommand({ command: "not json" });
  assert.equal(result.ok, false);
  assert.ok(result.stderr.includes("JSON"));
});

test("executeEmailCommand rejects invalid action", async () => {
  const result = await executeEmailCommand({ command: '{"action":"delete"}' });
  assert.equal(result.ok, false);
  assert.ok(result.stderr.includes("action"));
});

test("executeEmailCommand send action rejects missing to", async () => {
  const result = await executeEmailCommand({ command: '{"action":"send","subject":"test"}' });
  assert.equal(result.ok, false);
  assert.ok(result.stderr.length > 0);
});

test("executeEmailCommand list action returns structure", async () => {
  // Without connection info this will fail to connect, but should return error structure
  const result = await executeEmailCommand({
    command: '{"action":"list","folder":"INBOX","limit":1}',
    connectionInfo: {},
  });
  // Will fail due to no connection, but structure should be consistent
  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.code, "number");
});

test("executeEmailCommand read action rejects missing uid gracefully", async () => {
  const result = await executeEmailCommand({
    command: '{"action":"read"}',
    connectionInfo: {},
  });
  // Without connection it will fail, but should not crash
  assert.equal(typeof result.ok, "boolean");
});

test("executeEmailCommand list_folders action returns structure", async () => {
  const result = await executeEmailCommand({
    command: '{"action":"list_folders"}',
    connectionInfo: {},
  });
  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.code, "number");
});
