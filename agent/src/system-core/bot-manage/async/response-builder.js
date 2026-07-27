/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ASYNC_JOB_STATUS } from "./constants.js";

export class AsyncJobResponseBuilder {
  build(job, options = {}) {
    const { includeResult = false, includeError = false } = options;

    const response = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (includeResult && job.result !== undefined) {
      response.result = job.result;
    }

    if (includeError && job.error !== undefined) {
      response.error = job.error;
    }

    return response;
  }

  buildWaitResponse(job, options = {}) {
    const { pollInterval = 1000, maxWaitTime = 30000 } = options;

    return {
      jobId: job.id,
      status: ASYNC_JOB_STATUS.RUNNING,
      message: "Job is still running, please poll again",
      pollInterval,
      maxWaitTime,
      retryAfter: pollInterval,
    };
  }

  buildErrorResponse(jobId, error) {
    return {
      jobId,
      status: ASYNC_JOB_STATUS.FAILED,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
  }
}
