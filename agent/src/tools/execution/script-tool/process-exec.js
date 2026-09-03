/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { SCRIPT_EXECUTION_MODE } from "./constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { resolveCommandShell, TOOL_EXECUTION_VIEW } from "@noobot/execution-isolation-protocol";
import { resolveSessionGeneratedDataRoot } from "../../../session/session-generated-data.js";
import {
  decodeCommandOutput,
  resolveCommandLookupExecutable,
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";

const FOREGROUND_CAPTURE_BYTES = LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
const FOREGROUND_PREVIEW_BYTES = LENGTH_THRESHOLDS.semanticTransfer.previewChars;
const FORCE_KILL_GRACE_MS = TIME_THRESHOLDS.tools.processForceKillGraceMs;

function resolveOutputDir(sessionDir, kind) {
  return path.join(
    resolveSessionGeneratedDataRoot(sessionDir, kind),
    `${Date.now()}-${randomUUID()}`,
  );
}

function resolveProcessCommand(command) {
  if (command && typeof command === "object" && !Array.isArray(command)) {
    const executable = String(command.command || "").trim();
    if (!executable) throw new TypeError("process command executable is required");
    return {
      executable,
      args: Array.isArray(command.args) ? command.args.map(String) : [],
      shell: false,
    };
  }
  return {
    executable: String(command || ""),
    args: [],
    shell: resolveCommandShell({
      executionView: TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED,
      platform: process.platform,
    }),
  };
}

function spawnCommandProcess(command, cwd) {
  const processCommand = resolveProcessCommand(command);
  return spawn(processCommand.executable, processCommand.args, {
    cwd,
    shell: processCommand.shell,
    detached: usesDetachedProcessGroup(process.platform),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function normalizeCommandOutputFile(filePath) {
  const bytes = await readFile(filePath).catch(() => Buffer.alloc(0));
  if (!bytes.length) return;
  const text = decodeCommandOutput(bytes);
  const normalized = Buffer.from(text, "utf8");
  if (!normalized.equals(bytes)) await writeFile(filePath, normalized);
}

function appendCapture(chunks, chunk, state, maxBytes) {
  if (state.bytes >= maxBytes) return;
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const retained = bytes.subarray(0, Math.max(0, maxBytes - state.bytes));
  if (retained.length) chunks.push(retained);
  state.bytes += retained.length;
}

function createTerminationController(child, abortSignal, timeoutMs, onTerminate) {
  let timedOut = false;
  let aborted = abortSignal?.aborted === true;
  let forceKillTimer = null;
  let terminationHookCalled = false;
  const terminate = (reason = "timeout") => {
    if (reason === "timeout") timedOut = true;
    else aborted = true;
    if (!terminationHookCalled) {
      terminationHookCalled = true;
      Promise.resolve(onTerminate?.()).catch(() => undefined);
    }
    void terminateProcessTree(child, "SIGTERM");
    if (!forceKillTimer) {
      forceKillTimer = setTimeout(
        () => void terminateProcessTree(child, "SIGKILL"),
        FORCE_KILL_GRACE_MS,
      );
      forceKillTimer.unref?.();
    }
  };
  const onAbort = () => terminate("abort");
  abortSignal?.addEventListener?.("abort", onAbort, { once: true });
  if (aborted) terminate("abort");
  const timeout =
    Number(timeoutMs || 0) > 0 ? setTimeout(() => terminate("timeout"), Number(timeoutMs)) : null;
  return {
    get timedOut() {
      return timedOut;
    },
    get aborted() {
      return aborted;
    },
    get forceKillTimer() {
      return forceKillTimer;
    },
    timeout,
    onAbort,
    dispose() {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
    },
  };
}

export async function run(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const outputDir = resolveOutputDir(options?.generatedDataRoot, "executeScriptForeground");
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return new Promise((resolve) => {
    const child = spawnCommandProcess(cmd, cwd);
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutCapture = { bytes: 0 };
    const stderrCapture = { bytes: 0 };
    let spawnError = null;
    const termination = createTerminationController(
      child,
      abortSignal,
      timeoutMs,
      options?.onTerminate,
    );

    pipeReadableToWritable(child.stdout, stdoutStream, (chunk) =>
      appendCapture(stdoutChunks, chunk, stdoutCapture, FOREGROUND_CAPTURE_BYTES),
    );
    pipeReadableToWritable(child.stderr, stderrStream, (chunk) =>
      appendCapture(stderrChunks, chunk, stderrCapture, FOREGROUND_CAPTURE_BYTES),
    );
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      termination.dispose();
      await Promise.allSettled([stdoutFinished, stderrFinished]);
      await Promise.all([
        normalizeCommandOutputFile(stdoutPath),
        normalizeCommandOutputFile(stderrPath),
      ]);
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const stdoutBytes = Number(stdoutStat?.size || 0);
      const stderrBytes = Number(stderrStat?.size || 0);
      const outputOverflow =
        stdoutBytes > FOREGROUND_CAPTURE_BYTES || stderrBytes > FOREGROUND_CAPTURE_BYTES;
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stdout = decodeCommandOutput(
        outputOverflow ? stdoutBuffer.subarray(0, FOREGROUND_PREVIEW_BYTES) : stdoutBuffer,
      );
      const rawStderr = decodeCommandOutput(
        outputOverflow ? stderrBuffer.subarray(0, FOREGROUND_PREVIEW_BYTES) : stderrBuffer,
      );
      const fallbackStderr =
        spawnError?.message ||
        (termination.timedOut
          ? `command timed out after ${Number(timeoutMs)}ms`
          : termination.aborted
            ? "command aborted"
            : "");
      const resultCode =
        termination.timedOut || termination.aborted
          ? termination.timedOut
            ? 124
            : 130
          : Number.isFinite(Number(code))
            ? Number(code)
            : Number(spawnError?.code || 0) || 0;
      const result = {
        code: resultCode,
        stdout,
        stderr: rawStderr || fallbackStderr,
        ...(signal ? { signal } : {}),
        ...(outputOverflow
          ? {
              outputOverflow: true,
              stdoutPath,
              stderrPath,
              stdoutBytes,
              stderrBytes,
            }
          : {}),
      };
      if (!outputOverflow)
        await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      resolve(result);
    });
  });
}

export function normalizeExecutionMode(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase() === SCRIPT_EXECUTION_MODE.BACKGROUND
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

export async function runFileBacked(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const outputDir = resolveOutputDir(options?.generatedDataRoot, "executeScriptBackground");
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return await new Promise((resolve) => {
    const child = spawnCommandProcess(cmd, cwd);
    let spawnError = null;
    const termination = createTerminationController(
      child,
      abortSignal,
      timeoutMs,
      options?.onTerminate,
    );

    pipeReadableToWritable(child.stdout, stdoutStream);
    pipeReadableToWritable(child.stderr, stderrStream);
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      termination.dispose();
      try {
        await Promise.all([stdoutFinished, stderrFinished]);
      } catch (error) {
        spawnError ||= error;
      }
      if (spawnError || termination.timedOut || termination.aborted) {
        const fallbackMessage =
          spawnError?.message ||
          (termination.timedOut
            ? `command timed out after ${Number(timeoutMs)}ms`
            : "command aborted");
        const existingStderr = await readFile(stderrPath, "utf8").catch(() => "");
        if (!existingStderr) await writeFile(stderrPath, fallbackMessage, "utf8");
      }
      await Promise.all([
        normalizeCommandOutputFile(stdoutPath),
        normalizeCommandOutputFile(stderrPath),
      ]);
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const resultCode =
        termination.timedOut || termination.aborted
          ? termination.timedOut
            ? 124
            : 130
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
    const lookupCommand = resolveCommandLookupExecutable(process.platform);
    execFile(lookupCommand, [normalizedCommandName], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}
