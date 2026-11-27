/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { setTimeout as delay } from "node:timers/promises";

const SNAPSHOT =
  "$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @([Management.ManagementObjectSearcher]::new('SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process').Get() | ForEach-Object { @{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; started=[string]$_.CreationDate } })";
const pendingTrees = new Map();

function execute(command, args, execFileImpl, timeout) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, { windowsHide: true, timeout }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

async function snapshot(execFileImpl, timeout) {
  const output = await execute(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", SNAPSHOT],
    execFileImpl,
    timeout,
  );
  const entries = JSON.parse(output);
  if (!Array.isArray(entries)) throw new TypeError("Windows process snapshot must be an array");
  for (const entry of entries) {
    if (
      !Number.isInteger(entry.pid) ||
      !Number.isInteger(entry.parentPid) ||
      !/^\d{14}\.\d{6}[+-]\d{3}$/.test(entry.started)
    ) {
      throw new TypeError("Windows process snapshot requires PID, parent PID and creation time");
    }
  }
  return entries;
}

function addChildren(parentPid, children, owned, queue) {
  for (const child of children.get(parentPid) || []) {
    if (owned.has(parentPid) && child.started < owned.get(parentPid)) continue;
    if (!owned.has(child.pid)) owned.set(child.pid, child.started);
    queue.push(child.pid);
  }
}

function collectTree(pid, entries, owned) {
  const children = Map.groupBy(entries, (entry) => entry.parentPid);
  const current = new Map(entries.map((entry) => [entry.pid, entry.started]));
  const root = entries.find((entry) => entry.pid === pid);
  if (root && !owned.has(pid)) owned.set(pid, root.started);
  const queue = [pid, ...owned.keys()];
  const visited = new Set();
  for (let index = 0; index < queue.length; index++) {
    const parentPid = queue[index];
    if (visited.has(parentPid)) continue;
    if (
      owned.has(parentPid) &&
      current.has(parentPid) &&
      owned.get(parentPid) !== current.get(parentPid)
    )
      continue;
    visited.add(parentPid);
    addChildren(parentPid, children, owned, queue);
  }
  return entries.filter((entry) => owned.get(entry.pid) === entry.started);
}

function terminationCommand(entry) {
  const query = `Get-WmiObject Win32_Process -Filter 'ProcessId = ${entry.pid}'`;
  const identity = `$p -and $p.CreationDate -eq '${entry.started}'`;
  return `$p=${query}; if (${identity}) { try { $r=$p.Terminate(); if ($r.ReturnValue -ne 0) { throw ('Process ${entry.pid} termination failed: ' + $r.ReturnValue) } } catch { $p=${query}; if (${identity}) { throw } } }`;
}

export async function forceStopWindowsTree(pid, { execFileImpl, settleMs }) {
  const owned = pendingTrees.get(pid) || new Map();
  pendingTrees.set(pid, owned);
  let deadline;
  const remaining = () =>
    deadline === undefined ? settleMs : Math.max(1, Math.ceil(deadline - performance.now()));
  while (true) {
    const alive = collectTree(pid, await snapshot(execFileImpl, remaining()), owned);
    if (!alive.length) {
      pendingTrees.delete(pid);
      return;
    }
    if (deadline !== undefined && performance.now() >= deadline) {
      throw new Error(`Process tree ${pid} did not exit after forced termination`);
    }
    const command =
      "$ErrorActionPreference='Stop'; " + alive.reverse().map(terminationCommand).join("; ");
    await execute(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      execFileImpl,
      remaining(),
    );
    deadline ??= performance.now() + settleMs;
    await delay(Math.min(10, remaining()));
  }
}
