/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isValidSessionId, now } from "../utils/session-utils.js";
import { AsyncJobResponseBuilder } from "./response-builder.js";
import { ASYNC_JOB_STATUS } from "./constants.js";

/**
 * Generic async job lifecycle manager.
 */
export class AsyncJobLifecycleManager {
  constructor({
    jobStore = null,
    jobs = new Map(),
    timers = new Map(),
    responseBuilder = new AsyncJobResponseBuilder(),
  } = {}) {
    this.jobStore = jobStore;
    this.jobs = jobs;
    this.timers = timers;
    this.responseBuilder = responseBuilder;
  }

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

    this.jobs.set(jobId, job);
    if (this.jobStore) {
      await this.jobStore.save(job);
    }

    return this.responseBuilder.build(job);
  }

  async getJob(jobId) {
    let job = this.jobs.get(jobId);
    if (!job && this.jobStore) {
      job = await this.jobStore.findById(jobId);
      if (job) this.jobs.set(jobId, job);
    }
    return job ? this.responseBuilder.build(job) : null;
  }

  async updateJobStatus(jobId, status, data = {}) {
    const job = this.jobs.get(jobId);
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

  async completeJob(jobId, result) {
    return this.updateJobStatus(jobId, ASYNC_JOB_STATUS.COMPLETED, { result });
  }

  async failJob(jobId, error) {
    return this.updateJobStatus(jobId, ASYNC_JOB_STATUS.FAILED, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async waitForJob(jobId, options = {}) {
    const { pollInterval = 1000, maxWaitTime = 30000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const job = this.jobs.get(jobId);
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

    const job = this.jobs.get(jobId);
    return this.responseBuilder.buildWaitResponse(job, {
      pollInterval,
      maxWaitTime,
    });
  }

  async listJobs(status) {
    const jobs = Array.from(this.jobs.values());
    const filtered = status
      ? jobs.filter((j) => j.status === status)
      : jobs;
    return filtered.map((j) => this.responseBuilder.build(j));
  }

  async deleteJob(jobId) {
    const deleted = this.jobs.delete(jobId);
    if (deleted && this.jobStore) {
      await this.jobStore.delete(jobId);
    }
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
    return deleted;
  }

  hasRunningJobs(sessionId) {
    if (!isValidSessionId(sessionId)) return false;
    return Array.from(this.jobs.values()).some(
      (j) =>
        j.sessionId === sessionId &&
        j.status === ASYNC_JOB_STATUS.RUNNING,
    );
  }
}
