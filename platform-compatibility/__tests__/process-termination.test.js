/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { promisify } from "node:util";
import { createProcessTreeTerminator, terminateProcessTree } from "../src/process.js";

test("Windows termination propagates process snapshot failures", async () => {
  const failure = Object.assign(new Error("taskkill denied"), { code: 1 });
  const options = {
    graceMs: 100,
    settleMs: 100,
    platform: "win32",
    execFileImpl: (...args) => args[3](failure),
    processKill: () => {},
  };
  await assert.rejects(terminateProcessTree(42, options), failure);
});

test("a process group termination failure cannot become a direct-child termination", async () => {
  const failure = Object.assign(new Error("group denied"), { code: "EPERM" });
  const calls = [];
  await assert.rejects(
    terminateProcessTree(43, {
      graceMs: 100,
      settleMs: 100,
      platform: "linux",
      processKill: (pid, signal) => {
        calls.push([pid, signal]);
        throw failure;
      },
    }),
    failure,
  );
  assert.deepEqual(calls, [[-43, "SIGTERM"]]);
});

test("termination waits for both process tree removal and the external cleanup hook", async () => {
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
    terminateProcess: async (pid, options) => {
      assert.equal(pid, 44);
      assert.deepEqual(options, { graceMs: 100, settleMs: 100 });
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
  assert.equal(calls, 1);
  assert.equal(child.listenerCount("close"), 0);
});

test("termination does not require child output pipes to close", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 47 });
  const calls = [];
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 1,
    settleMs: 100,
    terminateProcess: async (pid, options) => {
      calls.push([pid, options]);
      child.emit("exit", null, "SIGTERM");
    },
  });
  await terminator.terminate();
  assert.deepEqual(calls, [[47, { graceMs: 1, settleMs: 100 }]]);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
});

test("termination preserves process tree cleanup failures", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 45 });
  const failure = new Error("process tree still alive");
  const terminator = createProcessTreeTerminator(child, {
    graceMs: 1,
    settleMs: 1,
    terminateProcess: async () => {
      throw failure;
    },
  });
  await assert.rejects(terminator.terminate(), failure);
  await assert.rejects(terminator.wait(), failure);
});

test("failed termination can retry while wait preserves the previous failure", async () => {
  const failure = new Error("cleanup denied");
  let calls = 0;
  const terminator = createProcessTreeTerminator(
    { pid: 49 },
    {
      graceMs: 0,
      settleMs: 100,
      terminateProcess: async () => {
        if (++calls === 1) throw failure;
      },
    },
  );
  const first = terminator.terminate();
  await assert.rejects(first, failure);
  assert.equal(terminator.wait(), first);
  await assert.rejects(terminator.wait(), failure);
  const second = terminator.terminate();
  assert.notEqual(second, first);
  assert.equal(terminator.terminate(), second);
  await second;
  assert.equal(calls, 2);
});

test("Windows termination finds descendants after the parent exits and retains them for retry", async () => {
  let alive = [{ pid: 510, parentPid: 500, started: "20261126000000.000000+000" }];
  const failure = new Error("termination denied");
  let denied = true;
  const calls = [];
  const options = {
    graceMs: 0,
    settleMs: 1000,
    platform: "win32",
    execFileImpl: (command, args, settings, done) => {
      assert.equal(command, "powershell.exe");
      const script = args.at(-1);
      if (script.includes("SELECT ProcessId")) return done(null, JSON.stringify(alive));
      calls.push(script);
      if (denied) return done(failure);
      alive = [];
      done(null, "");
    },
    processKill: () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  };
  await assert.rejects(terminateProcessTree(500, options), failure);
  alive[0].parentPid = 999;
  denied = false;
  await terminateProcessTree(500, options);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((script) => script.includes("ProcessId = 510")));
});

