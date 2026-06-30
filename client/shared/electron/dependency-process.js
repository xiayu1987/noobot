/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

export function createDependencyProcessTools({ appendEarlyLog = () => {} } = {}) {
  function runProcess(command, args = [], { timeoutMs = 120000, env } = {}) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const commandLine = [command, ...args].join(" ");
      appendEarlyLog(`[process:start] ${commandLine}; timeoutMs=${timeoutMs}`);
      let settled = false;
      let child = null;
      let timer = null;
      let stdout = "";
      let stderr = "";
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        appendEarlyLog(`[process:finish] ${commandLine}; ok=${payload.ok}; code=${payload.code ?? ""}; elapsedMs=${Date.now() - startedAt}; error=${payload.error || ""}`);
        resolve(payload);
      };
      timer = setTimeout(() => {
        appendEarlyLog(`[process:timeout] ${commandLine}; killing child`);
        try { child?.kill(); } catch {}
        finish({ ok: false, code: -1, stdout, stderr, error: `Timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      try {
        child = spawn(command, args, { windowsHide: true, shell: false, env: env ? { ...process.env, ...env } : process.env });
      } catch (error) {
        finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
        return;
      }
      child.stdout?.on("data", (chunk) => { stdout += String(chunk || ""); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk || ""); });
      child.on("error", (error) => {
        finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
      });
      child.on("close", (code) => {
        finish({ ok: code === 0, code, stdout, stderr });
      });
    });
  }

  function hasExistingFile(filePath) {
    try {
      return Boolean(filePath) && fs.existsSync(filePath);
    } catch (error) {
      appendEarlyLog(`[fs:exists:error] path=${filePath || ""}; error=${error?.message || String(error)}`);
      return false;
    }
  }

  return { runProcess, hasExistingFile };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, timeoutMs, label, { appendEarlyLog = () => {} } = {}) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      appendEarlyLog(`[timeout] label=${label}; timeoutMs=${timeoutMs}`);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

export function createDependencyError(message, { failureKind = "local", retryable = false, cause } = {}) {
  const error = new Error(message);
  error.failureKind = failureKind;
  error.retryable = retryable === true;
  if (cause) error.cause = cause;
  return error;
}

export function getDependencyErrorMeta(error, defaults = {}) {
  return {
    failureKind: error?.failureKind || defaults.failureKind || "local",
    retryable: error?.retryable === true || defaults.retryable === true,
  };
}
