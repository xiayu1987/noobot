/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createProcessTreeTerminator,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const DELETION_WORKER_BUDGET = Object.freeze({ startupMs: 60000, operationMs: 10000 });
const READY = "session-deletion.ready";
const START = "session-deletion.start";

export async function waitForDeletionStart() {
  assert.equal(typeof process.send, "function", "deletion worker requires IPC");
  const start = once(process, "message");
  process.send({ event: READY });
  const [message] = await start;
  assert.deepEqual(message, { event: START });
}

export async function runDeletionWorker(args, options, budget = DELETION_WORKER_BUDGET) {
  const { signal, ...spawnOptions } = options;
  signal?.throwIfAborted();
  const child = spawn(process.execPath, args, {
    ...spawnOptions,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: usesDetachedProcessGroup(),
    windowsHide: true,
  });
  const terminator = createProcessTreeTerminator(child, {
    graceMs: TIME_THRESHOLDS.tools.processForceKillGraceMs,
    settleMs: TIME_THRESHOLDS.tools.processSettleGraceMs,
    controlTimeoutMs: TIME_THRESHOLDS.tools.processControlTimeoutMs,
  });
  let output = "";
  let failure;
  let cleanupFailure;
  let stopping;
  const stopped = Promise.withResolvers();
  const stop = (error) => {
    failure ??= error;
    stopping ??= terminator.terminate().then(
      () => stopped.resolve(),
      (error) => {
        cleanupFailure = error;
        stopped.resolve();
      },
    );
  };
  const onAbort = () => stop(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  child.on("error", (error) => {
    failure = error;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
    });
  }
  const closed = new Promise((resolve) => child.once("close", (...result) => resolve(result)));
  const ready = new Promise((resolve) => child.once("message", resolve));
  let phase = "startup";
  const expire = () => {
    stop(new Error(`Deletion worker timed out during ${phase}`));
  };
  let timer = setTimeout(expire, budget.startupMs);
  try {
    const first = await Promise.race([
      ready.then((message) => ({ message })),
      closed.then((termination) => ({ termination })),
      stopped.promise,
    ]);
    if (failure) throw failure;
    assert.equal(
      first.termination,
      undefined,
      `Deletion worker exited before ready: ${JSON.stringify(first.termination)}\n${output}`,
    );
    assert.deepEqual(first.message, { event: READY });
    clearTimeout(timer);
    phase = "deletion";
    timer = setTimeout(expire, budget.operationMs);
    await new Promise((resolve, reject) =>
      child.send({ event: START }, (error) => (error ? reject(error) : resolve())),
    );
    const termination = await Promise.race([closed, stopped.promise]);
    if (failure) throw failure;
    return { termination, output };
  } catch (error) {
    error.message += `\nWorker output:\n${output}`;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (!stopping && child.exitCode === null && child.signalCode === null) {
      stop(new Error("Deletion worker cleanup interrupted an unfinished operation"));
    }
    await stopping;
    if (cleanupFailure) {
      throw new AggregateError([failure, cleanupFailure], "Deletion worker cleanup failed");
    }
    await closed;
  }
}
