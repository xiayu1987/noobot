/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import net from "node:net";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isProcessAlive, terminateProcessTree } from "@noobot/platform-compatibility/process";
import { DEFAULT_HOST } from "./config.js";

export { isProcessAlive };
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
export async function stopInstance(instance, { forceAfterMs }) {
  const pid = Number(instance?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new TypeError("OpenVSCode instance PID is required");
  await terminateProcessTree(pid, {
    graceMs: forceAfterMs,
    settleMs: TIME_THRESHOLDS.tools.processSettleGraceMs,
    controlTimeoutMs: TIME_THRESHOLDS.tools.processControlTimeoutMs,
  });
}
