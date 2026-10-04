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
import { SCRIPT_EXECUTION_MODE, SCRIPT_RESULT_CODE } from "./constants.js";
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
const OUTPUT_ARTIFACT_MAX_BYTES = LENGTH_THRESHOLDS.attachments.maxFileSizeBytes;
const FORCE_KILL_GRACE_MS = TIME_THRESHOLDS.tools.processForceKillGraceMs;
const SETTLE_GRACE_MS = TIME_THRESHOLDS.tools.processSettleGraceMs;

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

function createTerminationController(child, abortSignal, timeoutMs, onTerminate, onSettle) {
  let timedOut = false;
  let aborted = abortSignal?.aborted === true;
  let outputLimitExceeded = false;
  let terminalReason = "";
  let forceKillTimer = null;
  let settleTimer = null;
  let terminationHookCalled = false;
  const terminate = (reason = "timeout") => {
    if (terminalReason) return;
    terminalReason = reason;
    if (reason === "timeout") timedOut = true;
    else if (reason === "abort") aborted = true;
    else if (reason === "output_limit") outputLimitExceeded = true;
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
    if (!settleTimer && typeof onSettle === "function") {
      settleTimer = setTimeout(() => onSettle(), FORCE_KILL_GRACE_MS + SETTLE_GRACE_MS);
      settleTimer.unref?.();
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
    get outputLimitExceeded() {
      return outputLimitExceeded;
    },
    get forceKillTimer() {
      return forceKillTimer;
    },
    timeout,
    onAbort,
    terminate,
    dispose() {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settleTimer) clearTimeout(settleTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
    },
  };
}

async function openOutputFiles(sessionDir, kind) {
  const outputDir = resolveOutputDir(sessionDir, kind);
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  return {
    outputDir,
    stdoutPath,
    stderrPath,
    stdoutStream,
    stderrStream,
    streams: [stdoutStream, stderrStream],
    finished: [waitForWritableFinished(stdoutStream), waitForWritableFinished(stderrStream)],
  };
}

async function finalizeOutputFiles(files) {
  await Promise.all([
    normalizeCommandOutputFile(files.stdoutPath),
    normalizeCommandOutputFile(files.stderrPath),
  ]);
  const stdoutStat = await stat(files.stdoutPath).catch(() => ({ size: 0 }));
  const stderrStat = await stat(files.stderrPath).catch(() => ({ size: 0 }));
  return {
    stdoutBytes: Number(stdoutStat?.size || 0),
    stderrBytes: Number(stderrStat?.size || 0),
  };
}

function startTermination(child, files, abortSignal, timeoutMs, options, onSettle) {
  const termination = createTerminationController(
    child,
    abortSignal,
    timeoutMs,
    options?.onTerminate,
    () => {
      detachChildOutput(child, files.streams);
      onSettle();
    },
  );
  const outputPipeOptions = {
    maxBytes: OUTPUT_ARTIFACT_MAX_BYTES,
    onLimit: () => termination.terminate("output_limit"),
  };
  return { termination, outputPipeOptions };
}

function resolveTerminationMessage(termination, spawnError, timeoutMs) {
  if (spawnError?.message) return spawnError.message;
  if (termination.outputLimitExceeded) {
    return `command output exceeded ${OUTPUT_ARTIFACT_MAX_BYTES} bytes`;
  }
  if (termination.timedOut) return `command timed out after ${Number(timeoutMs)}ms`;
  return termination.aborted ? "command aborted" : "";
}

function resolveResultCode(termination, code, spawnError) {
  if (termination.outputLimitExceeded) return SCRIPT_RESULT_CODE.OUTPUT_LIMIT_EXCEEDED;
  if (termination.timedOut) return 124;
  if (termination.aborted) return 130;
  if (Number.isFinite(Number(code))) return Number(code);
  return Number(spawnError?.code || 0) || 0;
}

function pickOutputLimitFields(termination) {
  return termination.outputLimitExceeded
    ? { outputLimitExceeded: true, outputLimitBytes: OUTPUT_ARTIFACT_MAX_BYTES }
    : {};
}

export async function run(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const files = await openOutputFiles(options?.generatedDataRoot, "executeScriptForeground");

  return new Promise((resolve, reject) => {
    const child = spawnCommandProcess(cmd, cwd);
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutCapture = { bytes: 0 };
    const stderrCapture = { bytes: 0 };
    let spawnError = null;
    let settled = false;
    const { termination, outputPipeOptions } = startTermination(
      child,
      files,
      abortSignal,
      timeoutMs,
      options,
      () => settle(null, null),
    );
    pipeReadableToWritable(
      child.stdout,
      files.stdoutStream,
      (chunk) => appendCapture(stdoutChunks, chunk, stdoutCapture, FOREGROUND_CAPTURE_BYTES),
      outputPipeOptions,
    );
    pipeReadableToWritable(
      child.stderr,
      files.stderrStream,
      (chunk) => appendCapture(stderrChunks, chunk, stderrCapture, FOREGROUND_CAPTURE_BYTES),
      outputPipeOptions,
    );
    child.on("error", (error) => {
      spawnError = error;
    });
    function settle(code, signal) {
      if (settled) return;
      settled = true;
      const finalize = async () => {
        termination.dispose();
        detachChildOutput(child, files.streams);
        await Promise.allSettled(files.finished);
        const { stdoutBytes, stderrBytes } = await finalizeOutputFiles(files);
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
        const result = {
          code: resolveResultCode(termination, code, spawnError),
          stdout,
          stderr: rawStderr || resolveTerminationMessage(termination, spawnError, timeoutMs),
          ...(signal ? { signal } : {}),
          ...pickOutputLimitFields(termination),
          ...(outputOverflow
            ? {
                outputOverflow: true,
                stdoutPath: files.stdoutPath,
                stderrPath: files.stderrPath,
                stdoutBytes,
                stderrBytes,
              }
            : {}),
        };
        if (!outputOverflow)
          await rm(files.outputDir, { recursive: true, force: true }).catch(() => undefined);
        return result;
      };
      void finalize().then(resolve, reject);
    }
    child.on("close", (code, signal) => settle(code, signal));
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
    stream.once("close", resolve);
    stream.once("error", reject);
  });
}

function detachChildOutput(child, streams) {
  for (const readable of [child?.stdout, child?.stderr]) {
    if (readable && !readable.destroyed) readable.destroy();
  }
  for (const writable of streams) {
    if (writable && !writable.writableEnded && !writable.destroyed) writable.end();
  }
}

function pipeReadableToWritable(readable, writable, onChunk = null, options = {}) {
  if (!readable) {
    writable.end();
    return;
  }
  const maxBytes = Math.max(0, Number(options?.maxBytes || 0));
  let writtenBytes = 0;
  let limitExceeded = false;
  readable.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    onChunk?.(bytes);
    const remainingBytes = maxBytes > 0 ? Math.max(0, maxBytes - writtenBytes) : bytes.length;
    const retained = maxBytes > 0 ? bytes.subarray(0, remainingBytes) : bytes;
    writtenBytes += retained.length;
    if (retained.length < bytes.length && !limitExceeded) {
      limitExceeded = true;
      options?.onLimit?.();
    }
    if (retained.length > 0 && writable.write(retained) === false) {
      readable.pause();
    }
  });
  writable.on("drain", () => readable.resume());
  readable.on("end", () => writable.end());
  readable.on("error", (error) => writable.destroy(error));
}

