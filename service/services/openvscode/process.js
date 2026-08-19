/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import net from "node:net";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { terminateProcessTree } from "@noobot/platform-compatibility/process";
import { DEFAULT_HOST, DEFAULT_SHUTDOWN_GRACE_MS } from "./config.js";

export function isProcessAlive(pid = 0) {
  const value = Number(pid || 0);
  if (!value) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}
export function isPortOpen({
  host = DEFAULT_HOST,
  port = 0,
  timeoutMs = TIME_THRESHOLDS.openvscode.portProbeTimeoutMs,
} = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port || 0) });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(Boolean(ok));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
export function allocatePort(host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", reject);
    server.listen(0, host, () => {
      const port = Number(server.address()?.port || 0);
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
export function stopInstanceBestEffort(
  instance = {},
  { forceAfterMs = DEFAULT_SHUTDOWN_GRACE_MS } = {},
) {
  const pid = Number(instance?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0) return;
  const child = { pid, kill: (signal) => process.kill(pid, signal) };
  void terminateProcessTree(child, "SIGTERM").catch((error) => {
    console.warn(`[openvscode] graceful process termination failed: ${error?.message || error}`);
  });
  if (Number(forceAfterMs || 0) > 0) {
    const timer = setTimeout(() => {
      if (!isProcessAlive(pid)) return;
      void terminateProcessTree(child, "SIGKILL").catch((error) => {
        console.warn(`[openvscode] forced process termination failed: ${error?.message || error}`);
      });
    }, Number(forceAfterMs));
    timer.unref?.();
  }
}
