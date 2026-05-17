/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AsyncJobLifecycleManager } from "./async/manager.js";
import { AsyncSessionRunner } from "./async/session-runner.js";
import { AsyncJobResponseBuilder } from "./async/response-builder.js";

/**
 * Async Job Manager - aggregates generic lifecycle + session async wrappers.
 */
export class AsyncJobManager {
  /**
   * @param {Object} jobStore - Job storage service or legacy deps object
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

    this._jobs = new Map();
    this._timers = new Map();
    this.asyncJobs = this._jobs;

    this.responseBuilder = new AsyncJobResponseBuilder();
    this.lifecycle = new AsyncJobLifecycleManager({
      jobStore: this.jobStore,
      jobs: this._jobs,
      timers: this._timers,
      responseBuilder: this.responseBuilder,
    });
    this.sessionRunner = new AsyncSessionRunner({
      jobs: this._jobs,
      session: this.session,
      runSession: this.runSession,
      upsertParentAsyncTask: this.upsertParentAsyncTask,
      errorLogger: this.errorLogger,
    });
  }

  async createJob(type, payload, options = {}) {
    return this.lifecycle.createJob(type, payload, options);
  }

  async getJob(jobId) {
    return this.lifecycle.getJob(jobId);
  }

  async updateJobStatus(jobId, status, data = {}) {
    return this.lifecycle.updateJobStatus(jobId, status, data);
  }

  async completeJob(jobId, result) {
    return this.lifecycle.completeJob(jobId, result);
  }

  async failJob(jobId, error) {
    return this.lifecycle.failJob(jobId, error);
  }

  async waitForJob(jobId, options = {}) {
    return this.lifecycle.waitForJob(jobId, options);
  }

  async listJobs(status) {
    return this.lifecycle.listJobs(status);
  }

  async deleteJob(jobId) {
    return this.lifecycle.deleteJob(jobId);
  }

  hasRunningJobs(sessionId) {
    return this.lifecycle.hasRunningJobs(sessionId);
  }

  // ========================
  // Legacy / Test Methods
  // ========================

  _normalizeWaitAsyncTimeout(timeout) {
    if (this.sessionRunner) {
      return this.sessionRunner._normalizeWaitAsyncTimeout(timeout);
    }
    const runner = new AsyncSessionRunner();
    return runner._normalizeWaitAsyncTimeout(timeout);
  }

  _buildAsyncDonePayload(data) {
    if (this.sessionRunner) {
      return this.sessionRunner._buildAsyncDonePayload(data);
    }
    const runner = new AsyncSessionRunner();
    return runner._buildAsyncDonePayload(data);
  }

  async _buildWaitAsyncFallbackResult(params) {
    if (this.sessionRunner) {
      return this.sessionRunner._buildWaitAsyncFallbackResult(params);
    }
    const runner = new AsyncSessionRunner({
      session: this.session,
    });
    return runner._buildWaitAsyncFallbackResult(params);
  }

  _asyncJobKey(payload = {}) {
    if (this.sessionRunner) {
      return this.sessionRunner._asyncJobKey(payload);
    }
    const runner = new AsyncSessionRunner();
    return runner._asyncJobKey(payload);
  }

  // ========================
  // Legacy Public API
  // ========================

  runAsyncSession(payload = {}) {
    if (!this.sessionRunner) {
      this.sessionRunner = new AsyncSessionRunner({
        jobs: this._jobs || new Map(),
        session: this.session,
        runSession: this.runSession,
        upsertParentAsyncTask: this.upsertParentAsyncTask,
        errorLogger: this.errorLogger,
      });
    }
    return this.sessionRunner.runAsyncSession(payload);
  }

  async waitAsyncSession(payload = {}) {
    if (!this.sessionRunner) {
      this.sessionRunner = new AsyncSessionRunner({
        jobs: this._jobs || new Map(),
        session: this.session,
        runSession: this.runSession,
        upsertParentAsyncTask: this.upsertParentAsyncTask,
        errorLogger: this.errorLogger,
      });
    }
    return this.sessionRunner.waitAsyncSession(payload);
  }
}
