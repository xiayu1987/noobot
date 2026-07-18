/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import net from "node:net";
import { execFile } from "node:child_process";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { DEFAULT_HOST, DEFAULT_SHUTDOWN_GRACE_MS } from "./config.js";

export function isProcessAlive(pid = 0) {
  const value = Number(pid || 0); if (!value) return false;
  try { process.kill(value, 0); return true; } catch { return false; }
}
export function isPortOpen({ host = DEFAULT_HOST, port = 0, timeoutMs = TIME_THRESHOLDS.openvscode.portProbeTimeoutMs } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port || 0) });
    const finish = (ok) => { socket.removeAllListeners(); socket.destroy(); resolve(Boolean(ok)); };
    socket.setTimeout(timeoutMs); socket.once("connect", () => finish(true)); socket.once("timeout", () => finish(false)); socket.once("error", () => finish(false));
  });
}
export function taskkillProcessTreeBestEffort(pid = 0, { execFileImpl = execFile } = {}) {
  const value = Number(pid || 0); if (!Number.isInteger(value) || value <= 0) return false;
  execFileImpl("taskkill", ["/PID", String(value), "/T", "/F"], { windowsHide: true }, () => {}); return true;
}
export function allocatePort(host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.unref?.(); server.once("error", reject); server.listen(0, host, () => { const port = Number(server.address()?.port || 0); server.close((error) => error ? reject(error) : resolve(port)); }); });
}
export function stopInstanceBestEffort(instance = {}, { forceAfterMs = DEFAULT_SHUTDOWN_GRACE_MS } = {}) {
  if (!instance?.pid) return; const pid = Number(instance.pid);
  if (process.platform === "win32") { taskkillProcessTreeBestEffort(pid); return; }
  // cross-platform-allow: Windows uses taskkill above; POSIX OpenVSCode cleanup uses signals.
  try { process.kill(pid, "SIGTERM"); } catch { return; }
  if (Number(forceAfterMs || 0) > 0) { const timer = setTimeout(() => { if (!isProcessAlive(pid)) return; try {
    // cross-platform-allow: Windows uses taskkill above; POSIX OpenVSCode cleanup uses signals.
    process.kill(pid, "SIGKILL");
  } catch {} }, Number(forceAfterMs)); timer.unref?.(); }
}
