/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";
import { recoverableToolError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import {
  ASYNC_JOB_FAST_CLEANUP_MS,
  ASYNC_JOB_RETENTION_MS,
  DEFAULT_WAIT_ASYNC_TIMEOUT_MS,
  MIN_WAIT_ASYNC_TIMEOUT_MS,
} from "./constants.js";
import { isAbortError, isPlainObject, isValidSessionId } from "./utils.js";

export class AsyncJobManager {
  constructor({
    session = null,
    runSession = null,
    upsertParentAsyncTask = null,
    errorLogger = null,
  } = {}) {
    this.session = session;
    this.runSession = runSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.errorLogger = errorLogger;
    this.asyncJobs = new Map();
  }

  _now() {
    return new Date().toISOString();
  }

  _asyncJobKey({ parentSessionId = "", sessionId = "" }) {
    return `${String(parentSessionId || "")}::${String(sessionId || "")}`;
  }

  _scheduleAsyncJobCleanup(key = "", delayMs = ASYNC_JOB_RETENTION_MS) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    const job = this.asyncJobs.get(normalizedKey);
    if (!job) return;
    if (job.cleanupTimer) {
      clearTimeout(job.cleanupTimer);
      job.cleanupTimer = null;
    }
    job.cleanupTimer = setTimeout(() => {
      const currentJob = this.asyncJobs.get(normalizedKey);
      if (!currentJob || currentJob.status === "running") return;
      this.asyncJobs.delete(normalizedKey);
    }, Math.max(0, Number(delayMs || 0)));
    if (typeof job.cleanupTimer?.unref === "function") {
      job.cleanupTimer.unref();
    }
  }

  _resolveAsyncSessionId({
    userId,
    parentSessionId,
    sessionId = "",
  }) {
    if (!userId || !parentSessionId) {
      throw recoverableToolError(tSystem("common.userParentSessionRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    if (!isValidSessionId(parentSessionId)) {
      throw recoverableToolError(tSystem("bot.invalidParentSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_PARENT_SESSION_ID",
      });
    }
    const usedSessionId = String(sessionId || "").trim() || uuidv4();
    if (!isValidSessionId(usedSessionId)) {
      throw recoverableToolError(tSystem("bot.invalidSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_SESSION_ID",
      });
    }
    return usedSessionId;
  }

  _buildAsyncTaskMessage(task = "", sharedTaskSpec = "") {
    return [
      `${tSystem("bot.taskPrefix")}: ${task || ""}`,
      `${tSystem("bot.sharedTaskSpecPrefix")}: ${sharedTaskSpec || ""}`,
    ].join("\n");
  }

  _buildAsyncJobResponse({
    status = "running",
    sessionId = "",
    parentSessionId = "",
    parentDialogProcessId = "",
    startedAt = "",
    endedAt = "",
    result = null,
    error = "",
    parentAsyncResultContainer = null,
  } = {}) {
    return {
      ok: true,
      status,
      sessionId,
      parentSessionId,
      parentDialogProcessId: parentDialogProcessId || "",
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(status !== "running" ? { result: result || null } : {}),
      ...(status !== "running" ? { error: error || "" } : {}),
      parentAsyncResultContainer: isPlainObject(parentAsyncResultContainer)
        ? parentAsyncResultContainer
        : {},
    };
  }

  _createAsyncJob({
    key = "",
    sessionId = "",
    parentSessionId = "",
    startedAt = "",
    task = "",
    sharedTaskSpec = "",
  } = {}) {
    return {
      key,
      sessionId,
      parentSessionId,
      status: "running",
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      input: { task, sharedTaskSpec },
      promise: null,
      cleanupTimer: null,
    };
  }

  _validateWaitAsyncInput({
    userId,
    parentSessionId,
    sessionId,
  }) {
    if (!userId || !parentSessionId || !sessionId) {
      throw recoverableToolError(tSystem("common.userParentSessionSessionRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
  }

  _buildWaitAsyncRunningResult({
    sessionId = "",
    parentSessionId = "",
    startedAt = "",
  } = {}) {
    return {
      ok: true,
      status: "running",
      sessionId,
      parentSessionId,
      startedAt,
    };
  }

  _normalizeWaitAsyncTimeout(timeoutMs = DEFAULT_WAIT_ASYNC_TIMEOUT_MS) {
    return Math.max(
      MIN_WAIT_ASYNC_TIMEOUT_MS,
      Number(timeoutMs || DEFAULT_WAIT_ASYNC_TIMEOUT_MS),
    );
  }

  _findAssistantAnswerMessage(messages = []) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    return [...sourceMessages]
      .reverse()
      .find(
        (item) =>
          String(item?.role || "") === "assistant" &&
          String(item?.type || "message") !== "tool_call",
      ) || null;
  }

  _buildWaitAsyncCompletedResult({
    sessionId = "",
    parentSessionId = "",
    messages = [],
    answerMessage = null,
    executionLogs = [],
  } = {}) {
    return {
      ok: true,
      status: "completed",
      sessionId,
      parentSessionId,
      result: {
        sessionId,
        parentSessionId,
        parentDialogProcessId: "",
        caller: "bot",
        answer: String(answerMessage?.content || ""),
        traces: [],
        messages: Array.isArray(messages) ? messages : [],
        turnTasks: [],
        executionLogs: Array.isArray(executionLogs) ? executionLogs : [],
        dialogProcessId: String(answerMessage?.dialogProcessId || ""),
      },
    };
  }

  _buildWaitAsyncNotFoundResult({
    sessionId = "",
    parentSessionId = "",
  } = {}) {
    return {
      ok: false,
      status: "not_found",
      sessionId,
      parentSessionId,
    };
  }

  _buildAsyncDonePayload({
    ok = true,
    status = "completed",
    sessionId = "",
    parentSessionId = "",
    startedAt = "",
    endedAt = "",
    result = null,
    error = "",
  } = {}) {
    return {
      ok: Boolean(ok),
      status,
      sessionId,
      parentSessionId,
      startedAt,
      endedAt,
      result,
      error: String(error || ""),
    };
  }

  _notifyAsyncDone(onDone = null, payload = {}) {
    if (typeof onDone !== "function") return;
    try {
      onDone(payload);
    } catch {}
  }

  _markAsyncJobTerminal({
    job = null,
    key = "",
    status = "failed",
    result = null,
    error = "",
  }) {
    if (!job || typeof job !== "object") return;
    job.status = String(status || "failed");
    job.endedAt = this._now();
    job.result = result;
    job.error = String(error || "");
    this._scheduleAsyncJobCleanup(key);
  }

  async _waitAsyncJobWithTimeout(job = null, timeoutMs = DEFAULT_WAIT_ASYNC_TIMEOUT_MS) {
    if (!job?.promise) return { timeout: false, result: null };
    let timeoutHandle = null;
    const timeoutSignal = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    });
    try {
      const raceResult = await Promise.race([
        job.promise.then((resultPayload) => ({
          timeout: false,
          result: resultPayload,
        })),
        timeoutSignal,
      ]);
      return raceResult;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async _buildWaitAsyncFallbackResult({
    userId,
    parentSessionId,
    sessionId,
  }) {
    const bundle = await this.session.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    if (!bundle?.exists) {
      return this._buildWaitAsyncNotFoundResult({
        sessionId,
        parentSessionId,
      });
    }
    const sessionItem =
      (Array.isArray(bundle?.sessions) ? bundle.sessions : []).find(
        (item) => String(item?.sessionId || "") === String(sessionId || ""),
      ) || {};
    const messages = Array.isArray(sessionItem?.messages)
      ? sessionItem.messages
      : [];
    const answerMessage = this._findAssistantAnswerMessage(messages);
    const executionBundle = await this.session.getExecutionBundle({
      userId,
      sessionId,
    });
    return this._buildWaitAsyncCompletedResult({
      sessionId,
      parentSessionId,
      messages,
      answerMessage,
      executionLogs: Array.isArray(executionBundle?.logs)
        ? executionBundle.logs
        : [],
    });
  }

  _buildAsyncSubAgentEventListener({
    upstream = null,
    parentSessionId = "",
    subSessionId = "",
    task = "",
    sourceDialogProcessId = "",
  }) {
    if (!upstream?.onEvent) return null;
    const label = `${tSystem("agent.subTaskLabelPrefix")}#${String(subSessionId || "").slice(0, 8)}`;
    return {
      onEvent: (eventPayload = {}) => {
        const event = String(eventPayload?.event || "");
        const data = eventPayload?.data || {};
        const ts = eventPayload?.ts || this._now();
        upstream.onEvent({
          event,
          ts,
          data: {
            ...data,
            subAgentCall: true,
            subAgentLabel: label,
            subAgentSessionId: String(subSessionId || ""),
            subAgentParentSessionId: String(parentSessionId || ""),
            subAgentTask: String(task || ""),
            sourceDialogProcessId: String(sourceDialogProcessId || ""),
          },
        });
      },
    };
  }

  runAsyncSession({
    userId,
    parentSessionId,
    sessionId = "",
    task = "",
    sharedTaskSpec = "",
    attachments = [],
    eventListener = null,
    sourceDialogProcessId = "",
    parentDialogProcessId = "",
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    onDone = null,
    parentAsyncResultContainer = null,
  }) {
    const usedSessionId = this._resolveAsyncSessionId({
      userId,
      parentSessionId,
      sessionId,
    });
    const message = this._buildAsyncTaskMessage(task, sharedTaskSpec);

    const key = this._asyncJobKey({
      parentSessionId,
      sessionId: usedSessionId,
    });
    const existingJob = this.asyncJobs.get(key);
    if (existingJob?.promise) {
      return this._buildAsyncJobResponse({
        status: existingJob.status || "running",
        sessionId: usedSessionId,
        parentSessionId,
        startedAt: existingJob.startedAt || this._now(),
        endedAt: existingJob.endedAt || "",
        result: existingJob.result || null,
        error: existingJob.error || "",
        parentDialogProcessId,
        parentAsyncResultContainer,
      });
    }
    const startedAt = this._now();
    const resolvedParentAsyncResultContainer = isPlainObject(
      parentAsyncResultContainer,
    )
      ? parentAsyncResultContainer
      : {};
    this.upsertParentAsyncTask({
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      sessionId: usedSessionId,
      parentSessionId,
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
    const job = this._createAsyncJob({
      key,
      sessionId: usedSessionId,
      parentSessionId,
      startedAt,
      task,
      sharedTaskSpec,
    });
    this.asyncJobs.set(key, job);

    const asyncEventListener = this._buildAsyncSubAgentEventListener({
      upstream: eventListener,
      parentSessionId,
      subSessionId: usedSessionId,
      task,
      sourceDialogProcessId,
    });

    job.promise = this.runSession({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      parentDialogProcessId,
      caller: "bot",
      message,
      attachments,
      eventListener: asyncEventListener,
      abortSignal,
      userInteractionBridge,
      runConfig,
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
    })
      .then((result) => {
        this._markAsyncJobTerminal({
          job,
          key,
          status: "completed",
          result,
          error: "",
        });
        this._notifyAsyncDone(onDone, this._buildAsyncDonePayload({
          ok: true,
          status: "completed",
          sessionId: usedSessionId,
          parentSessionId,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
          result,
          error: "",
        }));
        return result;
      })
      .catch((error) => {
        if (isAbortError(error)) {
          this._markAsyncJobTerminal({
            job,
            key,
            status: "stopped",
            result: null,
            error: "dialog stopped by user",
          });
          this._notifyAsyncDone(onDone, this._buildAsyncDonePayload({
            ok: true,
            status: "stopped",
            sessionId: usedSessionId,
            parentSessionId,
            startedAt: job.startedAt,
            endedAt: job.endedAt,
            result: null,
            error: job.error,
          }));
          return null;
        }
        const errorMessage = error?.message || String(error);
        this._markAsyncJobTerminal({
          job,
          key,
          status: "failed",
          result: null,
          error: errorMessage,
        });
        this._notifyAsyncDone(onDone, this._buildAsyncDonePayload({
          ok: false,
          status: "failed",
          sessionId: usedSessionId,
          parentSessionId,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
          result: null,
          error: errorMessage,
        }));
        void this.errorLogger.log({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          source: "BotManager.runAsyncSession",
          event: "run_async_session_failed",
          error,
          extra: { task, sharedTaskSpec },
        });
        return null;
      });

    return this._buildAsyncJobResponse({
      status: "running",
      sessionId: usedSessionId,
      parentSessionId,
      startedAt,
      parentDialogProcessId,
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
    });
  }

  async waitAsyncSession({
    userId,
    parentSessionId,
    sessionId,
    timeoutMs = DEFAULT_WAIT_ASYNC_TIMEOUT_MS,
  }) {
    try {
      this._validateWaitAsyncInput({
        userId,
        parentSessionId,
        sessionId,
      });

      const key = this._asyncJobKey({ parentSessionId, sessionId });
      const job = this.asyncJobs.get(key);
      const normalizedTimeoutMs = this._normalizeWaitAsyncTimeout(timeoutMs);

      if (!job?.promise) {
        return this._buildWaitAsyncFallbackResult({
          userId,
          parentSessionId,
          sessionId,
        });
      }

      const result = await this._waitAsyncJobWithTimeout(
        job,
        normalizedTimeoutMs,
      );

      if (result?.timeout) {
        return this._buildWaitAsyncRunningResult({
          sessionId,
          parentSessionId,
          startedAt: job.startedAt,
        });
      }

      if (job.status !== "running") {
        this._scheduleAsyncJobCleanup(key, ASYNC_JOB_FAST_CLEANUP_MS);
      }
      return {
        ok: true,
        status: job.status,
        sessionId,
        parentSessionId,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        result: result?.result || null,
        error: job.error || "",
      };
    } catch (error) {
      await this.errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: "BotManager.waitAsyncSession",
        event: "wait_async_session_failed",
        error,
      });
      throw error;
    }
  }
}
