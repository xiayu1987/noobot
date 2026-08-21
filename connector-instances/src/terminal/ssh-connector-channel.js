/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";

const SSH_COMMAND_TIMEOUT_MS = 30000;

function resolveSshConnection(connectionInfo = {}) {
  const source = connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  return {
    host: String(source.host || "").trim(),
    port: Number(source.port || 22),
    username: String(source.username || "").trim(),
    password: String(source.password || ""),
    timeoutMs: SSH_COMMAND_TIMEOUT_MS,
  };
}

async function importSsh2() {
  try {
    const mod = await import("ssh2");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

const sshShellStates = new Map();

function requireChannelKey(channelKey = "") {
  const key = String(channelKey || "").trim();
  if (!key) throw new TypeError("SSH connector channelKey is required");
  return key;
}

function resetSshState(key = "") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const state = sshShellStates.get(normalizedKey);
  if (!state) return;
  const failures = [];
  try {
    state?.stream?.end?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    state?.client?.end?.();
  } catch (error) {
    failures.push(error);
  }
  sshShellStates.delete(normalizedKey);
  if (failures.length) throw new AggregateError(failures, "SSH channel cleanup failed");
}

async function ensureSshShellState({ channelKey = "", connectionInfo = {} } = {}) {
  const key = requireChannelKey(channelKey);
  const cached = sshShellStates.get(key);
  if (cached?.ready === true && cached?.stream && cached?.client) {
    return cached;
  }
  if (cached?.readyPromise) {
    return cached.readyPromise;
  }

  const conn = resolveSshConnection(connectionInfo);
  if (!conn.host || !conn.username || !conn.password) {
    throw new Error("SSH host, username and password are required");
  }

  const ssh2 = await importSsh2();
  const Client = ssh2?.Client;
  if (typeof Client !== "function") {
    throw new Error("ssh2 is not installed");
  }

  const state = {
    key,
    client: null,
    stream: null,
    ready: false,
    queue: Promise.resolve(),
    lastUsedAt: Date.now(),
    readyPromise: null,
  };
  state.readyPromise = new Promise((resolve, reject) => {
    const client = new Client();
    state.client = client;
    const fail = (error) => {
      resetSshState(key);
      reject(error);
    };
    client
      .on("ready", () => {
        client.shell((error, stream) => {
          if (error) {
            fail(error);
            return;
          }
          state.stream = stream;
          state.ready = true;
          state.readyPromise = null;
          state.lastUsedAt = Date.now();
          stream.on("close", () => resetSshState(key));
          stream.on("error", () => resetSshState(key));
          resolve(state);
        });
      })
      .on("error", (error) => fail(error))
      .on("close", () => resetSshState(key))
      .connect({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        readyTimeout: conn.timeoutMs,
      });
  });

  sshShellStates.set(key, state);
  return state.readyPromise;
}

function buildCommandEnvelope(command = "", marker = "") {
  const cmd = String(command || "");
  const mk = String(marker || "").trim();
  return `set +e\n${cmd}\nprintf "\\n${mk}%s\\n" "$?"\n`;
}

function parseExitCodeFromOutput(output = "", marker = "") {
  const text = String(output || "");
  const mk = String(marker || "").trim();
  const idx = text.lastIndexOf(mk);
  if (idx < 0) return { hasMarker: false, exitCode: 1, cleaned: text };
  const after = text.slice(idx + mk.length);
  const firstLine = after.split(/\r?\n/)[0] || "";
  const parsedCode = Number(firstLine.trim());
  const exitCode = Number.isFinite(parsedCode) ? parsedCode : 1;
  const cleaned = `${text.slice(0, idx)}${after.slice(firstLine.length)}`;
  return { hasMarker: true, exitCode, cleaned };
}

function runSshShellCommand(state, command = "", timeoutMs = SSH_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!state?.stream || !state?.ready) {
      reject(new Error("ssh shell not ready"));
      return;
    }
    const marker = `__NOOBOT_DONE_${randomUUID()}__`;
    let stdout = "";
    let stderr = "";
    const stream = state.stream;
    const done = (result = null, error = null) => {
      clearTimeout(timer);
      stream.off("data", onStdout);
      if (stream?.stderr?.off) stream.stderr.off("data", onStderr);
      if (error) reject(error);
      else resolve(result);
    };
    const onStdout = (chunk) => {
      stdout += String(chunk || "");
      if (!stdout.includes(marker)) return;
      const parsed = parseExitCodeFromOutput(stdout, marker);
      done({
        ok: parsed.exitCode === 0,
        code: parsed.exitCode,
        stdout: parsed.cleaned.trim(),
        stderr: String(stderr || "").trim(),
      });
    };
    const onStderr = (chunk) => {
      stderr += String(chunk || "");
    };
    stream.on("data", onStdout);
    if (stream?.stderr?.on) stream.stderr.on("data", onStderr);

    const effectiveTimeoutMs = Number(timeoutMs);
    const timer = setTimeout(() => {
      done(null, new Error(`ssh command timeout after ${effectiveTimeoutMs}ms`));
    }, effectiveTimeoutMs);

    stream.write(buildCommandEnvelope(command, marker), (error) => {
      if (error) done(null, error);
    });
  });
}

export async function executeSshCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
} = {}) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return { ok: false, code: 400, stdout: "", stderr: "ssh command required" };
  }

  try {
    const conn = resolveSshConnection(connectionInfo);
    const state = await ensureSshShellState({
      channelKey,
      connectionInfo: conn,
    });
    state.lastUsedAt = Date.now();
    const run = () => runSshShellCommand(state, cmd, conn.timeoutMs);
    state.queue = state.queue.then(run, run);
    const result = await state.queue;
    state.lastUsedAt = Date.now();
    return result;
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: String(error?.message || error || "ssh command failed"),
    };
  }
}

export function closeSshChannel({ channelKey = "" } = {}) {
  const key = requireChannelKey(channelKey);
  if (!sshShellStates.has(key)) return false;
  resetSshState(key);
  return true;
}
