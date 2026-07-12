/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ERROR_CODE } from "../../../error/constants.js";
import { buildDockerCommand } from "../../../sandbox/docker-sandbox.js";
import { logWarn } from "../../../tracking/console/logger.js";
import {
  DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  SANDBOX_COMMAND,
  SANDBOX_PROVIDER_NAME,
  SCRIPT_EXECUTION_MODE,
} from "./constants.js";
import { enqueueDockerContainerTask } from "./docker-queue.js";
import { run, runFileBacked, hasCommand } from "./process-exec.js";
import { scriptRuntimeError } from "./script-errors.js";
import { toolExecResult } from "./result-format.js";
import { buildScriptExecutionMeta, toolFileBackedExecResult } from "./workspace-meta.js";

export async function runDockerCommand({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
  runner = run,
}) {
  const built = buildDockerCommand({ userRoot, userId, command, scriptConfig });
  let result = null;
  try {
    result = await enqueueDockerContainerTask({
      containerName: built.containerName,
      task: async () => runner(built.cmd, workspace, timeout),
      lockWaitTimeoutMs:
        scriptConfig?.dockerLockWaitTimeoutMs ||
        DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (String(error?.code || "") === "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT") {
      logWarn("[execute_script][docker_queue_timeout]", {
        containerName: built.containerName,
        lockWaitTimeoutMs:
          error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
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

export async function tryDockerFallback({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
  runtime = {},
  agentContext = null,
  fallbackFrom,
  warning,
  includeLineNumbers = false,
  executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND,
}) {
  const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
  if (!dockerInstalled) return null;
  const { result: dr, docker } = await runDockerCommand({
    userRoot,
    userId,
    command,
    workspace,
    timeout,
    scriptConfig,
    runner: executionMode === SCRIPT_EXECUTION_MODE.BACKGROUND ? runFileBacked : run,
  });
  const meta = {
    fallbackFrom,
    warning,
    ...buildScriptExecutionMeta({
      sandboxEnabled: true,
      sandboxProvider: SANDBOX_PROVIDER_NAME.DOCKER,
      dockerConfig: scriptConfig,
      docker,
      workspace,
      runtime,
      agentContext,
    }),
  };
  if (executionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
    return toolFileBackedExecResult(SANDBOX_PROVIDER_NAME.DOCKER, dr, meta, {
      runtime,
      agentContext,
      basePath: runtime?.basePath || "",
    });
  }
  return toolExecResult(SANDBOX_PROVIDER_NAME.DOCKER, dr, meta, { includeLineNumbers });
}
