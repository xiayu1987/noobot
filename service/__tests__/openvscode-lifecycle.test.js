/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";
import { createOpenVSCodeService } from "../services/openvscode-service.js";
import { isProcessAlive, stopInstance } from "../services/openvscode/process.js";

async function restoreRunningInstance(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-openvscode-lifecycle-"));
  const workspacePath = path.join(root, "alice");
  const metadataPath = path.join(workspacePath, ".noobot/openvscode-server.json");
  const child = childProcess.spawn(
    process.execPath,
    [
      "-e",
      `const { spawn } = require('node:child_process');
       const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
       const server = require('node:http').createServer((req, res) => res.end('ready'));
       server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, descendantPid: descendant.pid })));`,
    ],
    {
      detached: usesDetachedProcessGroup(),
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );
  t.after(async () => {
    await terminateProcessTree(child, "SIGKILL");
    await rm(root, { recursive: true, force: true });
  });
  const [ready] = await once(child.stdout, "data");
  const { port, descendantPid } = JSON.parse(ready.toString());
  const instance = {
    userId: "alice",
    workspacePath,
    defaultFolder: workspacePath,
    pid: child.pid,
    port,
    basePath: "lifecycle",
    connectionToken: "test-token",
    args: ["--connection-token", "test-token"],
  };
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, JSON.stringify(instance));
  const service = createOpenVSCodeService({ workspaceRootPath: () => root });
  assert.equal((await service.resolveInstanceFromUrl("/ide/lifecycle/"))?.pid, child.pid);
  return { service, instance, descendantPid, metadataPath };
}

test("OpenVSCode shutdown waits for its process tree before removing instance ownership", async (t) => {
  const { service, instance, descendantPid, metadataPath } = await restoreRunningInstance(t);
  await service.stopLifecycleManager({ stopInstances: true });
  assert.equal(isProcessAlive(instance.pid), false);
  assert.equal(isProcessAlive(descendantPid), false);
  assert.equal(await service.resolveInstanceFromUrl("/ide/lifecycle/"), null);
  await assert.rejects(readFile(metadataPath), { code: "ENOENT" });
});

test("OpenVSCode shutdown preserves ownership after termination failure and allows retry", async (t) => {
  const { service, instance, metadataPath } = await restoreRunningInstance(t);
  const failure = Object.assign(new Error("termination denied"), { code: "EACCES" });
  if (process.platform === "win32") {
    t.mock.method(childProcess, "execFile", (...args) => {
      assert.equal(args[0], "taskkill");
      queueMicrotask(() => args.at(-1)(failure));
    });
    syncBuiltinESMExports();
  } else {
    const kill = process.kill;
    t.mock.method(process, "kill", (pid, signal) => {
      if (signal !== 0) throw failure;
      return kill(pid, signal);
    });
  }
  try {
    await assert.rejects(service.stopLifecycleManager({ stopInstances: true }), (error) => {
      assert.equal(error.errors[0], failure);
      return true;
    });
    assert.equal(isProcessAlive(instance.pid), true);
    assert.equal((await service.resolveInstanceFromUrl("/ide/lifecycle/"))?.pid, instance.pid);
    assert.equal(JSON.parse(await readFile(metadataPath, "utf8")).pid, instance.pid);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  await service.stopLifecycleManager({ stopInstances: true });
  assert.equal(isProcessAlive(instance.pid), false);
  await assert.rejects(readFile(metadataPath), { code: "ENOENT" });
});

test("OpenVSCode termination rejects missing process ownership and unexpected probe failures", async (t) => {
  await assert.rejects(stopInstance({}, { forceAfterMs: 0 }), /PID is required/);
  const failure = Object.assign(new Error("probe denied"), { code: "EPERM" });
  t.mock.method(process, "kill", () => {
    throw failure;
  });
  assert.throws(
    () => isProcessAlive(1),
    (error) => error === failure,
  );
});
