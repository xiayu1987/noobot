/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { SessionManager } from "../session/index.js";
import { MemoryService } from "../memory/index.js";
import { ContextBuilder } from "../context/index.js";
import { AttachmentService, mapAttachmentRecordsToMetas } from "../attach/index.js";
import { SkillService } from "../skill/index.js";
import { runAgentTurn } from "../agent/engine.js";
import { resolveConfigSecrets, sanitizeUserConfig } from "../config/index.js";
import { createExecutionEventListener, emitEvent } from "../event/index.js";
import {
  ensureUserWorkspaceInitialized,
  resetUserWorkspaceKeepRuntimeInitialized,
  syncUserWorkspaceFromTemplate,
} from "../init/index.js";
import { appendSystemErrorLog } from "../tracking/index.js";
import { recoverableToolError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";

function isValidSessionId(sessionId = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(sessionId || ""),
  );
}

function isAbortError(error) {
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  return (
    name === "AbortError" ||
    name.toLowerCase() === "aborterror" ||
    code === "ABORT_ERR" ||
    message === "aborterror" ||
    message.includes("aborterror") ||
    message.includes("stopped by user") ||
    message.includes("aborted")
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfigParams(input = {}) {
  const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
  return Object.fromEntries(
    Object.entries(rawValues)
      .map(([paramKey, paramValue]) => [
        String(paramKey || "").trim(),
        String(paramValue ?? "").trim(),
      ])
      .filter(([paramKey]) => Boolean(paramKey)),
  );
}

function mergeConfigParamsWithFallback(systemParams = {}, userParams = {}) {
  const base = {
    ...(systemParams && typeof systemParams === "object" ? systemParams : {}),
  };
  const userSource = userParams && typeof userParams === "object" ? userParams : {};
  for (const [paramKey, rawValue] of Object.entries(userSource)) {
    const normalizedKey = String(paramKey || "").trim();
    if (!normalizedKey) continue;
    const normalizedValue = String(rawValue ?? "").trim();
    if (!normalizedValue) continue;
    base[normalizedKey] = normalizedValue;
  }
  return base;
}

export class BotManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.session = new SessionManager(globalConfig);
    this.memory = new MemoryService(globalConfig);
    this.attach = new AttachmentService(globalConfig);
    this.skill = new SkillService(globalConfig);
    this.asyncJobs = new Map();
  }

  _now() {
    return new Date().toISOString();
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

  getWorkspacePath(userId) {
    return path.resolve(this.globalConfig.workspaceRoot, userId);
  }

  async ensureUserWorkspace(userId) {
    return ensureUserWorkspaceInitialized({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      globalConfig: this.globalConfig,
    });
  }

  async resetUserWorkspace(userId, options = {}) {
    return resetUserWorkspaceKeepRuntimeInitialized({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      resetSections: Array.isArray(options?.sections) ? options.sections : [],
      globalConfig: this.globalConfig,
    });
  }

  async syncUserWorkspace(userId) {
    return syncUserWorkspaceFromTemplate({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      globalConfig: this.globalConfig,
    });
  }

  getAttachmentById({
    userId,
    attachmentId,
    sessionId = "",
    attachmentSource = "",
  }) {
    return this.attach.getAttachmentById({
      userId,
      attachmentId,
      sessionId,
      attachmentSource,
    });
  }

  async loadUserConfig(basePath) {
    const [rawText, userConfigParamsRawText] = await Promise.all([
      readFile(path.join(basePath, "config.json"), "utf8"),
      readFile(path.join(basePath, "config-params.json"), "utf8").catch(() => "{}"),
    ]);
    const raw = JSON.parse(rawText);
    let userConfigParamsJson = {};
    try {
      userConfigParamsJson = JSON.parse(String(userConfigParamsRawText || "{}"));
    } catch {
      userConfigParamsJson = {};
    }
    const userConfigParams = normalizeConfigParams(userConfigParamsJson);
    const systemConfigParams =
      this.globalConfig?.configParams && typeof this.globalConfig.configParams === "object"
        ? this.globalConfig.configParams
        : {};
    const mergedConfigParams = mergeConfigParamsWithFallback(
      systemConfigParams,
      userConfigParams,
    );
    const resolvedRaw = resolveConfigSecrets(raw, {
      configParams: mergedConfigParams,
    });
    const sanitized = sanitizeUserConfig(resolvedRaw);
    return {
      ...sanitized,
      configParams: mergedConfigParams,
    };
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
        botManager: this,
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
    const normalizedStatuses = taskList.map((item) =>
      String(item?.status || "running"),
    );
    if (normalizedStatuses.some((status) => status === "failed")) {
      parentAsyncResultContainer.status = "failed";
    } else if (normalizedStatuses.every((status) => status === "completed")) {
      parentAsyncResultContainer.status = "completed";
    } else if (normalizedStatuses.some((status) => status === "stopped")) {
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

  async _logSystemError({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    source = "bot-manage",
    event = "system_error",
    error = null,
    extra = {},
  }) {
    try {
      const basePath = await this.ensureUserWorkspace(userId);
      await appendSystemErrorLog({
        basePath,
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
        userId,
        sessionId,
        parentSessionId,
        source,
        event,
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        extra,
      });
    } catch (logError) {
      // eslint-disable-next-line no-console
      console.error("[system_error][log_write_failed]", logError);
    }
  }

  _asyncJobKey({ parentSessionId = "", sessionId = "" }) {
    return `${String(parentSessionId || "")}::${String(sessionId || "")}`;
  }

  _buildAsyncSubAgentEventListener({
    upstream = null,
    parentSessionId = "",
    subSessionId = "",
    task = "",
    sourceDialogProcessId = "",
  }) {
    if (!upstream?.onEvent) return null;
    const label = `子任务#${String(subSessionId || "").slice(0, 8)}`;
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
      if (!message) {
        throw recoverableToolError(tSystem("common.userSessionMessageRequired"), {
          code: "RECOVERABLE_INPUT_MISSING",
        });
      }
      this._validateRunInput({ userId, sessionId, caller, parentSessionId });
      resolvedParentAsyncResultContainer = this._ensureParentAsyncResultContainer({
        parentAsyncResultContainer,
        caller,
        parentSessionId,
        parentDialogProcessId,
      });

      const usedSessionId = sessionId;
      const upstreamListener = eventListener;
      const basePath = await this.ensureUserWorkspace(userId);

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
      const userConfig = await this.loadUserConfig(basePath);

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
        content: message,
        type: "message",
        attachmentMetas: userMessageAttachmentMetas,
        dialogProcessId,
        parentDialogProcessId,
        eventListener: runtimeEventListener,
      });

      const agentResult = await runAgentTurn({
        agentContext: {
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
        },
        userMessage: message,
      });
      emitEvent(runtimeEventListener, "agent_done", {
        sessionId: usedSessionId,
        traceCount: agentResult?.traces?.length || 0,
      });

      await this._appendAgentMessages({
        userId,
        sessionId: usedSessionId,
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
        sessionId: usedSessionId,
        parentSessionId,
        currentTurnTasks: agentResult?.turnTasks || [],
      });

      await this.memory.captureSessionToShortMemory({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        userConfig,
      });
      emitEvent(runtimeEventListener, "short_memory_captured", {
        sessionId: usedSessionId,
      });
      await this.memory.maybeSummarize({ userId, userConfig });
      emitEvent(runtimeEventListener, "memory_summary_checked", {
        sessionId: usedSessionId,
      });

      const execution = await this.session.getExecutionBundle({
        userId,
        sessionId: usedSessionId,
      });
      const executionLogs = (execution?.logs || []).slice(executionStartIndex);
      this._upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId: usedSessionId,
        parentSessionId,
        patch: {
          status: "completed",
          endedAt: this._now(),
          error: "",
          result: {
            sessionId: usedSessionId,
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
        sessionId: usedSessionId,
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
    } catch (error) {
      this._upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId,
        parentSessionId,
        patch: {
          status: isAbortError(error) ? "stopped" : "failed",
          endedAt: this._now(),
          error: isAbortError(error)
            ? "dialog stopped by user"
            : error?.message || String(error),
          result: null,
        },
      });
      if (isAbortError(error)) {
        throw error;
      }
      await this._logSystemError({
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

    const message = [
      `${tSystem("bot.taskPrefix")}: ${task || ""}`,
      `${tSystem("bot.sharedTaskSpecPrefix")}: ${sharedTaskSpec || ""}`,
    ].join("\n");

    const key = this._asyncJobKey({
      parentSessionId,
      sessionId: usedSessionId,
    });
    const startedAt = this._now();
    const resolvedParentAsyncResultContainer = isPlainObject(
      parentAsyncResultContainer,
    )
      ? parentAsyncResultContainer
      : {};
    this._upsertParentAsyncTask({
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
    const job = {
      key,
      sessionId: usedSessionId,
      parentSessionId,
      status: "running",
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      input: { task, sharedTaskSpec },
      promise: null,
    };
    this.asyncJobs.set(key, job);

    const asyncEventListener = this._buildAsyncSubAgentEventListener({
      upstream: eventListener,
      parentSessionId,
      subSessionId: usedSessionId,
      task,
      sourceDialogProcessId,
    });
    const notifyDone = (payload = {}) => {
      if (typeof onDone !== "function") return;
      try {
        onDone(payload);
      } catch {}
    };

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
        job.status = "completed";
        job.endedAt = this._now();
        job.result = result;
        notifyDone({
          ok: true,
          status: "completed",
          sessionId: usedSessionId,
          parentSessionId,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
          result,
          error: "",
        });
        return result;
      })
      .catch((error) => {
        if (isAbortError(error)) {
          job.status = "stopped";
          job.endedAt = this._now();
          job.error = "dialog stopped by user";
          notifyDone({
            ok: true,
            status: "stopped",
            sessionId: usedSessionId,
            parentSessionId,
            startedAt: job.startedAt,
            endedAt: job.endedAt,
            result: null,
            error: job.error,
          });
          return null;
        }
        job.status = "failed";
        job.endedAt = this._now();
        job.error = error?.message || String(error);
        notifyDone({
          ok: false,
          status: "failed",
          sessionId: usedSessionId,
          parentSessionId,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
          result: null,
          error: job.error,
        });
        void this._logSystemError({
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

    return {
      ok: true,
      status: "running",
      sessionId: usedSessionId,
      parentSessionId,
      parentDialogProcessId: parentDialogProcessId || "",
      startedAt,
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
    };
  }

  async waitAsyncSession({
    userId,
    parentSessionId,
    sessionId,
    timeoutMs = 120000,
    }) {
    try {
      if (!userId || !parentSessionId || !sessionId) {
        throw recoverableToolError(tSystem("common.userParentSessionSessionRequired"), {
          code: "RECOVERABLE_INPUT_MISSING",
        });
      }

      const key = this._asyncJobKey({ parentSessionId, sessionId });
      const job = this.asyncJobs.get(key);
      const normalizedTimeoutMs = Math.max(1000, Number(timeoutMs || 120000));

      if (!job?.promise) {
        const bundle = await this.session.getSessionBundle({
          userId,
          sessionId,
          parentSessionId,
        });
        if (bundle?.exists) {
          const sessionItem =
            (Array.isArray(bundle?.sessions) ? bundle.sessions : []).find(
              (item) => String(item?.sessionId || "") === String(sessionId || ""),
            ) || {};
          const messages = Array.isArray(sessionItem?.messages)
            ? sessionItem.messages
            : [];
          const answerMessage = [...messages]
            .reverse()
            .find(
              (item) =>
                String(item?.role || "") === "assistant" &&
                String(item?.type || "message") !== "tool_call",
            );
          const executionBundle = await this.session.getExecutionBundle({
            userId,
            sessionId,
          });
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
              messages,
              turnTasks: [],
              executionLogs: Array.isArray(executionBundle?.logs)
                ? executionBundle.logs
                : [],
              dialogProcessId: String(answerMessage?.dialogProcessId || ""),
            },
          };
        }
        return {
          ok: false,
          status: "not_found",
          sessionId,
          parentSessionId,
        };
      }

      const timeoutSignal = new Promise((resolve) =>
        setTimeout(() => resolve({ timeout: true }), normalizedTimeoutMs),
      );
      const result = await Promise.race([
        job.promise.then((resultPayload) => ({ result: resultPayload })),
        timeoutSignal,
      ]);

      if (result?.timeout) {
        return {
          ok: true,
          status: "running",
          sessionId,
          parentSessionId,
          startedAt: job.startedAt,
        };
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
      await this._logSystemError({
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
