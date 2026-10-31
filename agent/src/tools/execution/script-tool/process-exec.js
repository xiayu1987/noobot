/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { SCRIPT_EXECUTION_MODE } from "./constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  projectScriptOutcome,
  resolveCommandShell,
  resolveScriptTermination,
  TOOL_EXECUTION_VIEW,
} from "@noobot/execution-isolation-protocol";
import { resolveSessionGeneratedDataRoot } from "../../../session/session-generated-data.js";
import {
  decodeCommandOutput,
  resolveCommandLookupExecutable,
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";
import { isPlainObject, text } from "@noobot/shared/value";
import { previewTransferText } from "@noobot/semantic-transfer-protocol";

const FOREGROUND_INLINE_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
const FOREGROUND_PREVIEW_CHARS = LENGTH_THRESHOLDS.semanticTransfer.previewChars;
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
  if (isPlainObject(command)) {
    const executable = text(command.command);
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
  const bytes = await readFile(filePath);
  if (!bytes.length) return 0;
  const inputText = decodeCommandOutput(bytes);
  const normalized = Buffer.from(inputText, "utf8");
  if (!normalized.equals(bytes)) await writeFile(filePath, normalized);
  return inputText.length;
}

async function readOutputPreview(filePath, overflowed) {
  if (!overflowed) return readFile(filePath, "utf8");
  const file = await open(filePath, "r");
  try {
    const bytes = Buffer.alloc(FOREGROUND_PREVIEW_CHARS * 4);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead), {
      stream: true,
    });
    return previewTransferText(decoded, FOREGROUND_PREVIEW_CHARS);
  } finally {
    await file.close();
  }
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
  const [stdoutChars, stderrChars] = await Promise.all([
    normalizeCommandOutputFile(files.stdoutPath),
    normalizeCommandOutputFile(files.stderrPath),
  ]);
  const [stdoutStat, stderrStat] = await Promise.all([
    stat(files.stdoutPath),
    stat(files.stderrPath),
  ]);
  return {
    stdoutBytes: stdoutStat.size,
    stderrBytes: stderrStat.size,
    inlineOverflow: stdoutChars > FOREGROUND_INLINE_CHARS || stderrChars > FOREGROUND_INLINE_CHARS,
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
  if (spawnError) return spawnError.message;
  if (termination.outputLimitExceeded) {
    return `command output exceeded ${OUTPUT_ARTIFACT_MAX_BYTES} bytes`;
  }
  if (termination.timedOut) return `command timed out after ${timeoutMs}ms`;
  if (termination.aborted) return "command aborted";
  return undefined;
}

function resolveProcessOutcome({ termination, code, signal, spawnError, timeoutMs }) {
  const exitCode = spawnError || code === null ? null : code;
  const observedSignal = spawnError || !signal ? null : signal;
  const terminationKind = resolveScriptTermination({
    timedOut: termination.timedOut,
    aborted: termination.aborted,
    outputLimitExceeded: termination.outputLimitExceeded,
    spawnFailed: Boolean(spawnError),
    protocolViolated: false,
    exitCode,
    signal: observedSignal,
  });
  return projectScriptOutcome({
    termination: terminationKind,
    exitCode,
    signal: observedSignal,
    message: resolveTerminationMessage(termination, spawnError, timeoutMs),
  });
}

function pickOutputLimitFields(termination) {
  return termination.outputLimitExceeded
    ? { outputLimitExceeded: true, outputLimitBytes: OUTPUT_ARTIFACT_MAX_BYTES }
    : {};
}

export async function run(cmd, cwd, timeoutMs, abortSignal = null, options = {}) {
  const files = await openOutputFiles(options?.generatedDataRoot, "executeScriptForeground");
  return captureCommand({
    cmd,
    cwd,
    timeoutMs,
    abortSignal,
    options,
    files,
    project: projectInlineOutput,
  });
}

function captureCommand({ cmd, cwd, timeoutMs, abortSignal, options, files, project }) {
  return new Promise((resolve, reject) => {
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
        await Promise.all(files.finished);
        const sizes = await finalizeOutputFiles(files);
        const outcome = {
          ...resolveProcessOutcome({ termination, code, signal, spawnError, timeoutMs }),
          ...pickOutputLimitFields(termination),
        };
        return project(files, sizes, outcome);
      };
      void finalize().then(resolve, reject);
    }
    child.on("close", (code, signal) => settle(code, signal));
  });
}

async function projectInlineOutput(files, sizes, outcome) {
  const outputOverflow = sizes.inlineOverflow;
  const stdout = await readOutputPreview(files.stdoutPath, outputOverflow);
  const stderr = await readOutputPreview(files.stderrPath, outputOverflow);
  if (!outputOverflow) await rm(files.outputDir, { recursive: true, force: true });
  return {
    ...outcome,
    stdout,
    stderr,
    ...(outputOverflow ? { outputOverflow: true, ...projectFileOutput(files, sizes, {}) } : {}),
  };
}

function projectFileOutput(files, sizes, outcome) {
  return {
    ...outcome,
    stdoutPath: files.stdoutPath,
    stderrPath: files.stderrPath,
    stdoutBytes: sizes.stdoutBytes,
    stderrBytes: sizes.stderrBytes,
  };
}

export function normalizeExecutionMode(value = "") {
  return text(value).toLowerCase() === SCRIPT_EXECUTION_MODE.BACKGROUND
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
  return captureCommand({
    cmd,
    cwd,
    timeoutMs,
    abortSignal,
    options,
    files,
    project: projectFileOutput,
  });
}

const COMMAND_LOOKUP_NOT_FOUND_EXIT_CODE = 1;

export function hasCommand(commandName) {
  return new Promise((resolve, reject) => {
    const lookupCommand = resolveCommandLookupExecutable(process.platform);
    execFile(lookupCommand, [commandName], { windowsHide: true }, (error) => {
      if (!error) resolve(true);
      else if (error.code === COMMAND_LOOKUP_NOT_FOUND_EXIT_CODE) resolve(false);
      else reject(error);
    });
  });
}
