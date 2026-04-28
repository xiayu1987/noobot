/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveSshConnection(connectionInfo = {}) {
  const source =
    connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  return {
    host: String(source?.host || source?.ip || "").trim(),
    port: Math.max(1, Number(source?.port || 22)),
    username: String(source?.username || source?.user || "").trim(),
    password: String(source?.password || "").trim(),
    timeoutMs: Math.max(
      1000,
      Number(source?.timeout_ms || source?.timeoutMs || 30000),
    ),
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

function buildChannelKey({
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const explicit = String(channelKey || "").trim();
  if (explicit) return explicit;
  const sid = String(sessionId || "").trim();
  const name = String(connectorName || "").trim();
  return `${sid}::${name}`;
}

function resetSshState(key = "") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const state = sshShellStates.get(normalizedKey);
  if (!state) return;
  try {
    state?.stream?.end?.();
  } catch {
    // ignore
  }
  try {
    state?.client?.end?.();
  } catch {
    // ignore
  }
  sshShellStates.delete(normalizedKey);
}

async function ensureSshShellState({
  channelKey = "",
  sessionId = "",
  connectorName = "",
  connectionInfo = {},
} = {}) {
  const key = buildChannelKey({ channelKey, sessionId, connectorName });
  if (!key) throw new Error("ssh channel key required");
  const cached = sshShellStates.get(key);
  if (cached?.ready === true && cached?.stream && cached?.client) {
    return cached;
  }
  if (cached?.readyPromise) {
    return cached.readyPromise;
  }

  const conn = resolveSshConnection(connectionInfo);
  if (!conn.host || !conn.username || !conn.password) {
    throw new Error("ssh host/username/password required");
  }

  const ssh2 = await importSsh2();
  const Client = ssh2?.Client;
  if (typeof Client !== "function") {
    throw new Error("ssh2 not installed, run: npm i ssh2");
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

function runSshShellCommand(state, command = "", timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!state?.stream || !state?.ready) {
      reject(new Error("ssh shell not ready"));
      return;
    }
    const marker = `__NOOBOT_DONE_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}__`;
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

    const timer = setTimeout(() => {
      done(null, new Error(`ssh command timeout after ${timeoutMs}ms`));
    }, Math.max(1000, Number(timeoutMs || 30000)));

    stream.write(buildCommandEnvelope(command, marker), (error) => {
      if (error) done(null, error);
    });
  });
}

export async function executeSshCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return { ok: false, code: 400, stdout: "", stderr: "ssh command required" };
  }

  try {
    const conn = resolveSshConnection(connectionInfo);
    const state = await ensureSshShellState({
      channelKey,
      sessionId,
      connectorName,
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

export function closeSshChannel({
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const key = buildChannelKey({ channelKey, sessionId, connectorName });
  if (!key) return false;
  if (!sshShellStates.has(key)) return false;
  resetSshState(key);
  return true;
}
