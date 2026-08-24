/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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

const sshClientStates = new Map();

function requireChannelKey(channelKey = "") {
  const key = String(channelKey || "").trim();
  if (!key) throw new TypeError("SSH connector channelKey is required");
  return key;
}

function resetSshState(key = "", expectedState = null) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const state = sshClientStates.get(normalizedKey);
  if (!state) return;
  if (expectedState && state !== expectedState) return;
  const failures = [];
  try {
    state?.client?.end?.();
  } catch (error) {
    failures.push(error);
  }
  sshClientStates.delete(normalizedKey);
  if (failures.length) throw new AggregateError(failures, "SSH channel cleanup failed");
}

async function ensureSshClientState({ channelKey = "", connectionInfo = {} } = {}) {
  const key = requireChannelKey(channelKey);
  const cached = sshClientStates.get(key);
  if (cached?.ready === true && cached?.client) {
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
    ready: false,
    queue: Promise.resolve(),
    lastUsedAt: Date.now(),
    readyPromise: null,
  };
  sshClientStates.set(key, state);
  state.readyPromise = new Promise((resolve, reject) => {
    const client = new Client();
    state.client = client;
    const fail = (error) => {
      resetSshState(key, state);
      reject(error);
    };
    client
      .on("ready", () => {
        state.ready = true;
        state.readyPromise = null;
        state.lastUsedAt = Date.now();
        resolve(state);
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

function runSshCommand(state, command = "", timeoutMs = SSH_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!state?.client || !state?.ready) {
      reject(new Error("ssh client not ready"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let stream = null;
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
    };
    const onStderr = (chunk) => {
      stderr += String(chunk || "");
    };

    const effectiveTimeoutMs = Number(timeoutMs);
    timer = setTimeout(() => {
      done(null, new Error(`ssh command timeout after ${effectiveTimeoutMs}ms`));
      resetSshState(state.key, state);
    }, effectiveTimeoutMs);

    try {
      state.client.exec(command, (error, nextStream) => {
        if (error) {
          done(null, error);
          return;
        }
        stream = nextStream;
        stream.on("data", onStdout);
        stream.stderr?.on?.("data", onStderr);
        stream.on("error", (streamError) => done(null, streamError));
        stream.on("close", (code, signal) => {
          const exitCode = Number.isInteger(code) ? code : 1;
          const signalMessage = signal ? `ssh command terminated by ${signal}` : "";
          done({
            ok: exitCode === 0,
            code: exitCode,
            stdout: stdout.trim(),
            stderr: [String(stderr || "").trim(), signalMessage].filter(Boolean).join("\n"),
          });
        });
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
    const state = await ensureSshClientState({
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
  if (!sshClientStates.has(key)) return false;
  resetSshState(key);
  return true;
}
