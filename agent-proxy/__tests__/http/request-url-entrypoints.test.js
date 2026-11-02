/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withoutRuntimeInstancePaths } from "@noobot/runtime-topology-protocol/instance-paths";

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function exchange(port, headers) {
  const socket = net.connect(port, "127.0.0.1");
  socket.setTimeout(2000, () => socket.destroy(new Error("request timed out")));
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  await once(socket, "connect");
  socket.write(`${headers}\r\n\r\n`);
  await once(socket, "close");
  return Buffer.concat(chunks).toString("utf8");
}

async function waitForServer(child, port, errors) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, errors());
    try {
      const response = await exchange(
        port,
        "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close",
      );
      if (response.startsWith("HTTP/1.1 200")) return;
    } catch (error) {
      if (error.code !== "ECONNREFUSED") throw error;
    }
    await delay(25);
  }
  assert.fail(`proxy did not start: ${errors()}`);
}

test("proxy entrypoints reject invalid URLs before frontend serving or WebSocket upgrade", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-url-contract-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "index.html"), "url-contract-home");
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    [new URL("../../agent-proxy.js", import.meta.url).pathname],
    {
      env: {
        ...withoutRuntimeInstancePaths(process.env),
        NOOBOT_WORKSPACE_ROOT: path.join(root, "workspace"),
        AGENT_PROXY_HOST: "127.0.0.1",
        AGENT_PROXY_PORT: String(port),
        AGENT_PROXY_FRONTEND_ROOT: root,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    child.kill();
    await closed;
  });
  await waitForServer(child, port, () => stderr);
  const home = await exchange(port, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close");
  assert.match(home, /^HTTP\/1\.1 200/);
  assert.match(home, /url-contract-home/);
  const invalid = await exchange(
    port,
    "GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close",
  );
  assert.match(invalid, /^HTTP\/1\.1 400/);
  assert.match(invalid, /"ok":false/);
  assert.match(invalid, /invalid request url/);
  assert.doesNotMatch(invalid, /url-contract-home/);
  const upgrade = await exchange(
    port,
    "GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
  );
  assert.equal(upgrade, "");
  assert.equal(child.exitCode, null);
});
