/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHeaderExtractors, createProxyServer } from "../src/server.js";

function testCertificate(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "noobot-proxy-tls-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

for (const protocol of ["http", "https"]) {
  test(`${protocol} upstream reuses connections and releases them on proxy shutdown`, async (t) => {
    const connections = new Set();
    const requests = [];
    const terminals = [];
    const respond = (req, res) => {
      requests.push({ url: req.url, authorization: req.headers.authorization });
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
        res.end("data: [DONE]\n\n");
      });
    };
    const upstream =
      protocol === "https"
        ? https.createServer(testCertificate(t), respond)
        : http.createServer(respond);
    upstream.on("connection", (socket) => connections.add(socket));
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const proxy = createProxyServer({
      localPort: 0,
      targetUrl: `${protocol}://127.0.0.1:${upstream.address().port}/provider`,
      proxyHost: "127.0.0.1",
      logger: { logRequest() {}, logTerminal: (entry) => terminals.push(entry) },
      measureRequestPrefix: () => null,
      headerExtractors: createHeaderExtractors({}),
    });
    await once(proxy, "listening");
    t.after(() => {
      proxy.closeAllConnections();
      proxy.close();
    });
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`http://127.0.0.1:${proxy.address().port}/chat`, {
        method: "POST",
        headers: { authorization: "Bearer test-only" },
        body: JSON.stringify({ messages: [] }),
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "data: first\n\ndata: [DONE]\n\n");
    }
    assert.equal(connections.size, 1, "ten calls must share one upstream connection");
    assert.equal(requests.length, 10);
    assert.ok(requests.every((entry) => entry.url === "/provider/chat"));
    assert.ok(requests.every((entry) => entry.authorization === "Bearer test-only"));
    assert.equal(terminals.length, 10);
    assert.ok(terminals.every((entry) => entry.outcome === "response"));
    const socket = [...connections][0];
    const released = once(socket, "close");
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
    await released;
    assert.equal(socket.destroyed, true);
  });
}
