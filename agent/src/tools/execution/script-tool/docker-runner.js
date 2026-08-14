/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { execFile } from "node:child_process";
import { buildDockerCommand } from "../../../sandbox/docker-sandbox.js";
import { logWarn } from "../../../observability/console/logger.js";
import { DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS, SANDBOX_PROVIDER_NAME } from "./constants.js";
import { enqueueDockerContainerTask } from "./docker-queue.js";
import { run } from "./process-exec.js";
import { scriptRuntimeError } from "./script-errors.js";

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
      task: async () =>
        runner(built.cmd, workspace, timeout, abortSignal, {
          onTerminate: () => terminateDockerExecution(built),
        }),
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
