/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logDebug } from "../../../observability/console/logger.js";
import { text } from "@noobot/shared/value";

const dockerContainerQueueMap = new Map();

export function enqueueDockerContainerTask({
  containerName = "",
  task = async () => ({}),
  lockWaitTimeoutMs: waitTimeout,
  abortSignal = null,
} = {}) {
  const key = text(containerName) || "__default__";
  const previousTail = dockerContainerQueueMap.get(key) || Promise.resolve();
  const queueDepthBefore = dockerContainerQueueMap.has(key) ? 1 : 0;
  const waitStartedAt = Date.now();
  const waitForPrevious = previousTail.catch(() => undefined);
  if (!Number.isInteger(waitTimeout) || waitTimeout < 100) {
    throw new TypeError("enqueueDockerContainerTask requires protocol lockWaitTimeoutMs");
  }
  const waitPromise = Promise.race([
    waitForPrevious,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(new Error("docker container queue lock wait timeout"), {
            code: "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT",
            details: {
              containerName: key,
              lockWaitTimeoutMs: waitTimeout,
            },
          }),
        );
      }, waitTimeout);
      waitForPrevious.finally(() => clearTimeout(timer));
    }),
  ]);
  if (queueDepthBefore > 0) {
    logDebug("[execute_script][docker_queue_waiting]", {
      containerName: key,
      lockWaitTimeoutMs: waitTimeout,
    });
  }
  const runPromise = waitPromise.then(async () => {
    if (abortSignal?.aborted) {
      const error = new Error("docker container queue task aborted");
      error.name = "AbortError";
      error.code = "ABORT_ERR";
      throw error;
    }
    const waitedMs = Date.now() - waitStartedAt;
    if (waitedMs > 0) {
      logDebug("[execute_script][docker_queue_acquired]", {
        containerName: key,
        waitedMs,
      });
    }
    return task();
  });
  const tailPromise = runPromise
    .catch(() => undefined)
    .finally(() => {
      if (dockerContainerQueueMap.get(key) === tailPromise) {
        dockerContainerQueueMap.delete(key);
      }
    });
  dockerContainerQueueMap.set(key, tailPromise);
  return runPromise;
}
