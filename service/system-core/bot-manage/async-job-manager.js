/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isValidSessionId, now } from "./utils/session-utils.js";
import { AsyncJobResponseBuilder } from "./async-job/async-job-response-builder.js";
import {
  ASYNC_JOB_STATUS,
  ASYNC_JOB_TYPES,
  DEFAULT_ASYNC_JOB_CONFIG,
  DEFAULT_WAIT_ASYNC_TIMEOUT_MS,
  MIN_WAIT_ASYNC_TIMEOUT_MS,
} from "./constants.js";

/**
 * Async Job Manager - manages asynchronous job lifecycle.
 */
export class AsyncJobManager {
  /**
   * @param {Object} jobStore - Job storage service
   */
  constructor(jobStore) {
    this.jobStore = jobStore;
    this.responseBuilder = new AsyncJobResponseBuilder();
    this._jobs = new Map();
    this._timers = new Map();
  }

  /**
   * Create a new async job.
   * @param {string} type - Job type
   * @param {Object} payload - Job payload
   * @param {Object} options - Job options
   * @returns {Object} Created job
   */
  async createJob(type, payload, options = {}) {
    const jobId = options.jobId || crypto.randomUUID();
    const job = {
      id: jobId,
      type,
      status: ASYNC_JOB_STATUS.PENDING,
      payload,
      result: null,
      error: null,
      createdAt: now(),
      updatedAt: now(),
      ...options,
    };

    this._jobs.set(jobId, job);
    if (this.jobStore) {
      await this.jobStore.save(job);
    }

    return this.responseBuilder.build(job);
  }

  /**
   * Get job by ID.
   * @param {string} jobId - Job identifier
   * @returns {Object|null} Job object or null
   */
  async getJob(jobId) {
    let job = this._jobs.get(jobId);
    if (!job && this.jobStore) {
      job = await this.jobStore.findById(jobId);
      if (job) this._jobs.set(jobId, job);
    }
    return job ? this.responseBuilder.build(job) : null;
  }

  /**
   * Update job status.
   * @param {string} jobId - Job identifier
   * @param {string} status - New status
   * @param {Object} data - Additional data
   * @returns {Object} Updated job
   */
  async updateJobStatus(jobId, status, data = {}) {
    const job = this._jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    job.status = status;
    job.updatedAt = now();
    Object.assign(job, data);

    if (this.jobStore) {
      await this.jobStore.save(job);
    }

    return this.responseBuilder.build(job, {
      includeResult: status === ASYNC_JOB_STATUS.COMPLETED,
      includeError: status === ASYNC_JOB_STATUS.FAILED,
    });
  }

  /**
   * Complete a job.
   * @param {string} jobId - Job identifier
   * @param {Object} result - Job result
   * @returns {Object} Completed job
   */
  async completeJob(jobId, result) {
    return this.updateJobStatus(jobId, ASYNC_JOB_STATUS.COMPLETED, { result });
  }

  /**
   * Fail a job.
   * @param {string} jobId - Job identifier
   * @param {Error|string} error - Error information
   * @returns {Object} Failed job
   */
  async failJob(jobId, error) {
    return this.updateJobStatus(jobId, ASYNC_JOB_STATUS.FAILED, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Wait for async job to complete.
   * @param {string} jobId - Job identifier
   * @param {Object} options - Wait options
   * @returns {Object} Job result or wait response
   */
  async waitForJob(jobId, options = {}) {
    const { pollInterval = 1000, maxWaitTime = 30000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const job = this._jobs.get(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      if (job.status === ASYNC_JOB_STATUS.COMPLETED) {
        return this.responseBuilder.build(job, { includeResult: true });
      }

      if (job.status === ASYNC_JOB_STATUS.FAILED) {
        return this.responseBuilder.buildErrorResponse(jobId, job.error);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const job = this._jobs.get(jobId);
    return this.responseBuilder.buildWaitResponse(job, {
      pollInterval,
      maxWaitTime,
    });
  }

  /**
   * List jobs by status.
   * @param {string} status - Filter by status
   * @returns {Array} List of jobs
   */
  async listJobs(status) {
    const jobs = Array.from(this._jobs.values());
    const filtered = status
      ? jobs.filter((j) => j.status === status)
      : jobs;
    return filtered.map((j) => this.responseBuilder.build(j));
  }

  /**
   * Delete a job.
   * @param {string} jobId - Job identifier
   * @returns {boolean} Success flag
   */
  async deleteJob(jobId) {
    const deleted = this._jobs.delete(jobId);
    if (deleted && this.jobStore) {
      await this.jobStore.delete(jobId);
    }
    const timer = this._timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(jobId);
    }
    return deleted;
  }

  /**
   * Check if session has running jobs.
   * @param {string} sessionId - Session identifier
   * @returns {boolean} Has running jobs
   */
  hasRunningJobs(sessionId) {
    if (!isValidSessionId(sessionId)) return false;
    return Array.from(this._jobs.values()).some(
      (j) =>
        j.sessionId === sessionId &&
        j.status === ASYNC_JOB_STATUS.RUNNING,
    );
  }

  // ========================
  // Legacy / Test Methods
  // ========================

  /**
   * Normalize wait async timeout value.
   * Enforces minimum timeout and returns default for invalid values.
   * @param {number} timeout - Timeout in milliseconds
   * @returns {number} Normalized timeout
   */
  _normalizeWaitAsyncTimeout(timeout) {
    if (!timeout) {
      return DEFAULT_WAIT_ASYNC_TIMEOUT_MS;
    }
    if (timeout < MIN_WAIT_ASYNC_TIMEOUT_MS) {
      return MIN_WAIT_ASYNC_TIMEOUT_MS;
    }
    return timeout;
  }

  /**
   * Build async done payload with normalized fields.
   * @param {Object} data - Raw payload data
   * @returns {Object} Normalized payload
   */
  _buildAsyncDonePayload(data) {
    return {
      ok: !!data.ok,
      status: data.status || "completed",
      sessionId: data.sessionId,
      parentSessionId: data.parentSessionId,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      result: data.result,
      error: data.error instanceof Error ? String(data.error) : data.error,
    };
  }

  /**
   * Build wait async fallback result from session data.
   * @param {Object} params - Parameters (userId, parentSessionId, sessionId)
   * @returns {Object} Fallback result
   */
  async _buildWaitAsyncFallbackResult(params) {
    const { userId, parentSessionId, sessionId } = params;

    const bundle = await this.session.getSessionBundle({
      userId,
      parentSessionId,
      sessionId,
    });

    if (!bundle?.exists) {
      return {
        ok: false,
        status: "not_found",
        sessionId,
        parentSessionId,
      };
    }

    const sessionData = bundle.sessions?.find(
      (s) => s.sessionId === sessionId,
    );
    const messages = sessionData?.messages || [];

    // Find last assistant message
    const assistantMessage = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.type === "message");

    const answer = assistantMessage?.content || "";
    const dialogProcessId = assistantMessage?.dialogProcessId || "";

    const executionBundle = await this.session.getExecutionBundle({
      userId,
      parentSessionId,
      sessionId,
    });

    return {
      ok: true,
      status: "completed",
      sessionId,
      parentSessionId,
      result: {
        answer,
        dialogProcessId,
        executionLogs: executionBundle?.logs || [],
      },
    };
  }
}
