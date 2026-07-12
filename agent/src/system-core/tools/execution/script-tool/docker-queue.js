/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs } from "../../../config/index.js";
import { logDebug } from "../../../tracking/console/logger.js";
import {
  DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
} from "./constants.js";

const dockerContainerQueueMap = new Map();

export function enqueueDockerContainerTask({
  containerName = "",
  task = async () => ({}),
  lockWaitTimeoutMs = ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
} = {}) {
  const key = String(containerName || "").trim() || "__default__";
  const previousTail = dockerContainerQueueMap.get(key) || Promise.resolve();
  const queueDepthBefore = dockerContainerQueueMap.has(key) ? 1 : 0;
  const waitStartedAt = Date.now();
  const waitForPrevious = previousTail.catch(() => undefined);
  const waitTimeout = normalizeTimeMs(lockWaitTimeoutMs, {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  });
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
