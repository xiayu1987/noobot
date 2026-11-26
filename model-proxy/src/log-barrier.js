/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const FLUSH_PATH = "/flush-request-logs";

function socketPath(logDir) {
  const digest = createHash("sha256").update(path.resolve(logDir)).digest("hex").slice(0, 24);
  const name = `noobot-model-audit-${digest}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name);
}

export async function startRequestLogBarrier(logDir, proxies) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== FLUSH_PATH) {
      res.writeHead(404).end();
      return;
    }
    try {
      await Promise.all(proxies.map((proxy) => proxy.flushRequestLogs()));
      res.writeHead(204).end();
    } catch (error) {
      console.error("Model proxy request log barrier failed:", error);
      res.writeHead(500).end();
    }
  });
  server.listen(socketPath(logDir));
  await once(server, "listening");
  return server;
}

export function waitForModelRequestLogs(logDir) {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: socketPath(logDir),
      method: "POST",
      path: FLUSH_PATH,
      signal: AbortSignal.timeout(TIME_THRESHOLDS.modelProxy.logFlushTimeoutMs),
    });
    req.on("response", (res) => {
      res.resume();
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode === 204) resolve();
        else reject(new Error(`Model proxy request log barrier returned HTTP ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.end();
  });
}
