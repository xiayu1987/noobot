import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAuthService } from "../services/auth-service.js";

async function tempWorkspaceRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "auth-service-runtime-events-"));
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForFile(file, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

test("auth-service: writes sanitized system runtime event when query URL parsing fails", async () => {
  const workspaceRoot = await tempWorkspaceRoot();
  const service = createAuthService({
    translateText: (key = "") => String(key || ""),
    runtimeEventsConfig: { workspaceRoot },
  });

  const auth = service.resolveAuthByApiKey({
    url: "http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value",
    headers: {},
    query: {},
  });

  assert.equal(auth, null);

  const eventFile = path.join(
    workspaceRoot,
    "system",
    "runtime",
    "events",
    "system",
    "service",
    "security.jsonl",
  );
  await waitForFile(eventFile);
  const [record] = await readJsonl(eventFile);

  assert.equal(record.scope, "system");
  assert.equal(record.source, "service");
  assert.equal(record.category, "security");
  assert.equal(record.level, "warn");
  assert.equal(record.event, "service.auth.extractApiKey.urlParse.failed");
  assert.equal(record.channel, "direct");
  assert.equal(Object.prototype.hasOwnProperty.call(record, "sessionId"), false);
  assert.equal(record.data.urlPathPreview, "http://[");
  assert.equal(record.data.urlLength, "http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value".length);
  assert.equal(record.error.name, "TypeError");

  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("Bearer-token"), false);
  assert.equal(serialized.includes("session"), false);
  assert.equal(serialized.includes("secret=value"), false);
});

test("auth-service: URL parse failure does not break header API key auth", async () => {
  const workspaceRoot = await tempWorkspaceRoot();
  const service = createAuthService({
    translateText: (key = "") => String(key || ""),
    runtimeEventsConfig: { workspaceRoot },
  });
  const apiKey = service.issueApiKey({ userId: "u1" });

  const auth = service.resolveAuthByApiKey({
    url: "http://[?apikey=SHOULD_NOT_BE_USED",
    headers: { "x-api-key": apiKey },
    query: {},
  });

  assert.deepEqual(auth?.userId, "u1");
});
