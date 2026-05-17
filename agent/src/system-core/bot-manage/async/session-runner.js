/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isValidSessionId, now } from "../utils/session-utils.js";
import { tSystem } from "../../i18n/system-text.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
  CALLER_ROLE,
  DEFAULT_WAIT_ASYNC_TIMEOUT_MS,
  MESSAGE_TYPE,
  MESSAGE_ROLE,
  MIN_WAIT_ASYNC_TIMEOUT_MS,
  SESSION_ASYNC_STATUS,
  SESSION_ASYNC_TERMINAL_STATUSES,
} from "./constants.js";

const POLL_INTERVAL_MS = 300;

/**
 * Session-specific async wrappers (legacy API compatibility).
 */
export class AsyncSessionRunner {
  constructor({
    jobs = new Map(),
    session = null,
    runSession = null,
    upsertParentAsyncTask = null,
    errorLogger = null,
  } = {}) {
    this.jobs = jobs;
    this.session = session;
    this.runSession = runSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.errorLogger = errorLogger;
  }

  _normalizeWaitAsyncTimeout(timeout) {
    if (!timeout) {
      return DEFAULT_WAIT_ASYNC_TIMEOUT_MS;
    }
    if (timeout < MIN_WAIT_ASYNC_TIMEOUT_MS) {
      return MIN_WAIT_ASYNC_TIMEOUT_MS;
    }
    return timeout;
  }

  _buildAsyncDonePayload(data) {
    return {
      ok: !!data.ok,
      status: data.status || SESSION_ASYNC_STATUS.COMPLETED,
      sessionId: data.sessionId,
      parentSessionId: data.parentSessionId,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      result: data.result,
      error: data.error instanceof Error ? String(data.error) : data.error,
    };
  }

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
        status: SESSION_ASYNC_STATUS.NOT_FOUND,
        sessionId,
        parentSessionId,
      };
    }

    const sessionData = bundle.sessions?.find(
      (s) => s.sessionId === sessionId,
    );
    const messages = sessionData?.messages || [];

    const assistantMessage = [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === MESSAGE_ROLE.ASSISTANT &&
          m.type === MESSAGE_TYPE.MESSAGE,
      );

    const answer = assistantMessage?.content || "";
    const dialogProcessId = assistantMessage?.dialogProcessId || "";

    const executionBundle = await this.session.getExecutionBundle({
      userId,
      parentSessionId,
      sessionId,
    });

    return {
      ok: true,
      status: SESSION_ASYNC_STATUS.COMPLETED,
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

  /**
   * @deprecated prefer generic createJob + waitForJob.
   */
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
      throw new Error(tSystem("common.userParentSessionRequired"));
    }
    if (!isValidSessionId(normalizedParentSessionId)) {
      throw new Error(tSystem("bot.invalidParentSessionIdFormat"));
    }

    const normalizedSessionId = String(sessionId || "").trim() || crypto.randomUUID();
    if (!isValidSessionId(normalizedSessionId)) {
      throw new Error(tSystem("bot.invalidSessionIdFormat"));
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
      status: SESSION_ASYNC_STATUS.RUNNING,
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
    this.jobs.set(key, baseJob);

    if (typeof this.upsertParentAsyncTask === "function") {
      this.upsertParentAsyncTask({
        parentAsyncResultContainer,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
        task,
        sharedTaskSpec,
        patch: {
          status: SESSION_ASYNC_STATUS.RUNNING,
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
      caller: CALLER_ROLE.BOT,
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
        const current = this.jobs.get(key) || {};
        const endedAt = now();
        this.jobs.set(key, {
          ...current,
          status: SESSION_ASYNC_STATUS.COMPLETED,
          endedAt,
          result,
          error: "",
        });
        return result;
      })
      .catch(async (error) => {
        const current = this.jobs.get(key) || {};
        const endedAt = now();
        const message = error?.message || String(error);
        const status = /abort|stopped/i.test(message)
          ? SESSION_ASYNC_STATUS.STOPPED
          : SESSION_ASYNC_STATUS.FAILED;
        this.jobs.set(key, {
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
            source: BOT_MANAGE_LOG_SOURCE.ASYNC_RUN_SESSION,
            event: BOT_MANAGE_LOG_EVENT.RUN_ASYNC_SESSION_FAILED,
            error,
          });
        }
        throw error;
      });

    return {
      ok: true,
      status: SESSION_ASYNC_STATUS.RUNNING,
      sessionId: normalizedSessionId,
      parentSessionId: normalizedParentSessionId,
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      parentAsyncResultContainer,
    };
  }

  /**
   * @deprecated prefer generic waitForJob.
   */
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
      throw new Error(tSystem("common.userParentSessionSessionRequired"));
    }

    const waitTimeoutMs = this._normalizeWaitAsyncTimeout(Number(timeoutMs));
    const startedAtMs = Date.now();
    const key = this._asyncJobKey({
      parentSessionId: normalizedParentSessionId,
      sessionId: normalizedSessionId,
    });

    const resolveDone = (job = {}) =>
      this._buildAsyncDonePayload({
        ok: job?.status === SESSION_ASYNC_STATUS.COMPLETED,
        status: job?.status || SESSION_ASYNC_STATUS.RUNNING,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
        startedAt: job?.startedAt || "",
        endedAt: job?.endedAt || "",
        result: job?.result ?? null,
        error: job?.error || "",
      });

    const job = this.jobs.get(key);
    if (!job?.promise) {
      const bundle = await this.session?.getSessionBundle?.({
        userId: normalizedUserId,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
      });
      return {
        ok: !!bundle?.exists,
        status: bundle?.exists
          ? SESSION_ASYNC_STATUS.COMPLETED
          : SESSION_ASYNC_STATUS.NOT_FOUND,
        sessionId: normalizedSessionId,
        parentSessionId: normalizedParentSessionId,
      };
    }

    while (Date.now() - startedAtMs < waitTimeoutMs) {
      const job = this.jobs.get(key);
      if (!job) break;
      if (
        SESSION_ASYNC_TERMINAL_STATUSES.includes(
          String(job?.status || ""),
        )
      ) {
        return resolveDone(job);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const latest = this.jobs.get(key);
    if (!latest) {
      return this._buildWaitAsyncFallbackResult({
        userId: normalizedUserId,
        parentSessionId: normalizedParentSessionId,
        sessionId: normalizedSessionId,
      });
    }
    if (
      SESSION_ASYNC_TERMINAL_STATUSES.includes(
        String(latest?.status || ""),
      )
    ) {
      return resolveDone(latest);
    }
    return {
      ok: true,
      status: SESSION_ASYNC_STATUS.RUNNING,
      sessionId: normalizedSessionId,
      parentSessionId: normalizedParentSessionId,
      startedAt: latest?.startedAt || "",
    };
  }
}
