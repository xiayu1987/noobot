/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

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
  const child = spawn(process.execPath, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    killSignal: "SIGKILL",
  });
  let output = "";
  let failure;
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
    failure = new Error(`Deletion worker timed out during ${phase}`);
    child.kill("SIGKILL");
  };
  let timer = setTimeout(expire, budget.startupMs);
  try {
    const first = await Promise.race([
      ready.then((message) => ({ message })),
      closed.then((termination) => ({ termination })),
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
    const termination = await closed;
    if (failure) throw failure;
    return { termination, output };
  } catch (error) {
    error.message += `\nWorker output:\n${output}`;
    throw error;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
}
