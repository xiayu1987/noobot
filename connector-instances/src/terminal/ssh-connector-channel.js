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

function resetSshState(key = "", expectedState = null) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const state = sshShellStates.get(normalizedKey);
  if (!state) return;
  if (expectedState && state !== expectedState) return;
  const failures = [];
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
  if (cached?.ready === true && cached?.client && cached?.stream) {
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
  sshShellStates.set(key, state);
  state.readyPromise = new Promise((resolve, reject) => {
    const client = new Client();
    state.client = client;
    const fail = (error) => {
      resetSshState(key, state);
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
          stream.on("close", () => resetSshState(key, state));
          stream.on("error", () => resetSshState(key, state));
          resolve(state);
        });
      })
      .on("error", (error) => fail(error))
      .on("close", () => resetSshState(key, state))
      .connect({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        readyTimeout: conn.timeoutMs,
      });
  });

  return state.readyPromise;
}

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]/g;

function buildCommandEnvelope(command = "", token = "") {
  return [
    "stty -echo 2>/dev/null; PS1=''; PS2=''; set +e",
    `printf '%s%s\\n' '__NOOBOT_BEGIN_' '${token}__'`,
    String(command || ""),
    `printf '\\n%s%s%s\\n' '__NOOBOT_DONE_' '${token}__' "$?"`,
    "",
  ].join("\n");
}

export function parseSshCommandOutput(raw = "", token = "") {
  const text = String(raw || "");
  const beginMarker = `__NOOBOT_BEGIN_${token}__`;
  const doneMarker = `__NOOBOT_DONE_${token}__`;
  const doneIndex = text.indexOf(doneMarker);
  if (doneIndex < 0) return null;
  const suffix = text.slice(doneIndex + doneMarker.length);
  const lineEnd = suffix.search(/\r?\n/);
  if (lineEnd < 0) return null;
  const code = Number.parseInt(suffix.slice(0, lineEnd).trim(), 10);
  const beginIndex = text.lastIndexOf(beginMarker, doneIndex);
  const bodyStart = beginIndex < 0 ? 0 : beginIndex + beginMarker.length;
  return {
    ok: code === 0,
    code: Number.isFinite(code) ? code : 1,
    stdout: text
      .slice(bodyStart, doneIndex)
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(/\r/g, "")
      .trim(),
  };
}

function runSshCommand(state, command = "", timeoutMs = SSH_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!state?.stream || !state?.ready) {
      reject(new Error("ssh shell not ready"));
      return;
    }
    let stdout = "";
    let stderr = "";
    const token = randomUUID();
    const stream = state.stream;
    let settled = false;
    let timer = null;
    const done = (result = null, error = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stream?.off("data", onStdout);
      stream?.stderr?.off?.("data", onStderr);
      if (error) reject(error);
      else resolve(result);
    };
    const onStdout = (chunk) => {
      stdout += String(chunk || "");
      const parsed = parseSshCommandOutput(stdout, token);
      if (!parsed) return;
      done({ ...parsed, stderr: String(stderr || "").trim() });
    };
    const onStderr = (chunk) => {
      stderr += String(chunk || "");
    };

    const effectiveTimeoutMs = Number(timeoutMs);
    timer = setTimeout(() => {
      done(null, new Error(`ssh command timeout after ${effectiveTimeoutMs}ms`));
      resetSshState(state.key, state);
    }, effectiveTimeoutMs);

    stream.on("data", onStdout);
    stream.stderr?.on?.("data", onStderr);
    try {
      stream.write(buildCommandEnvelope(command, token), (error) => {
        if (error) done(null, error);
      });
    } catch (error) {
      done(null, error);
    }
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
    const run = () => runSshCommand(state, cmd, conn.timeoutMs);
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

export function closeSshConnectorChannels({ connectorKey = "" } = {}) {
  const prefix = `${String(connectorKey || "").trim()}::`;
  if (prefix === "::") return 0;
  let closedCount = 0;
  for (const key of [...sshShellStates.keys()]) {
    if (!key.startsWith(prefix)) continue;
    resetSshState(key);
    closedCount += 1;
  }
  return closedCount;
}