test("Windows exit confirmation starts after discovery and forced termination", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const calls = [];
  const entry = { pid: 520, parentPid: 1, started: "20261126000000.000000+000" };
  await terminateProcessTree(520, {
    graceMs: 0,
    settleMs: 100,
    platform: "win32",
    execFileImpl: (command, args, options, done) => {
      calls.push(options.timeout);
      if (options.timeout < 80) return done(new Error("Control command timed out"));
      clock += 80;
      const entries = calls.length === 1 ? [entry] : [];
      done(null, args.at(-1).includes("SELECT ProcessId") ? JSON.stringify(entries) : "");
    },
  });
  assert.deepEqual(calls, [100, 100, 100]);
});

test("Windows exit confirmation deadline is not renewed while a process survives", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const entry = { pid: 521, parentPid: 1, started: "20261126000000.000000+000" };
  await assert.rejects(
    terminateProcessTree(521, {
      graceMs: 0,
      settleMs: 100,
      platform: "win32",
      execFileImpl: (command, args, options, done) => {
        clock += 60;
        done(null, args.at(-1).includes("SELECT ProcessId") ? JSON.stringify([entry]) : "");
      },
    }),
    /did not exit after forced termination/,
  );
  await terminateProcessTree(521, {
    graceMs: 0,
    settleMs: 100,
    platform: "win32",
    execFileImpl: (command, args, options, done) => done(null, "[]"),
  });
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
});

test("process group termination escalates while descendants survive the leader", async () => {
  const signals = [];
  await terminateProcessTree(48, {
    graceMs: 1,
    settleMs: 100,
    platform: "linux",
    processKill: (pid, signal) => {
      assert.equal(pid, -48);
      if (signal === 0) {
        if (signals.includes("SIGKILL")) {
          throw Object.assign(new Error("Process group gone"), { code: "ESRCH" });
        }
        return;
      }
      signals.push(signal);
    },
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

for (const outcome of ["gone", "reused", "alive"]) {
  for (const throws of [false, true]) {
    test(
      `Windows termination rechecks identity after failure (${outcome}, throws: ${throws})`,
      { skip: process.platform !== "win32" },
      async () => {
        const entry = { pid: 530, parentPid: 1, started: "20261126000000.000000+000" };
        let script;
        await terminateProcessTree(entry.pid, {
          graceMs: 0,
          settleMs: 5000,
          platform: "win32",
          execFileImpl: (command, args, options, done) => {
            if (args.at(-1).includes("SELECT ProcessId")) {
              return done(null, JSON.stringify(script ? [] : [entry]));
            }
            script = args.at(-1);
            done(null, "");
          },
        });
        const preparation = `
          $script:queries=0;
          $script:target=[pscustomobject]@{CreationDate='${entry.started}'};
          $script:target | Add-Member -MemberType ScriptMethod -Name Terminate -Value {
            ${throws ? "throw 'native termination failed'" : "return @{ReturnValue=9}"}
          };
          function Get-WmiObject {
            $script:queries += 1;
            if ($script:queries -eq 1) { return $script:target };
            ${outcome === "gone" ? "return $null" : outcome === "reused" ? "return @{CreationDate='20261127000000.000000+000'}" : "return $script:target"}
          };
        `;
        const operation = promisify(execFile)(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", preparation + script],
          { windowsHide: true, timeout: 5000 },
        );
        if (outcome === "alive") {
          await assert.rejects(operation, /termination failed/);
        } else {
          await operation;
        }
      },
    );
  }
}

for (const parentExits of [false, true]) {
  test(
    `native Windows termination leaves no live grandchild (parent exits first: ${parentExits})`,
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
    child.once('message', pid => process.send(pid, () => { if (${parentExits}) process.exit(0); }));
    setInterval(() => {}, 1000);
  `;
      const child = spawn(process.execPath, ["-e", source], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
      t.after(() => terminateProcessTree(child.pid, { graceMs: 0, settleMs: 5000 }));
      const [grandchildPid] = await once(child, "message");
      t.after(() => terminateProcessTree(grandchildPid, { graceMs: 0, settleMs: 5000 }));
      if (parentExits && child.exitCode === null) await once(child, "exit");
      const terminator = createProcessTreeTerminator(child, { graceMs: 1000, settleMs: 5000 });
      await terminator.terminate();
      for (const pid of [child.pid, grandchildPid]) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
    },
  );
}
