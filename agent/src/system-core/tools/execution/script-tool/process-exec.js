/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path } from "../../../utils/path-resolver.js";
import { SCRIPT_EXECUTION_MODE } from "./constants.js";

export function run(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    // cross-platform-allow: preserve previous exec(command) shell semantics for this tool
    const child = spawn(cmd, {
      cwd,
      shell: true,
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let spawnError = null;
    let timedOut = false;
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => {
        timedOut = true;
        // cross-platform-allow: Node child.kill handles Windows direct-child termination
        child.kill("SIGTERM");
      }, Number(timeoutMs))
      : null;

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
      const fallbackStderr = spawnError?.message || (timedOut ? `command timed out after ${Number(timeoutMs)}ms` : "");
      const resultCode = Number.isFinite(Number(code))
        ? Number(code)
        : timedOut
          ? 124
          : Number(spawnError?.code || 0) || 0;
      resolve({
        code: resultCode,
        stdout,
        stderr: rawStderr || fallbackStderr,
        ...(signal ? { signal } : {}),
      });
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

function pipeReadableToWritable(readable, writable) {
  if (!readable) {
    writable.end();
    return;
  }
  readable.on("data", (chunk) => {
    if (writable.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) === false) {
      readable.pause();
    }
  });
  writable.on("drain", () => readable.resume());
  readable.on("end", () => writable.end());
  readable.on("error", (error) => writable.destroy(error));
}

function terminateChild(child) {
  if (!child) return;
  if (process.platform !== "win32" && Number.isFinite(Number(child.pid))) {
    try {
      process.kill(-Number(child.pid), "SIGTERM");
      return;
    } catch {
      // Fall back to killing the direct shell process.
    }
  }
  // cross-platform-allow: fallback direct-child termination uses Node's cross-platform kill shim
  child.kill("SIGTERM");
}

export async function runFileBacked(cmd, cwd, timeoutMs) {
  const outputDir = path.join(cwd, ".execute-script-background", `${Date.now()}-${randomUUID()}`);
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return await new Promise((resolve) => {
    // cross-platform-allow: background mode also preserves shell command semantics
    const child = spawn(cmd, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError = null;
    let timedOut = false;
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => {
        timedOut = true;
        terminateChild(child);
      }, Number(timeoutMs))
      : null;

    pipeReadableToWritable(child.stdout, stdoutStream);
    pipeReadableToWritable(child.stderr, stderrStream);
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      if (timeout) clearTimeout(timeout);
      try {
        await Promise.all([stdoutFinished, stderrFinished]);
      } catch {
        // Keep script results recoverable; stderr fallback below carries process-level failures.
      }
      if (spawnError || timedOut) {
        const fallbackMessage = spawnError?.message || `command timed out after ${Number(timeoutMs)}ms`;
        const existingStderr = await readFile(stderrPath, "utf8").catch(() => "");
        if (!existingStderr) await writeFile(stderrPath, fallbackMessage, "utf8");
      }
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const resultCode = Number.isFinite(Number(code))
        ? Number(code)
        : timedOut
          ? 124
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
