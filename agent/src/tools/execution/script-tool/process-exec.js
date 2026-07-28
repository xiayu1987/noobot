/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path } from "../../../shared/utils/path-resolver.js";
import { SCRIPT_EXECUTION_MODE } from "./constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const FOREGROUND_CAPTURE_BYTES = LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
const FOREGROUND_PREVIEW_BYTES = LENGTH_THRESHOLDS.semanticTransfer.previewChars;
const FORCE_KILL_GRACE_MS = TIME_THRESHOLDS.tools.processForceKillGraceMs;

function appendCapture(chunks, chunk, state, maxBytes) {
  if (state.bytes >= maxBytes) return;
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const retained = bytes.subarray(0, Math.max(0, maxBytes - state.bytes));
  if (retained.length) chunks.push(retained);
  state.bytes += retained.length;
}

export async function run(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const outputDir = path.join(cwd, ".execute-script-foreground", `${Date.now()}-${randomUUID()}`);
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutCapture = { bytes: 0 };
    const stderrCapture = { bytes: 0 };
    let spawnError = null;
    let timedOut = false;
    let aborted = abortSignal?.aborted === true;
    let forceKillTimer = null;
    let terminationHookCalled = false;
    const terminate = (reason = "timeout") => {
      if (reason === "timeout") timedOut = true;
      else aborted = true;
      if (!terminationHookCalled) {
        terminationHookCalled = true;
        Promise.resolve(options?.onTerminate?.()).catch(() => undefined);
      }
      terminateChild(child, "SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => terminateChild(child, "SIGKILL"), FORCE_KILL_GRACE_MS);
        forceKillTimer.unref?.();
      }
    };
    const onAbort = () => terminate("abort");
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    if (aborted) terminate("abort");
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => terminate("timeout"), Number(timeoutMs))
      : null;

    pipeReadableToWritable(child.stdout, stdoutStream, (chunk) =>
      appendCapture(stdoutChunks, chunk, stdoutCapture, FOREGROUND_CAPTURE_BYTES));
    pipeReadableToWritable(child.stderr, stderrStream, (chunk) =>
      appendCapture(stderrChunks, chunk, stderrCapture, FOREGROUND_CAPTURE_BYTES));
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      await Promise.allSettled([stdoutFinished, stderrFinished]);
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const stdoutBytes = Number(stdoutStat?.size || 0);
      const stderrBytes = Number(stderrStat?.size || 0);
      const outputOverflow = stdoutBytes > FOREGROUND_CAPTURE_BYTES || stderrBytes > FOREGROUND_CAPTURE_BYTES;
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stdout = (outputOverflow
        ? stdoutBuffer.subarray(0, FOREGROUND_PREVIEW_BYTES)
        : stdoutBuffer).toString("utf8");
      const rawStderr = (outputOverflow
        ? stderrBuffer.subarray(0, FOREGROUND_PREVIEW_BYTES)
        : stderrBuffer).toString("utf8");
      const fallbackStderr = spawnError?.message || (timedOut
        ? `command timed out after ${Number(timeoutMs)}ms`
        : aborted ? "command aborted" : "");
      const resultCode = timedOut || aborted
        ? timedOut ? 124 : 130
        : Number.isFinite(Number(code))
          ? Number(code)
          : Number(spawnError?.code || 0) || 0;
      const result = {
        code: resultCode,
        stdout,
        stderr: rawStderr || fallbackStderr,
        ...(signal ? { signal } : {}),
        ...(outputOverflow ? {
          outputOverflow: true,
          stdoutPath,
          stderrPath,
          stdoutBytes,
          stderrBytes,
        } : {}),
      };
      if (!outputOverflow) await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      resolve(result);
    });
  });
}

export function normalizeExecutionMode(value = "") {
  return String(value || "").trim().toLowerCase() === SCRIPT_EXECUTION_MODE.BACKGROUND
    ? SCRIPT_EXECUTION_MODE.BACKGROUND
    : SCRIPT_EXECUTION_MODE.FOREGROUND;
}

function waitForWritableFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });
}

function pipeReadableToWritable(readable, writable, onChunk = null) {
  if (!readable) {
    writable.end();
    return;
  }
  readable.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    onChunk?.(bytes);
    if (writable.write(bytes) === false) {
      readable.pause();
    }
  });
  writable.on("drain", () => readable.resume());
  readable.on("end", () => writable.end());
  readable.on("error", (error) => writable.destroy(error));
}

function terminateChild(child, signal = "SIGTERM") {
  if (!child) return;
  if (process.platform !== "win32" && Number.isFinite(Number(child.pid))) {
    try {
      process.kill(-Number(child.pid), signal);
      return;
    } catch {
    }
  }
  child.kill(signal);
}

export async function runFileBacked(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const outputDir = path.join(cwd, ".execute-script-background", `${Date.now()}-${randomUUID()}`);
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return await new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError = null;
    let timedOut = false;
    let aborted = abortSignal?.aborted === true;
    let forceKillTimer = null;
    let terminationHookCalled = false;
    const terminate = (reason = "timeout") => {
      if (reason === "timeout") timedOut = true;
      else aborted = true;
      if (!terminationHookCalled) {
        terminationHookCalled = true;
        Promise.resolve(options?.onTerminate?.()).catch(() => undefined);
      }
      terminateChild(child, "SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => terminateChild(child, "SIGKILL"), FORCE_KILL_GRACE_MS);
        forceKillTimer.unref?.();
      }
    };
    const onAbort = () => terminate("abort");
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    if (aborted) terminate("abort");
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => terminate("timeout"), Number(timeoutMs))
      : null;

    pipeReadableToWritable(child.stdout, stdoutStream);
    pipeReadableToWritable(child.stderr, stderrStream);
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      try {
        await Promise.all([stdoutFinished, stderrFinished]);
      } catch {
      }
      if (spawnError || timedOut || aborted) {
        const fallbackMessage = spawnError?.message || (timedOut
          ? `command timed out after ${Number(timeoutMs)}ms`
          : "command aborted");
        const existingStderr = await readFile(stderrPath, "utf8").catch(() => "");
        if (!existingStderr) await writeFile(stderrPath, fallbackMessage, "utf8");
      }
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const resultCode = timedOut || aborted
        ? timedOut ? 124 : 130
        : Number.isFinite(Number(code))
          ? Number(code)
          : Number(spawnError?.code || 0) || 0;
      resolve({
        code: resultCode,
        ...(signal ? { signal } : {}),
        stdoutPath,
        stderrPath,
        stdoutBytes: Number(stdoutStat?.size || 0),
        stderrBytes: Number(stderrStat?.size || 0),
      });
    });
  });
}

export function hasCommand(commandName = "") {
  return new Promise((resolve) => {
    const normalizedCommandName = String(commandName || "").trim();
    if (!normalizedCommandName) {
      resolve(false);
      return;
    }
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    execFile(lookupCommand, [normalizedCommandName], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}
