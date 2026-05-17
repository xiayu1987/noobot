/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ASYNC_JOB_STATUS } from "./constants.js";

/**
 * Build standardized async job responses.
 */
export class AsyncJobResponseBuilder {
  /**
   * Build async job response.
   * @param {Object} job - Async job object
   * @param {Object} options - Response options
   * @returns {Object} Formatted response
   */
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

  /**
   * Build response for waiting async job (running state).
   * @param {Object} job - Async job object
   * @param {Object} options - Wait options
   * @returns {Object} Wait response
   */
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

  /**
   * Build error response for async job.
   * @param {string} jobId - Job identifier
   * @param {Error|string} error - Error object or message
   * @returns {Object} Error response
   */
  buildErrorResponse(jobId, error) {
    return {
      jobId,
      status: ASYNC_JOB_STATUS.FAILED,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
  }
}
