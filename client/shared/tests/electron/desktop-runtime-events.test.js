/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDesktopRuntimeEventWriter,
  getDesktopRuntimeEventsRoot,
  initializeDesktopRuntimeEvents,
  sanitizeDesktopRuntimeEventData,
} from "../../electron/desktop-runtime-events.js";

function createApp(userDataPath) {
  return {
    getPath: (name) => {
      assert.equal(name, "userData");
      return userDataPath;
    },
  };
}

test("desktop runtime-events root is under Electron userData", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-runtime-events-"));
  try {
    const app = createApp(rootDir);
    assert.equal(getDesktopRuntimeEventsRoot(app), path.join(rootDir, "runtime", "events"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("desktop runtime-events initialization keeps explicit env root", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-runtime-events-env-"));
  try {
    const env = { NOOBOT_RUNTIME_EVENTS_ROOT: path.join(rootDir, "custom-events") };
    const app = createApp(rootDir);
    assert.equal(initializeDesktopRuntimeEvents(app, { env }), env.NOOBOT_RUNTIME_EVENTS_ROOT);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("desktop runtime event writer writes sanitized startup event", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-runtime-events-write-"));
  try {
    const app = createApp(rootDir);
    const writer = createDesktopRuntimeEventWriter({ app, env: {} });
    const result = await writer.write(
      { scope: "startup", category: "system", event: "desktop.test.startup" },
      {
        token: "secret-token-value",
        url: "https://example.test/private/path?token=secret",
        userFilePath: path.join(rootDir, "Documents", "private.txt"),
        message: "ready",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(writer.runtimeEventsRoot, path.join(rootDir, "runtime", "events"));
    const content = await readFile(path.join(writer.runtimeEventsRoot, "startup", "desktop", "system.jsonl"), "utf8");
    const record = JSON.parse(content.trim());
    assert.equal(record.source, "desktop");
    assert.equal(record.scope, "startup");
    assert.equal(record.event, "desktop.test.startup");
    assert.equal(record.data.token, "[Redacted]");
    assert.deepEqual(record.data.url, { protocol: "https:", host: "example.test", pathname: "/private/path" });
    assert.equal(record.data.message, "ready");
    assert.doesNotMatch(content, /secret-token-value/);
    assert.doesNotMatch(content, /private\.txt/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("desktop runtime event sanitizer collapses sensitive objects", () => {
  const data = sanitizeDesktopRuntimeEventData({
    headers: { authorization: "Bearer secret", cookie: "a=b" },
    body: { token: "secret" },
    safe: "ok",
  });
  assert.deepEqual(data.headers, { valueLength: String({ authorization: "Bearer secret", cookie: "a=b" }).length });
  assert.deepEqual(data.body, { valueLength: String({ token: "secret" }).length });
  assert.equal(data.safe, "ok");
});
