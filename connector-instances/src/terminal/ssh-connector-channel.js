/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import {
  commandOutput,
  connectorFailure,
  errorMessage,
  loadDriverModule,
} from "../channel-result.js";

const SSH_COMMAND_TIMEOUT_MS = 30000;

const SSH_DEFAULT_PORT = 22;

function resolveSshConnection(connectionInfo) {
  if (!isPlainObject(connectionInfo)) {
    throw new TypeError("ssh connector connectionInfo must be an object");
  }
  const source = connectionInfo;
  return {
    host: text(source.host),
    port: source.port === undefined || source.port === "" ? SSH_DEFAULT_PORT : Number(source.port),
    username: text(source.username),
    password: source.password === undefined ? "" : String(source.password),
    timeoutMs: SSH_COMMAND_TIMEOUT_MS,
  };
}

const sshShellStates = new Map();

function requireChannelKey(channelKey = "") {
  const key = text(channelKey);
  if (!key) throw new TypeError("SSH connector channelKey is required");
  return key;
}

function resetSshState(key = "", expectedState = null) {
  const normalizedKey = text(key);
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

async function ensureSshShellState({ channelKey, conn, Client }) {
  const key = requireChannelKey(channelKey);
  const cached = sshShellStates.get(key);
  if (cached?.ready === true && cached?.client && cached?.stream) {
    return cached;
  }
  if (cached?.readyPromise) {
    return cached.readyPromise;
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

export function parseSshCommandOutput(raw, token) {
  const beginMarker = `__NOOBOT_BEGIN_${token}__`;
  const doneMarker = `__NOOBOT_DONE_${token}__`;
  const doneIndex = raw.indexOf(doneMarker);
  if (doneIndex < 0) return null;
  const suffix = raw.slice(doneIndex + doneMarker.length);
  const lineEnd = suffix.search(/\r?\n/);
  if (lineEnd < 0) return null;
  const exitText = suffix.slice(0, lineEnd).trim();
  if (!/^\d+$/.test(exitText)) {
    throw new TypeError(`ssh command envelope exit code is invalid: ${exitText}`);
  }
  const beginIndex = raw.lastIndexOf(beginMarker, doneIndex);
  const bodyStart = beginIndex < 0 ? 0 : beginIndex + beginMarker.length;
  return {
    exitCode: Number(exitText),
    stdout: raw
      .slice(bodyStart, doneIndex)
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(/\r/g, "")
      .trim(),
  };
}

function runSshCommand(state, command, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!state.stream || !state.ready) {
      reject(new Error("ssh shell not ready"));
      return;
    }
    let stdout = "";
    let stderr = "";
    const token = randomUUID();
    const stream = state.stream;
    let settled = false;
    let timer = null;
    const done = (result, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stream.off("data", onStdout);
      stream.stderr.off("data", onStderr);
      if (error) reject(error);
      else resolve(result);
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      let parsed = null;
      try {
        parsed = parseSshCommandOutput(stdout, token);
      } catch (error) {
        done(null, error);
        return;
      }
      if (!parsed) return;
      done({ ...parsed, stderr: stderr.trim() });
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };

    timer = setTimeout(() => {
      done(null, new Error(`ssh command timeout after ${timeoutMs}ms`));
      resetSshState(state.key, state);
    }, timeoutMs);

    stream.on("data", onStdout);
    stream.stderr.on("data", onStderr);
    try {
      stream.write(buildCommandEnvelope(command, token), (error) => {
        if (error) done(null, error);
      });
    } catch (error) {
      done(null, error);
    }
  });
}

function sshCommandResult({ exitCode, stdout, stderr }) {
  const output = { stdout, stderr, exitCode };
  if (exitCode === 0) return commandOutput(output);
  return connectorFailure(
    CONNECTOR_FAILURE_CODE.EXECUTION_FAILED,
    `ssh command exited with code ${exitCode}`,
    output,
  );
}

export async function executeSshCommand({ command, connectionInfo, channelKey }) {
  const cmd = text(command);
  if (!cmd) return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "ssh command required");
  const conn = resolveSshConnection(connectionInfo);
  if (!conn.host || !conn.username || !conn.password) {
    return connectorFailure(
      CONNECTOR_FAILURE_CODE.CONFIG_INVALID,
      "SSH host, username and password are required",
    );
  }
  const loaded = await loadDriverModule("ssh2");
  if (!loaded.ok) return loaded.failure;
  try {
    const state = await ensureSshShellState({ channelKey, conn, Client: loaded.driver.Client });
    state.lastUsedAt = Date.now();
    const run = () => runSshCommand(state, cmd, conn.timeoutMs);
    state.queue = state.queue.then(run, run);
    const result = await state.queue;
    state.lastUsedAt = Date.now();
    return sshCommandResult(result);
  } catch (error) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.EXECUTION_FAILED, errorMessage(error));
  }
}

export function closeSshChannel({ channelKey = "" } = {}) {
  const key = requireChannelKey(channelKey);
  if (!sshShellStates.has(key)) return false;
  resetSshState(key);
  return true;
}

export function closeSshConnectorChannels({ connectorKey = "" } = {}) {
  const prefix = `${text(connectorKey)}::`;
  if (prefix === "::") return 0;
  let closedCount = 0;
  for (const key of [...sshShellStates.keys()]) {
    if (!key.startsWith(prefix)) continue;
    resetSshState(key);
    closedCount += 1;
  }
  return closedCount;
}
