/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { createProcessTreeTerminator, terminateProcessTree } from "../src/process.js";

test("Windows termination propagates failures unless the target has already exited", async () => {
  const failure = Object.assign(new Error("taskkill denied"), { code: 1 });
  const options = {
    platform: "win32",
    execFileImpl: (...args) => args[3](failure),
    processKill: () => {},
  };
  await assert.rejects(terminateProcessTree({ pid: 42 }, "SIGTERM", options), failure);
  await assert.rejects(
    terminateProcessTree({ pid: 42 }, "SIGTERM", {
      ...options,
      processKill: () => {
        throw Object.assign(new Error("access denied"), { code: "EPERM" });
      },
    }),
    failure,
  );
  await terminateProcessTree({ pid: 42 }, "SIGTERM", {
    ...options,
    processKill: () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  });
});

test("a process group termination failure cannot become a direct-child termination", async () => {
  const failure = Object.assign(new Error("group denied"), { code: "EPERM" });
  let directKills = 0;
  await assert.rejects(
    terminateProcessTree({ pid: 43, kill: () => directKills++ }, "SIGTERM", {
      platform: "linux",
      processKill: () => {
        throw failure;
      },
    }),
    failure,
  );
  assert.equal(directKills, 0);
});

test("termination waits for both child closure and the external cleanup hook", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 44 });
  let releaseHook;
  let calls = 0;
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 100,
    settleMs: 100,
    onTerminate: () =>
      new Promise((resolve) => {
        releaseHook = resolve;
      }),
    terminateProcess: async () => {
      calls++;
      child.emit("close");
    },
  });
  const pending = terminator.terminate();
  assert.equal(terminator.terminate(), pending);
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseHook();
  await pending;
  terminator.dispose();
  assert.equal(calls, 1);
  assert.equal(child.listenerCount("close"), 0);
});

test("termination recognizes child exit while inherited output pipes remain open", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 47 });
  const signals = [];
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 1,
    settleMs: 100,
    terminateProcess: async (_child, signal) => {
      signals.push(signal);
      if (signal === "SIGTERM") child.emit("exit", null, signal);
    },
  });
  await terminator.terminate();
  terminator.dispose();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
});

test("termination escalates and reports a process that never closes", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 45 });
  const signals = [];
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 1,
    settleMs: 1,
    terminateProcess: async (_, signal) => {
      signals.push(signal);
    },
  });
  await assert.rejects(terminator.terminate(), /did not exit after forced termination/);
  await assert.rejects(terminator.wait(), /did not exit after forced termination/);
  terminator.dispose();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("termination preserves hook failures after completing process cleanup", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 46 });
  const failure = new Error("external cleanup failed");
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 100,
    settleMs: 100,
    onTerminate: () => {
      throw failure;
    },
    terminateProcess: async () => {
      child.emit("close");
    },
  });
  await assert.rejects(terminator.terminate(), failure);
  terminator.dispose();
});

test(
  "native Windows termination leaves no live grandchild",
  {
    skip: process.platform !== "win32",
    timeout: 15000,
  },
  async (t) => {
    const source = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'process.send(process.pid); setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    child.once('message', pid => process.send(pid));
    setInterval(() => {}, 1000);
  `;
    const child = spawn(process.execPath, ["-e", source], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    t.after(() => terminateProcessTree(child, "SIGKILL"));
    const [grandchildPid] = await once(child, "message");
    t.after(() => terminateProcessTree({ pid: grandchildPid }, "SIGKILL"));
    const terminator = createProcessTreeTerminator(child, { graceMs: 1000, settleMs: 1000 });
    await terminator.terminate();
    terminator.dispose();
    for (const pid of [child.pid, grandchildPid]) {
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  },
);