export async function runFileBacked(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const files = await openOutputFiles(options?.generatedDataRoot, "executeScriptBackground");

  return await new Promise((resolve, reject) => {
    const child = spawnCommandProcess(cmd, cwd);
    let spawnError = null;
    let settled = false;
    const { termination, outputPipeOptions } = startTermination(
      child,
      files,
      abortSignal,
      timeoutMs,
      options,
      () => settle(null, null),
    );
    pipeReadableToWritable(child.stdout, files.stdoutStream, null, outputPipeOptions);
    pipeReadableToWritable(child.stderr, files.stderrStream, null, outputPipeOptions);
    child.on("error", (error) => {
      spawnError = error;
    });
    function settle(code, signal) {
      if (settled) return;
      settled = true;
      const finalize = async () => {
        termination.dispose();
        detachChildOutput(child, files.streams);
        try {
          await Promise.all(files.finished);
        } catch (error) {
          spawnError ||= error;
        }
        if (
          spawnError ||
          termination.outputLimitExceeded ||
          termination.timedOut ||
          termination.aborted
        ) {
          const fallbackMessage =
            resolveTerminationMessage(termination, spawnError, timeoutMs) || "command aborted";
          const existingStderr = await readFile(files.stderrPath, "utf8").catch(() => "");
          if (!existingStderr) await writeFile(files.stderrPath, fallbackMessage, "utf8");
        }
        const { stdoutBytes, stderrBytes } = await finalizeOutputFiles(files);
        return {
          code: resolveResultCode(termination, code, spawnError),
          ...(signal ? { signal } : {}),
          ...pickOutputLimitFields(termination),
          stdoutPath: files.stdoutPath,
          stderrPath: files.stderrPath,
          stdoutBytes,
          stderrBytes,
        };
      };
      void finalize().then(resolve, reject);
    }
    child.on("close", (code, signal) => settle(code, signal));
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
