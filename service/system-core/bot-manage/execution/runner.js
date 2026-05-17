/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import { emitEvent } from "../../event/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { isAbortError } from "../../utils/error-utils.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
  CALLER_ROLE,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
  SESSION_ASYNC_STATUS,
} from "../config/constants.js";

/**
 * Main execution runner (pipeline orchestration).
 */
export class SessionExecutionRunner {
  constructor({
    agentRunner,
    errorLogger,
    normalizeRunMessage,
    validateRunInput,
    ensureParentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    buildAgentContext,
    appendSessionTurn,
    buildRunTurnAgentContext,
    finalizeRunSession,
    upsertParentAsyncTask,
    now,
  } = {}) {
    this.agentRunner = agentRunner;
    this.errorLogger = errorLogger;
    this.normalizeRunMessage = normalizeRunMessage;
    this.validateRunInput = validateRunInput;
    this.ensureParentAsyncResultContainer = ensureParentAsyncResultContainer;
    this.initializeRunSessionRuntime = initializeRunSessionRuntime;
    this.resolveScenarioRunConfig = resolveScenarioRunConfig;
    this.buildAgentContext = buildAgentContext;
    this.appendSessionTurn = appendSessionTurn;
    this.buildRunTurnAgentContext = buildRunTurnAgentContext;
    this.finalizeRunSession = finalizeRunSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    parentAsyncResultContainer = null,
  }) {
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    try {
      const normalizedMessage = this.normalizeRunMessage(message);
      this.validateRunInput({ userId, sessionId, caller, parentSessionId });
      resolvedParentAsyncResultContainer = this.ensureParentAsyncResultContainer({
        parentAsyncResultContainer,
        caller,
        parentSessionId,
        parentDialogProcessId,
      });

      const {
        usedSessionId,
        dialogProcessId,
        isContinue,
        userConfig,
        currentSessionModelAlias,
        executionStartIndex,
        runtimeEventListener,
      } = await this.initializeRunSessionRuntime({
        userId,
        sessionId,
        parentSessionId,
        caller,
        eventListener,
      });
      const resolvedRunConfig = this.resolveScenarioRunConfig(
        runConfig,
        userConfig,
      );
      if (
        !String(resolvedRunConfig?.runtimeModel || "").trim() &&
        String(currentSessionModelAlias || "").trim()
      ) {
        resolvedRunConfig.runtimeModel = String(currentSessionModelAlias || "").trim();
      }

      const agentContext = await this.buildAgentContext({
        mode: isContinue ? "continue" : "initial",
        userId,
        sessionId: usedSessionId,
        caller,
        parentSessionId,
        userConfig,
        attachmentMetas: attachments,
        eventListener: runtimeEventListener,
        dialogProcessId,
        userInteractionBridge,
        runConfig: resolvedRunConfig,
        abortSignal,
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      });
      const runtimeAttachmentMetas = Array.isArray(
        agentContext?.execution?.controllers?.runtime?.attachmentMetas,
      )
        ? agentContext.execution.controllers.runtime.attachmentMetas
        : [];
      const userMessageAttachmentMetas = mapAttachmentRecordsToMetas(
        runtimeAttachmentMetas,
        {
          fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
          userId,
        },
      );

      await this.appendSessionTurn({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        role: MESSAGE_ROLE.USER,
        content: normalizedMessage,
        type: MESSAGE_TYPE.MESSAGE,
        attachmentMetas: userMessageAttachmentMetas,
        dialogProcessId,
        parentDialogProcessId,
        eventListener: runtimeEventListener,
      });

      const runtimeAgentContext = this.buildRunTurnAgentContext(
        agentContext,
        abortSignal,
      );
      const agentResult = await this.agentRunner({
        errorLogger: this.errorLogger,
        agentContext: runtimeAgentContext,
        userMessage: normalizedMessage,
      });
      emitEvent(runtimeEventListener, "agent_done", {
        sessionId: usedSessionId,
        traceCount: agentResult?.traces?.length || 0,
      });

      return this.finalizeRunSession({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller,
        dialogProcessId,
        agentResult,
        executionStartIndex,
        runtimeEventListener,
        userConfig,
        resolvedParentAsyncResultContainer,
      });
    } catch (error) {
      this.upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId,
        parentSessionId,
        patch: {
          status: isAbortError(error)
            ? SESSION_ASYNC_STATUS.STOPPED
            : SESSION_ASYNC_STATUS.FAILED,
          endedAt: this.now(),
          error: isAbortError(error)
            ? tSystem("ws.dialogStoppedByUser")
            : error?.message || String(error),
          result: null,
        },
      });
      if (isAbortError(error)) {
        throw error;
      }
      await this.errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: BOT_MANAGE_LOG_SOURCE.RUN_SESSION,
        event: BOT_MANAGE_LOG_EVENT.RUN_SESSION_FAILED,
        error,
      });
      throw error;
    }
  }
}
