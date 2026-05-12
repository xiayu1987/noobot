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
  constructor(jobStore = null) {
    const input = jobStore && typeof jobStore === "object" ? jobStore : {};
    const looksLikeLegacyDeps =
      typeof input?.runSession === "function" ||
      typeof input?.upsertParentAsyncTask === "function" ||
      input?.session;
    const looksLikeJobStore =
      typeof input?.save === "function" ||
      typeof input?.findById === "function" ||
      typeof input?.delete === "function";

    this.jobStore = looksLikeJobStore && !looksLikeLegacyDeps ? input : null;
    this.session = input?.session || null;
    this.runSession =
      typeof input?.runSession === "function" ? input.runSession : null;
    this.upsertParentAsyncTask =
      typeof input?.upsertParentAsyncTask === "function"
        ? input.upsertParentAsyncTask
        : null;
    this.errorLogger = input?.errorLogger || null;
    this.responseBuilder = new AsyncJobResponseBuilder();
    this._jobs = new Map();
    this._timers = new Map();
    // Backward compatibility field
    this.asyncJobs = this._jobs;
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

  _asyncJobKey({ parentSessionId = "", sessionId = "" } = {}) {
    return `${String(parentSessionId || "").trim()}::${String(sessionId || "").trim()}`;
  }

  // ========================
  // Legacy Public API
  // ========================

  runAsyncSession(payload = {}) {
    if (typeof this.runSession !== "function") {
      throw new TypeError("this.asyncJobManager.runAsyncSession is not a function");
    }
    const {
      userId,
      sessionId = "",
      parentSessionId = "",
      task = "",
      sharedTaskSpec = "",
      deliverable = "",
      attachments = [],
      eventListener = null,
      sourceDialogProcessId = "",
      parentDialogProcessId = "",
      userInteractionBridge = null,
      runConfig = {},
      abortSignal = null,
      parentAsyncResultContainer = null,
    } = payload || {};

    const normalizedUserId = String(userId || "").trim();
    const normalizedParentSessionId = String(parentSessionId || "").trim();
    if (!normalizedUserId || !normalizedParentSessionId) {
      throw new Error("userId/parentSessionId required");
    }
    if (!isValidSessionId(normalizedParentSessionId)) {
      throw new Error("invalid parentSessionId format");
    }

    const normalizedSessionId = String(sessionId || "").trim() || crypto.randomUUID();
    if (!isValidSessionId(normalizedSessionId)) {
      throw new Error("invalid sessionId format");
    }

    const message = [
      `任务: ${String(task || "")}`,
      `共享任务说明: ${String(sharedTaskSpec || "")}`,
      `规定最终交付物（文件及说明）: ${String(deliverable || "")}`,
    ].join("\n");

    const key = this._asyncJobKey({
      parentSessionId: normalizedParentSessionId,
      sessionId: normalizedSessionId,
    });
    const startedAt = now();
    const baseJob = {
      key,
      sessionId: normalizedSessionId,
      parentSessionId: normalizedParentSessionId,
      status: "running",
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      task: String(task || ""),
      sharedTaskSpec: String(sharedTaskSpec || ""),
      parentSessionId: String(parentSessionId || ""),
      parentDialogProcessId: String(parentDialogProcessId || ""),
      sourceDialogProcessId: String(sourceDialogProcessId || ""),
      parentAsyncResultContainer,
    };
    this._jobs.set(key, baseJob);

    if (typeof this.upsertParentAsyncTask === "function") {
      this.upsertParentAsyncTask({
        parentAsyncResultContainer,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
        task,
        sharedTaskSpec,
        patch: {
          status: "running",
          startedAt,
          endedAt: "",
          error: "",
          result: null,
        },
      });
    }

    const runPromise = this.runSession({
      userId: normalizedUserId,
      sessionId: normalizedSessionId,
      message,
      caller: "bot",
      parentSessionId: normalizedParentSessionId,
      parentDialogProcessId,
      attachments: Array.isArray(attachments) ? attachments : [],
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });

    baseJob.promise = Promise.resolve(runPromise)
      .then((result) => {
        const current = this._jobs.get(key) || {};
        const endedAt = now();
        this._jobs.set(key, {
          ...current,
          status: "completed",
          endedAt,
          result,
          error: "",
        });
        return result;
      })
      .catch(async (error) => {
        const current = this._jobs.get(key) || {};
        const endedAt = now();
        const message = error?.message || String(error);
        const status = /abort|stopped/i.test(message) ? "stopped" : "failed";
        this._jobs.set(key, {
          ...current,
          status,
          endedAt,
          result: null,
          error: message,
        });
        if (this.errorLogger?.log) {
          await this.errorLogger.log({
            userId: normalizedUserId,
            sessionId: normalizedSessionId,
            parentSessionId: normalizedParentSessionId,
            source: "AsyncJobManager.runAsyncSession",
            event: "run_async_session_failed",
            error,
          });
        }
        throw error;
      });

    return {
      ok: true,
      status: "running",
      sessionId: normalizedSessionId,
      parentSessionId: normalizedParentSessionId,
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      parentAsyncResultContainer,
    };
  }

  async waitAsyncSession(payload = {}) {
    const {
      userId = "",
      sessionId = "",
      parentSessionId = "",
      timeoutMs = DEFAULT_WAIT_ASYNC_TIMEOUT_MS,
    } = payload || {};

    const normalizedUserId = String(userId || "").trim();
    const normalizedParentSessionId = String(parentSessionId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedUserId || !normalizedParentSessionId || !normalizedSessionId) {
      throw new Error("userId/parentSessionId/sessionId required");
    }

    const waitTimeoutMs = this._normalizeWaitAsyncTimeout(Number(timeoutMs));
    const startedAtMs = Date.now();
    const key = this._asyncJobKey({
      parentSessionId: normalizedParentSessionId,
      sessionId: normalizedSessionId,
    });

    const resolveDone = (job = {}) =>
      this._buildAsyncDonePayload({
        ok: job?.status === "completed",
        status: job?.status || "running",
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
        startedAt: job?.startedAt || "",
        endedAt: job?.endedAt || "",
        result: job?.result ?? null,
        error: job?.error || "",
      });

    const job = this._jobs.get(key);
    if (!job?.promise) {
      const bundle = await this.session?.getSessionBundle?.({
        userId: normalizedUserId,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
      });
      return {
        ok: !!bundle?.exists,
        status: bundle?.exists ? "completed" : "not_found",
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
      };
    }

    while (Date.now() - startedAtMs < waitTimeoutMs) {
      const job = this._jobs.get(key);
      if (!job) break;
      if (["completed", "failed", "stopped"].includes(String(job?.status || ""))) {
        return resolveDone(job);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const latest = this._jobs.get(key);
    if (!latest) {
      return this._buildWaitAsyncFallbackResult({
        userId: normalizedUserId,
        parentSessionId: normalizedParentSessionId,
        sessionId: normalizedSessionId,
      });
    }
    if (["completed", "failed", "stopped"].includes(String(latest?.status || ""))) {
      return resolveDone(latest);
    }
    return {
      ok: true,
      status: "running",
      sessionId: normalizedSessionId,
      parentSessionId: normalizedParentSessionId,
      startedAt: latest?.startedAt || "",
    };
  }
}
