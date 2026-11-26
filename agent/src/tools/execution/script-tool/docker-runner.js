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
import { setTimeout as delay } from "node:timers/promises";
import { logWarn } from "../../../observability/console/logger.js";
import { SANDBOX_PROVIDER_NAME } from "./constants.js";
import { enqueueDockerContainerTask } from "./docker-queue.js";
import { run } from "./process-exec.js";
import { scriptRuntimeError } from "./script-errors.js";

const execFileAsync = promisify(execFile);

const DOCKER_CLEANUP_SCRIPT = `
token=$1
signal=$2
pgids=""
process_group() {
  awk '{ sub(/^.*\\) /, ""); print $3 }' "$1"
}
for environ in /proc/[0-9]*/environ; do
  [ -r "$environ" ] || continue
  if tr '\\000' '\\n' < "$environ" 2>/dev/null | grep -Fqx "NOOBOT_EXECUTION_TOKEN=$token"; then
    pid=\${environ#/proc/}
    pid=\${pid%/environ}
    if ! pgid=$(process_group "/proc/$pid/stat" 2>/dev/null); then
      [ ! -e "/proc/$pid/stat" ] && continue
      exit 1
    fi
    case "$pgid" in
      ''|*[!0-9]*) echo "Invalid execution process group for $pid" >&2; exit 1 ;;
    esac
    case " $pgids " in
      *" $pgid "*) ;;
      *) pgids="$pgids $pgid" ;;
    esac
  fi
done
if [ "$signal" = CHECK ]; then
  printf '%s' "$pgids"
  exit 0
fi
for pgid in $pgids; do
  if ! kill -"$signal" -"$pgid" 2>/dev/null; then
    for stat in /proc/[0-9]*/stat; do
      if ! current=$(process_group "$stat" 2>/dev/null); then
        [ ! -e "$stat" ] && continue
        exit 1
      fi
      if [ "$current" = "$pgid" ]; then
        echo "Failed to signal execution process group $pgid" >&2
        exit 1
      fi
    done
  fi
done
`;

function signalDockerExecution({ containerName, executionToken, executable }, signal) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
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
      { timeout: TIME_THRESHOLDS.tools.dockerExecuteTimeoutMs, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function ensureDockerContainer(built) {
  const listed = await execFileAsync(built.executable, built.listArgs, { windowsHide: true });
  let exists = listed.stdout.split("\n").some((name) => name.trim() === built.containerName);
  if (exists) {
    const inspected = await execFileAsync(built.executable, built.inspectMountsArgs, {
      windowsHide: true,
    });
    const mounts = JSON.parse(inspected.stdout);
    if (!Array.isArray(mounts)) {
      throw new TypeError(`docker_mounts_not_array: ${built.containerName}`);
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
      await execFileAsync(built.executable, built.removeArgs, { windowsHide: true });
      exists = false;
    }
  }
  if (!exists) {
    await execFileAsync(built.executable, built.createArgs, { windowsHide: true });
  }
  await execFileAsync(built.executable, built.startArgs, { windowsHide: true });
}

async function terminateDockerExecution(built) {
  const failures = [];
  for (const signal of ["TERM", "KILL"]) {
    try {
      await signalDockerExecution(built, signal);
    } catch (error) {
      failures.push(error);
    }
    if (signal === "TERM") await delay(TIME_THRESHOLDS.tools.processForceKillGraceMs);
  }
  await delay(TIME_THRESHOLDS.tools.processSettleGraceMs);
  if ((await signalDockerExecution(built, "CHECK")).trim()) {
    throw new AggregateError(failures, `Docker execution ${built.executionToken} did not stop`);
  }
  if (failures.length) throw new AggregateError(failures, "Docker execution cleanup failed");
}

export async function runDockerCommand({
  basePath,
  userId,
  command,
  timeout,
  isolation,
  workdir,
  runner = run,
  abortSignal = null,
  runnerOptions = {},
}) {
  const built = buildDockerCommand({ basePath, userId, command, isolation, workdir });
  let result = null;
  try {
    result = await enqueueDockerContainerTask({
      containerName: built.containerName,
      task: async () => {
        await ensureDockerContainer(built);
        return runner(
          { command: built.executable, args: built.execArgs },
          basePath,
          timeout,
          abortSignal,
          {
            ...runnerOptions,
            onTerminate: () => terminateDockerExecution(built),
          },
        );
      },
      lockWaitTimeoutMs: isolation.sandbox.lockWaitTimeoutMs,
      abortSignal,
    });
  } catch (error) {
    if (String(error?.code || "") === "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT") {
      logWarn("[execute_script][docker_queue_timeout]", {
        containerName: built.containerName,
        lockWaitTimeoutMs: isolation.sandbox.lockWaitTimeoutMs,
      });
      throw scriptRuntimeError(
        `Docker container lock wait timeout (${isolation.sandbox.lockWaitTimeoutMs}ms): ${built.containerName}`,
        {
          code: ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR,
          details: {
            mode: SANDBOX_PROVIDER_NAME.DOCKER,
            reason: "container_lock_wait_timeout",
            containerName: built.containerName,
            lockWaitTimeoutMs: isolation.sandbox.lockWaitTimeoutMs,
          },
        },
      );
    }
    throw error;
  }
  return result;
}
