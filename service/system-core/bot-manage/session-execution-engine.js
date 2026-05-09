/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";
import { ContextBuilder } from "../context/index.js";
import { mapAttachmentRecordsToMetas } from "../attach/index.js";
import { runAgentTurn } from "../agent/index.js";
import { createExecutionEventListener, emitEvent } from "../event/index.js";
import { recoverableToolError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import { isAbortError } from "../utils/error-utils.js";
import { isPlainObject } from "../utils/shared-utils.js";

function isValidSessionId(sessionId = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(sessionId || ""),
  );
}

export class SessionExecutionEngine {
  constructor({
    globalConfig = {},
    session = null,
    memory = null,
    attach = null,
    skill = null,
    configService = null,
    workspaceService = null,
    errorLogger = null,
    botManager = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.configService = configService;
    this.workspaceService = workspaceService;
    this.errorLogger = errorLogger;
    this.botManager = botManager;
  }

  _now() {
    return new Date().toISOString();
  }

  _normalizeRunMessage(message = "") {
    const normalizedMessage = String(message ?? "").trim();
    if (!normalizedMessage) {
      throw recoverableToolError(tSystem("common.userSessionMessageRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    return normalizedMessage;
  }

  _validateRunInput({
    userId,
    sessionId,
    caller = "user",
    parentSessionId = "",
  }) {
    if (!userId || !sessionId) {
      throw recoverableToolError(tSystem("common.userSessionRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    if (!isValidSessionId(sessionId)) {
      throw recoverableToolError(tSystem("bot.invalidSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_SESSION_ID",
      });
    }
    if (!["user", "bot"].includes(String(caller || ""))) {
      throw recoverableToolError(tSystem("bot.invalidCaller"), {
        code: "RECOVERABLE_INVALID_CALLER",
      });
    }
    if (parentSessionId && !isValidSessionId(parentSessionId)) {
      throw recoverableToolError(tSystem("bot.invalidParentSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_PARENT_SESSION_ID",
      });
    }
  }

  _upsertParentAsyncTask({
    parentAsyncResultContainer = null,
    sessionId = "",
    parentSessionId = "",
    task = "",
    sharedTaskSpec = "",
    patch = {},
  }) {
    if (!isPlainObject(parentAsyncResultContainer)) return null;
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    if (!Array.isArray(parentAsyncResultContainer.tasks)) {
      parentAsyncResultContainer.tasks = [];
    }
    const taskList = parentAsyncResultContainer.tasks;
    const targetIndex = taskList.findIndex(
      (item) => String(item?.sessionId || "").trim() === normalizedSessionId,
    );
    const baseTask =
      targetIndex >= 0
        ? taskList[targetIndex] || {}
        : {
            sessionId: normalizedSessionId,
            parentSessionId: String(parentSessionId || "").trim(),
            task: String(task || "").trim(),
            sharedTaskSpec: String(sharedTaskSpec || "").trim(),
            status: "running",
            startedAt: "",
            endedAt: "",
            error: "",
            result: null,
          };
    const mergedTask = {
      ...baseTask,
      ...(isPlainObject(patch) ? patch : {}),
      sessionId: normalizedSessionId,
    };
    if (targetIndex >= 0) {
      taskList[targetIndex] = mergedTask;
    } else {
      taskList.push(mergedTask);
    }
    parentAsyncResultContainer.updatedAt = this._now();
    let hasFailed = false;
    let hasRunning = false;
    let hasStopped = false;
    let allCompleted = taskList.length > 0;
    for (const taskItem of taskList) {
      const status = String(taskItem?.status || "running").trim().toLowerCase();
      if (status === "failed") hasFailed = true;
      if (status === "running") hasRunning = true;
      if (status === "stopped") hasStopped = true;
      if (status !== "completed") allCompleted = false;
    }
    if (hasFailed) {
      parentAsyncResultContainer.status = "failed";
    } else if (hasRunning) {
      parentAsyncResultContainer.status = "running";
    } else if (allCompleted) {
      parentAsyncResultContainer.status = "completed";
    } else if (hasStopped) {
      parentAsyncResultContainer.status = "stopped";
    } else {
      parentAsyncResultContainer.status = "running";
    }
    return mergedTask;
  }

  _ensureParentAsyncResultContainer({
    parentAsyncResultContainer = null,
    caller = "user",
    parentSessionId = "",
    parentDialogProcessId = "",
  }) {
    let container = parentAsyncResultContainer;
    if (!isPlainObject(container)) {
      if (String(caller || "user") !== "bot") return null;
      container = {};
    }
    container.id = String(container?.id || "").trim() || uuidv4();
    container.parentSessionId =
      String(container?.parentSessionId || "").trim() ||
      String(parentSessionId || "").trim();
    container.parentDialogProcessId =
      String(container?.parentDialogProcessId || "").trim() ||
      String(parentDialogProcessId || "").trim();
    container.status = String(container?.status || "running").trim() || "running";
    container.updatedAt =
      String(container?.updatedAt || "").trim() || this._now();
    container.tasks = Array.isArray(container?.tasks) ? container.tasks : [];
    return container;
  }

  _buildContextBuilder({
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachmentMetas,
    eventListener,
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    return new ContextBuilder({
      config: {
        globalConfig: this.globalConfig,
        userConfig,
      },
      serviceContainer: {
        eventListener,
        sessionManager: this.session,
        memoryService: this.memory,
        attachmentService: this.attach,
        skillService: this.skill,
        botManager: this.botManager,
        userInteractionBridge,
      },
      sessionContext: {
        userId,
        sessionId,
        caller,
        parentSessionId,
        attachmentMetas,
        runConfig,
        abortSignal,
        parentAsyncResultContainer,
      },
    });
  }

  _applyRunConfigToolPolicy(agentContext = {}, runConfig = {}) {
    const sourceTools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
    if (!sourceTools.length) return agentContext;
    const toolPolicy = runConfig?.toolPolicy || {};
    const mode = String(toolPolicy?.mode || "").trim().toLowerCase();
    const customTools = Array.isArray(toolPolicy?.customTools)
      ? toolPolicy.customTools.filter(Boolean)
      : [];
    const configuredIncludeToolNames = Array.isArray(toolPolicy?.includeToolNames)
      ? toolPolicy.includeToolNames
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      : [];
    const includeToolNames = Array.from(
      new Set([
        ...configuredIncludeToolNames,
        ...(runConfig?.allowUserInteraction !== false &&
        runConfig?.toolPolicy?.forceIncludeUserInteraction !== false
          ? ["user_interaction"]
          : []),
      ]),
    );
    const includedTools = includeToolNames.length
      ? sourceTools.filter((toolItem) =>
          includeToolNames.includes(String(toolItem?.name || "")),
        )
      : [];

    let nextTools = sourceTools;
    if (mode === "custom_only") {
      nextTools = [...customTools, ...includedTools];
    } else if (mode === "append_custom" && customTools.length) {
      nextTools = [...sourceTools, ...customTools];
    }

    const allowToolNames = Array.isArray(toolPolicy?.allowToolNames)
      ? toolPolicy.allowToolNames
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      : [];
    if (allowToolNames.length) {
      const allowSet = new Set(allowToolNames);
      nextTools = nextTools.filter((toolItem) =>
        allowSet.has(String(toolItem?.name || "")),
      );
    }

    const dedupedTools = [];
    const seenNames = new Set();
    for (const toolItem of nextTools) {
      const toolName = String(toolItem?.name || "").trim();
      if (!toolName || seenNames.has(toolName)) continue;
      seenNames.add(toolName);
      dedupedTools.push(toolItem);
    }
    return {
      ...agentContext,
      payload: {
        ...(agentContext?.payload || {}),
        tools: {
          ...(agentContext?.payload?.tools || {}),
          registry: dedupedTools,
        },
      },
    };
  }

  async _buildAgentContext({
    mode,
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachmentMetas,
    eventListener,
    dialogProcessId = "",
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    const contextBuilder = this._buildContextBuilder({
      userId,
      sessionId,
      caller,
      parentSessionId,
      userConfig,
      attachmentMetas,
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });
    emitEvent(eventListener, "context_building", { sessionId, mode });
    const agentContext =
      mode === "initial"
        ? await contextBuilder.buildInitialContext({ dialogProcessId })
        : await contextBuilder.buildContinueContext({ dialogProcessId });
    const scopedAgentContext = this._applyRunConfigToolPolicy(
      agentContext,
      runConfig,
    );
    emitEvent(eventListener, "context_ready", {
      sessionId,
      messageCount:
        scopedAgentContext?.payload?.messages?.history?.length || 0,
    });
    return scopedAgentContext;
  }

  async _appendSessionTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    tool_calls = null,
    tool_call_id = "",
    attachmentMetas = [],
    modelAlias = "",
    modelName = "",
    dialogProcessId = "",
    parentDialogProcessId = "",
    parentSessionId = "",
    eventListener,
  }) {
    await this.session.appendTurn({
      userId,
      sessionId,
      parentSessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      parentDialogProcessId,
      tool_calls,
      tool_call_id,
      attachmentMetas,
      modelAlias,
      modelName,
    });
    emitEvent(eventListener, `${role}_message_saved`, { sessionId });
  }

  async _appendAgentMessages({
    userId,
    sessionId,
    parentSessionId = "",
    messages = [],
    dialogProcessId = "",
    parentDialogProcessId = "",
    eventListener,
  }) {
    for (const messageItem of messages) {
      await this._appendSessionTurn({
        userId,
        sessionId,
        role: messageItem.role || "assistant",
        content: messageItem.content || "",
        type: messageItem.type || "",
        parentSessionId,
        dialogProcessId: messageItem.dialogProcessId || dialogProcessId || "",
        parentDialogProcessId:
          messageItem.parentDialogProcessId || parentDialogProcessId || "",
        taskId: messageItem.taskId || null,
        taskStatus: messageItem.taskStatus || null,
        tool_calls: Array.isArray(messageItem.tool_calls)
          ? messageItem.tool_calls
          : null,
        tool_call_id: messageItem.tool_call_id || "",
        attachmentMetas: Array.isArray(messageItem.attachmentMetas)
          ? messageItem.attachmentMetas
          : null,
        modelAlias: String(messageItem.modelAlias || "").trim(),
        modelName: String(messageItem.modelName || "").trim(),
        eventListener,
      });
    }
  }

  _buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
    return {
      ...agentContext,
      execution: {
        ...(agentContext?.execution || {}),
        controllers: {
          ...(agentContext?.execution?.controllers || {}),
          runtime: {
            ...(agentContext?.execution?.controllers?.runtime || {}),
            abortSignal,
          },
        },
      },
      payload: {
        ...(agentContext?.payload || {}),
        tools: {
          ...(agentContext?.payload?.tools || {}),
          registry: Array.isArray(agentContext?.payload?.tools?.registry)
            ? agentContext.payload.tools.registry
            : [],
        },
      },
    };
  }

  async _initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId = "",
    caller = "user",
    eventListener = null,
  }) {
    const usedSessionId = sessionId;
    const upstreamListener = eventListener;
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);

    await this.session.upsertSessionTree({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
    });

    const dialogProcessId = uuidv4();
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
    });
    const isContinue = Boolean(sessionBundle?.exists);
    const userConfig = await this.configService.loadUserConfig(basePath);

    await this.session.createSession({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      caller,
      modelAlias: "",
    });

    const executionStartIndex =
      (await this.session.getExecutionBundle({
        userId,
        sessionId: usedSessionId,
      }))?.logs?.length || 0;

    const runtimeEventListener = createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      upstream: { ...upstreamListener, dialogProcessId },
    });

    emitEvent(runtimeEventListener, "session_starting", {
      mode: isContinue ? "continue" : "new",
      ...(isContinue ? { sessionId: usedSessionId } : {}),
    });
    emitEvent(runtimeEventListener, "workspace_ready", { userId });
    emitEvent(
      runtimeEventListener,
      isContinue ? "session_loaded" : "session_created",
      { sessionId: usedSessionId },
    );

    return {
      usedSessionId,
      dialogProcessId,
      isContinue,
      userConfig,
      executionStartIndex,
      runtimeEventListener,
    };
  }

  async _finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = "user",
    dialogProcessId = "",
    agentResult = {},
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
  }) {
    await this._appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: agentResult?.turnMessages || [
        {
          role: "assistant",
          content: agentResult.output || "",
          type: "message",
          dialogProcessId,
        },
      ],
      dialogProcessId,
      parentDialogProcessId,
      eventListener: runtimeEventListener,
    });
    await this.session.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks: agentResult?.turnTasks || [],
    });

    await this.memory.captureSessionToShortMemory({
      userId,
      sessionId,
      parentSessionId,
      userConfig,
    });
    emitEvent(runtimeEventListener, "short_memory_captured", {
      sessionId,
    });
    await this.memory.maybeSummarize({ userId, userConfig });
    emitEvent(runtimeEventListener, "memory_summary_checked", {
      sessionId,
    });

    const execution = await this.session.getExecutionBundle({
      userId,
      sessionId,
    });
    const executionLogs = (execution?.logs || []).slice(executionStartIndex);
    this._upsertParentAsyncTask({
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      sessionId,
      parentSessionId,
      patch: {
        status: "completed",
        endedAt: this._now(),
        error: "",
        result: {
          sessionId,
          parentSessionId: parentSessionId || "",
          parentDialogProcessId: parentDialogProcessId || "",
          caller: String(caller || "user"),
          answer: agentResult.output,
          traces: agentResult.traces,
          messages: agentResult?.turnMessages || [],
          turnTasks: agentResult?.turnTasks || [],
          executionLogs,
          dialogProcessId,
        },
      },
    });

    return {
      sessionId,
      parentSessionId: parentSessionId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      caller: String(caller || "user"),
      answer: agentResult.output,
      traces: agentResult.traces,
      messages: agentResult?.turnMessages || [],
      turnTasks: agentResult?.turnTasks || [],
      executionLogs,
      dialogProcessId,
      ...(resolvedParentAsyncResultContainer
        ? { parentAsyncResultContainer: resolvedParentAsyncResultContainer }
        : {}),
    };
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
    caller = "user",
    parentSessionId = "",
    parentDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    parentAsyncResultContainer = null,
  }) {
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    try {
      const normalizedMessage = this._normalizeRunMessage(message);
      this._validateRunInput({ userId, sessionId, caller, parentSessionId });
      resolvedParentAsyncResultContainer = this._ensureParentAsyncResultContainer({
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
        executionStartIndex,
        runtimeEventListener,
      } = await this._initializeRunSessionRuntime({
        userId,
        sessionId,
        parentSessionId,
        caller,
        eventListener,
      });

      const agentContext = await this._buildAgentContext({
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
        runConfig,
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
          fallbackMimeType: "application/octet-stream",
          userId,
        },
      );

      await this._appendSessionTurn({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        role: "user",
        content: normalizedMessage,
        type: "message",
        attachmentMetas: userMessageAttachmentMetas,
        dialogProcessId,
        parentDialogProcessId,
        eventListener: runtimeEventListener,
      });

      const agentResult = await runAgentTurn({
        errorLogger: this.errorLogger,
        agentContext: this._buildRunTurnAgentContext(agentContext, abortSignal),
        userMessage: normalizedMessage,
      });
      emitEvent(runtimeEventListener, "agent_done", {
        sessionId: usedSessionId,
        traceCount: agentResult?.traces?.length || 0,
      });

      return this._finalizeRunSession({
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
      this._upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId,
        parentSessionId,
        patch: {
          status: isAbortError(error) ? "stopped" : "failed",
          endedAt: this._now(),
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
        source: "BotManager.runSession",
        event: "run_session_failed",
        error,
      });
      throw error;
    }
  }

  async startNewSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
  }) {
    if (!sessionId) {
      throw recoverableToolError(tSystem("common.sessionIdRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: "user",
      parentSessionId: "",
    });
  }

  async continueSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
  }) {
    if (!sessionId) {
      throw recoverableToolError(tSystem("common.sessionIdRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: "user",
      parentSessionId: "",
    });
  }
}
