/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildDockerCommand } from "../../../sandbox/docker-sandbox.js";
import { logWarn } from "../../../observability/console/logger.js";
import { DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS, SANDBOX_PROVIDER_NAME } from "./constants.js";
import { enqueueDockerContainerTask } from "./docker-queue.js";
import { run } from "./process-exec.js";
import { scriptRuntimeError } from "./script-errors.js";

const execFileAsync = promisify(execFile);

const DOCKER_FORCE_KILL_GRACE_MS = TIME_THRESHOLDS.tools.processForceKillGraceMs;
const DOCKER_CLEANUP_SCRIPT = `
token=$1
signal=$2
pgids=""
for environ in /proc/[0-9]*/environ; do
  [ -r "$environ" ] || continue
  if tr '\\000' '\\n' < "$environ" 2>/dev/null | grep -Fqx "NOOBOT_EXECUTION_TOKEN=$token"; then
    pid=\${environ#/proc/}
    pid=\${pid%/environ}
    pgid=$(awk '{ print $5 }' "/proc/$pid/stat" 2>/dev/null || true)
    case "$pgid" in
      ''|*[!0-9]*) continue ;;
    esac
    case " $pgids " in
      *" $pgid "*) ;;
      *) pgids="$pgids $pgid" ;;
    esac
  fi
done
for pgid in $pgids; do
  kill -"$signal" -"$pgid" 2>/dev/null || true
done
`;

function signalDockerExecution({ containerName, executionToken }, signal) {
  return new Promise((resolve) => {
    execFile(
      "docker",
      [
        "exec",
        containerName,
        "sh",
        "-c",
        DOCKER_CLEANUP_SCRIPT,
        "noobot-cleanup",
        executionToken,
        signal,
      ],
      { timeout: 10000, windowsHide: true },
      () => resolve(),
    );
  });
}

async function ensureDockerContainer(built) {
  const inspect = () => execFileAsync(built.executable, built.inspectArgs, { windowsHide: true });
  let exists = true;
  try {
    await inspect();
  } catch {
    exists = false;
  }
  if (exists) {
    let mounts = [];
    try {
      const result = await execFileAsync(built.executable, built.inspectMountsArgs, {
        windowsHide: true,
      });
      mounts = JSON.parse(String(result.stdout || "[]"));
    } catch {
      mounts = [];
    }
    const expected = [
      { source: built.workspaceSource, destination: built.workspaceTarget, rw: true },
      ...built.mounts.map((item) => ({
        source: item.source,
        destination: item.target,
        rw: item.readOnly !== true,
      })),
    ];
    const actual = mounts.map((item) => ({
      source: item.Source,
      destination: item.Destination,
      rw: item.RW,
    }));
    const matches = expected.every((item) =>
      actual.some(
        (candidate) =>
          candidate.source === item.source &&
          candidate.destination === item.destination &&
          candidate.rw === item.rw,
      ),
    );
    if (!matches || actual.length !== expected.length) {
      await execFileAsync(built.executable, built.removeArgs, { windowsHide: true }).catch(() => undefined);
      exists = false;
    }
  }
  if (!exists) {
    await execFileAsync(built.executable, built.createArgs, { windowsHide: true });
  }
  await execFileAsync(built.executable, built.startArgs, { windowsHide: true });
}

export function terminateDockerExecution(built) {
  void signalDockerExecution(built, "TERM");
  const forceKillTimer = setTimeout(
    () => void signalDockerExecution(built, "KILL"),
    DOCKER_FORCE_KILL_GRACE_MS,
  );
  forceKillTimer.unref?.();
}

export async function runDockerCommand({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  isolation,
  workdir = "",
  lockWaitTimeoutMs = DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  runner = run,
  abortSignal = null,
}) {
  const built = buildDockerCommand({ userRoot, userId, command, isolation, workdir });
  let result = null;
  try {
    result = await enqueueDockerContainerTask({
      containerName: built.containerName,
      task: async () => {
        await ensureDockerContainer(built);
        return runner({ command: built.executable, args: built.execArgs }, workspace, timeout, abortSignal, {
          onTerminate: () => terminateDockerExecution(built),
        });
      },
      lockWaitTimeoutMs,
      abortSignal,
    });
  } catch (error) {
    if (String(error?.code || "") === "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT") {
      logWarn("[execute_script][docker_queue_timeout]", {
        containerName: built.containerName,
        lockWaitTimeoutMs: error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
      });
      throw scriptRuntimeError(
        `Docker container lock wait timeout (${error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS}ms): ${built.containerName}`,
        {
          code: ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR,
          details: {
            mode: SANDBOX_PROVIDER_NAME.DOCKER,
            reason: "container_lock_wait_timeout",
            containerName: built.containerName,
            lockWaitTimeoutMs:
              error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
          },
        },
      );
    }
    throw error;
  }
  return { result, docker: built };
}
