/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { terminateProcessTree } from "@noobot/platform-compatibility/process";
import { DEFAULT_HOST } from "./config.js";

export function isProcessAlive(pid = 0) {
  const value = Number(pid || 0);
  if (!value) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
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
async function waitForProcessExit(pid, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    await delay(Math.min(remaining, TIME_THRESHOLDS.openvscode.waitProbeTimeoutMs));
  }
  return true;
}

export async function stopInstance(instance, { forceAfterMs }) {
  const pid = Number(instance?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new TypeError("OpenVSCode instance PID is required");
  const child = { pid, kill: (signal) => process.kill(pid, signal) };
  await terminateProcessTree(child, "SIGTERM");
  if (await waitForProcessExit(pid, forceAfterMs)) return;
  await terminateProcessTree(child, "SIGKILL");
  if (!(await waitForProcessExit(pid, TIME_THRESHOLDS.tools.processSettleGraceMs))) {
    throw new Error(`OpenVSCode process tree ${pid} did not exit after forced termination`);
  }
}
