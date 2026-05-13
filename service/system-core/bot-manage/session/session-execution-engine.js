/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";
import { ContextBuilder } from "../../context/index.js";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { runAgentTurn } from "../../agent/index.js";
import { createExecutionEventListener, emitEvent } from "../../event/index.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { mergeConfig } from "../../config/index.js";
import { isAbortError } from "../../utils/error-utils.js";
import { isPlainObject } from "../../utils/shared-utils.js";

const DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS = 300000;
const DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS = 5000;

function isAbortLikeError(error = {}) {
  const name = String(error?.name || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name.includes("abort") ||
    code === "abort_err" ||
    code === "aborted" ||
    message.includes("abort")
  );
}

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
    agentRunner = runAgentTurn,
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
    this.agentRunner = typeof agentRunner === "function" ? agentRunner : runAgentTurn;
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
    const normalizedSessionId = (sessionId ?? "").trim();
    if (!normalizedSessionId) return null;
    if (!Array.isArray(parentAsyncResultContainer.tasks)) {
      parentAsyncResultContainer.tasks = [];
    }
    const taskList = parentAsyncResultContainer.tasks;
    const targetIndex = taskList.findIndex(
      (item) => (item?.sessionId ?? "").trim() === normalizedSessionId,
    );
    const baseTask =
      targetIndex >= 0
        ? taskList[targetIndex] || {}
        : {
            sessionId: normalizedSessionId,
            parentSessionId: (parentSessionId ?? "").trim(),
            task: (task ?? "").trim(),
            sharedTaskSpec: (sharedTaskSpec ?? "").trim(),
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
      const status = (taskItem?.status || "running" || "").trim().toLowerCase();
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
    container.id = (container?.id ?? "").trim() || uuidv4();
    container.parentSessionId =
      (container?.parentSessionId ?? "").trim() ||
      (parentSessionId ?? "").trim();
    container.parentDialogProcessId =
      (container?.parentDialogProcessId ?? "").trim() ||
      (parentDialogProcessId ?? "").trim();
    container.status = (container?.status || "running" || "").trim() || "running";
    container.updatedAt =
      (container?.updatedAt ?? "").trim() || this._now();
    container.tasks = Array.isArray(container?.tasks) ? container.tasks : [];
    return container;
  }



  _normalizeStringArray(input = []) {
    return Array.isArray(input)
      ? input
          .map((item) => (item ?? "").trim())
          .filter(Boolean)
      : [];
  }

  _normalizeToolItems(input = []) {
    return Array.isArray(input)
      ? input.filter((item) => isPlainObject(item) && (item?.name ?? "").trim())
      : [];
  }

  _buildDefaultAssistantTurn({ agentResult = {}, dialogProcessId = "" }) {
    return {
      role: "assistant",
      content: String(agentResult?.output || ""),
      type: "message",
      dialogProcessId,
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

  _resolveMemorySummaryTimeoutMs(userConfig = {}) {
    const configured = Number(
      userConfig?.memory?.summarize_timeout_ms ??
        userConfig?.memory?.summarizeTimeoutMs ??
        userConfig?.memorySummarizeTimeoutMs ??
        this.globalConfig?.memory?.summarize_timeout_ms ??
        this.globalConfig?.memory?.summarizeTimeoutMs ??
        this.globalConfig?.memorySummarizeTimeoutMs ??
        DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS;
    }
    return Math.floor(configured);
  }

  _resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    const configured =
      userConfig?.memory?.summarize_async ??
      userConfig?.memory?.summarizeAsync ??
      userConfig?.memorySummarizeAsync ??
      this.globalConfig?.memory?.summarize_async ??
      this.globalConfig?.memory?.summarizeAsync ??
      this.globalConfig?.memorySummarizeAsync;
    if (configured === undefined || configured === null) return true;
    return configured !== false;
  }

  _resolveMemoryPostProcessAsyncEnabled(userConfig = {}) {
    const configured =
      userConfig?.memory?.postprocess_async ??
      userConfig?.memory?.postprocessAsync ??
      userConfig?.memoryPostprocessAsync ??
      this.globalConfig?.memory?.postprocess_async ??
      this.globalConfig?.memory?.postprocessAsync ??
      this.globalConfig?.memoryPostprocessAsync;
    if (configured === undefined || configured === null) return true;
    return configured !== false;
  }

  _resolveExecutionBundleTimeoutMs(userConfig = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, userConfig || {});
    const configured = Number(
      effectiveConfig?.session?.execution_bundle_timeout_ms ??
        effectiveConfig?.session?.executionBundleTimeoutMs ??
        DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS;
    }
    return Math.floor(configured);
  }

  async _runMemorySummarizeFlow({
    userId,
    sessionId,
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    const memorySummaryTimeoutMs = this._resolveMemorySummaryTimeoutMs(userConfig);
    let memorySummaryTimedOut = false;
    const memorySummaryAbortController = new AbortController();
    const memorySummaryTimer = setTimeout(() => {
      memorySummaryTimedOut = true;
      memorySummaryAbortController.abort();
    }, memorySummaryTimeoutMs);
    try {
      await this.memory.maybeSummarize({
        userId,
        userConfig,
        abortSignal: memorySummaryAbortController.signal,
      });
    } catch (error) {
      if (!isAbortLikeError(error) || !memorySummaryTimedOut) {
        emitEvent(runtimeEventListener, "memory_summary_failed", {
          sessionId,
          mode,
          error: error?.message || String(error),
        });
        if (this.errorLogger?.log) {
          await this.errorLogger.log({
            userId,
            sessionId,
            source: "SessionExecutionEngine._runMemorySummarizeFlow",
            event: "memory_summary_failed",
            error,
          });
        }
        throw error;
      }
    } finally {
      clearTimeout(memorySummaryTimer);
    }
    if (memorySummaryTimedOut) {
      emitEvent(runtimeEventListener, "memory_summary_timeout", {
        sessionId,
        mode,
        timeoutMs: memorySummaryTimeoutMs,
      });
    }
    emitEvent(runtimeEventListener, "memory_summary_checked", {
      sessionId,
      mode,
    });
  }

  async _runMemoryPostProcessFlow({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    try {
      await this.memory.captureSessionToShortMemory({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
      });
      emitEvent(runtimeEventListener, "short_memory_captured", {
        sessionId,
        mode,
      });
      const memorySummaryAsyncEnabled =
        this._resolveMemorySummaryAsyncEnabled(userConfig);
      if (memorySummaryAsyncEnabled) {
        emitEvent(runtimeEventListener, "memory_summary_scheduled", {
          sessionId,
          mode: "async",
        });
      }
      await this._runMemorySummarizeFlow({
        userId,
        sessionId,
        userConfig,
        runtimeEventListener,
        mode: memorySummaryAsyncEnabled ? "async" : "sync",
      });
    } catch (error) {
      emitEvent(runtimeEventListener, "memory_postprocess_failed", {
        sessionId,
        mode,
        error: error?.message || String(error),
      });
      if (this.errorLogger?.log) {
        await this.errorLogger.log({
          userId,
          sessionId,
          parentSessionId,
          source: "SessionExecutionEngine._runMemoryPostProcessFlow",
          event: "memory_postprocess_failed",
          error,
        });
      }
      throw error;
    }
  }

  _applyRunConfigToolPolicy(agentContext = {}, runConfig = {}) {
    const sourceTools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
    if (!sourceTools.length) return agentContext;
    const toolPolicy = runConfig?.toolPolicy || {};
    const mode = (toolPolicy?.mode ?? "").trim().toLowerCase();
    const customTools = this._normalizeToolItems(toolPolicy?.customTools);
    const configuredIncludeToolNames = this._normalizeStringArray(
      toolPolicy?.includeToolNames,
    );
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

    const allowToolNames = this._normalizeStringArray(toolPolicy?.allowToolNames);
    if (allowToolNames.length) {
      const allowSet = new Set(allowToolNames);
      nextTools = nextTools.filter((toolItem) =>
        allowSet.has(String(toolItem?.name || "")),
      );
    }

    const dedupedTools = [];
    const seenNames = new Set();
    for (const toolItem of nextTools) {
      const toolName = (toolItem?.name ?? "").trim();
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

  _mergeScenarioRestrictedList({ scenarioItems = [], currentItems = [], hasWildcard = false }) {
    if (!Array.isArray(scenarioItems) || !scenarioItems.length) return [];
    if (hasWildcard) return [];
    if (!Array.isArray(currentItems) || !currentItems.length) {
      return [...scenarioItems];
    }
    const currentSet = new Set(currentItems);
    return scenarioItems.filter((name) => currentSet.has(name));
  }

  _resolveScenarioRunConfig(runConfig = {}, userConfig = {}) {
    const normalizedRunConfig = isPlainObject(runConfig) ? runConfig : {};
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      isPlainObject(userConfig) ? userConfig : {},
    );
    const scenarioConfig = isPlainObject(effectiveConfig?.scenarios)
      ? effectiveConfig.scenarios
      : {};
    const hasScenarioField = Object.prototype.hasOwnProperty.call(
      normalizedRunConfig,
      "scenario",
    );
    const resolvedScenarioKey = String(
      hasScenarioField
        ? normalizedRunConfig?.scenario || ""
        : scenarioConfig?.default || "",
    ).trim();
    if (!resolvedScenarioKey) return normalizedRunConfig;
    const scenarioDefinitions = isPlainObject(scenarioConfig?.definitions)
      ? scenarioConfig.definitions
      : {};
    const scenarioDefinition = isPlainObject(
      scenarioDefinitions?.[resolvedScenarioKey],
    )
      ? scenarioDefinitions[resolvedScenarioKey]
      : null;
    if (!scenarioDefinition) {
      return {
        ...normalizedRunConfig,
        scenario: resolvedScenarioKey,
      };
    }
    const normalizeStringArray = this._normalizeStringArray;
    const scenarioToolNamesRaw = normalizeStringArray(scenarioDefinition?.tools);
    const scenarioServiceItems = normalizeStringArray(scenarioDefinition?.services);
    const scenarioMcpServerItems = normalizeStringArray(
      scenarioDefinition?.mcpServers ?? scenarioDefinition?.mcp_servers,
    );
    const scenarioToolNameSet = new Set(scenarioToolNamesRaw);
    if (scenarioServiceItems.length) {
      scenarioToolNameSet.add("call_service");
    }
    if (scenarioMcpServerItems.length) {
      scenarioToolNameSet.add("call_mcp_task");
    }
    const scenarioToolNames = Array.from(scenarioToolNameSet);
    const scenarioContextKeys = normalizeStringArray(scenarioDefinition?.context);
    const hasAllTools = scenarioToolNames.includes("*");
    const hasAllContext = scenarioContextKeys.includes("*");
    const scenarioName = (scenarioDefinition?.name ?? "").trim();
    const scenarioDescription = (scenarioDefinition?.description ?? "").trim();
    const scenarioModelName = (scenarioDefinition?.model ?? "").trim();
    const resolvedRunConfig = {
      ...normalizedRunConfig,
      scenario: resolvedScenarioKey,
      scenarioProfile: {
        key: resolvedScenarioKey,
        name: scenarioName,
        description: scenarioDescription,
        model: scenarioModelName,
        tools: scenarioToolNames,
        context: scenarioContextKeys,
        services: scenarioServiceItems,
        mcpServers: scenarioMcpServerItems,
      },
    };
    const requestedRuntimeModel = String(
      normalizedRunConfig?.runtimeModel || "",
    ).trim();
    if (!requestedRuntimeModel && scenarioModelName) {
      resolvedRunConfig.runtimeModel = scenarioModelName;
    }
    if (scenarioToolNames.length && !hasAllTools) {
      const currentToolPolicy = isPlainObject(normalizedRunConfig?.toolPolicy)
        ? normalizedRunConfig.toolPolicy
        : {};
      const currentAllowToolNames = normalizeStringArray(
        currentToolPolicy?.allowToolNames,
      );
      const mergedAllowToolNames = this._mergeScenarioRestrictedList({
        scenarioItems: scenarioToolNames,
        currentItems: currentAllowToolNames,
      });
      resolvedRunConfig.toolPolicy = {
        ...currentToolPolicy,
        allowToolNames: mergedAllowToolNames,
        forceIncludeUserInteraction: false,
      };
    }
    if (scenarioContextKeys.length) {
      const currentContextPolicy = isPlainObject(normalizedRunConfig?.contextPolicy)
        ? normalizedRunConfig.contextPolicy
        : {};
      const currentContextKeys = normalizeStringArray(
        currentContextPolicy?.includeContextKeys,
      );
      const mergedContextKeys = this._mergeScenarioRestrictedList({
        scenarioItems: scenarioContextKeys,
        currentItems: currentContextKeys,
        hasWildcard: hasAllContext,
      });
      resolvedRunConfig.contextPolicy = {
        ...currentContextPolicy,
        includeContextKeys: mergedContextKeys,
      };
    }
    return resolvedRunConfig;
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
    summarized = false,
    toolName = "",
    rawModelContent = null,
    modelAdditionalKwargs = null,
    modelResponseMetadata = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    parentSessionId = "",
    eventListener,
  }) {
    const fullTurnPayload = {
      role,
      content,
      type: type || "",
      taskId: taskId ?? "",
      taskStatus: taskStatus ?? "",
      dialogProcessId: dialogProcessId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      tool_calls: Array.isArray(tool_calls) ? tool_calls : [],
      tool_call_id: tool_call_id || "",
      attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      summarized: summarized === true,
      toolName: String(toolName || "").trim(),
      rawModelContent:
        typeof rawModelContent === "string" || Array.isArray(rawModelContent)
          ? rawModelContent
          : null,
      modelAdditionalKwargs:
        modelAdditionalKwargs &&
        typeof modelAdditionalKwargs === "object" &&
        !Array.isArray(modelAdditionalKwargs)
          ? modelAdditionalKwargs
          : null,
      modelResponseMetadata:
        modelResponseMetadata &&
        typeof modelResponseMetadata === "object" &&
        !Array.isArray(modelResponseMetadata)
          ? modelResponseMetadata
          : null,
    };
    try {
      if (typeof this.session?.appendExecutionLog === "function") {
        await this.session.appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId: String(dialogProcessId || "").trim(),
          event: "session_turn_full",
          category: "system",
          type: "session_turn_full",
          data: fullTurnPayload,
        });
      }
    } catch {
      // ignore execution-log failures to avoid blocking the main turn flow
    }
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
      summarized,
      toolName,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
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
        modelAlias: (messageItem.modelAlias ?? "").trim(),
        modelName: (messageItem.modelName ?? "").trim(),
        summarized: messageItem.summarized === true,
        toolName: (messageItem.toolName ?? "").trim(),
        rawModelContent:
          typeof messageItem.rawModelContent === "string" ||
          Array.isArray(messageItem.rawModelContent)
            ? messageItem.rawModelContent
            : null,
        modelAdditionalKwargs:
          messageItem.modelAdditionalKwargs &&
          typeof messageItem.modelAdditionalKwargs === "object" &&
          !Array.isArray(messageItem.modelAdditionalKwargs)
            ? messageItem.modelAdditionalKwargs
            : null,
        modelResponseMetadata:
          messageItem.modelResponseMetadata &&
          typeof messageItem.modelResponseMetadata === "object" &&
          !Array.isArray(messageItem.modelResponseMetadata)
            ? messageItem.modelResponseMetadata
            : null,
        eventListener,
      });
    }
  }

  async persistStoppedAssistantMessage({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    partialAssistant = {},
  } = {}) {
    const content = (partialAssistant?.content ?? "").trim();
    const dialogProcessId = (partialAssistant?.dialogProcessId ?? "").trim();
    if (!userId || !sessionId || !content || !dialogProcessId) return false;
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    const messages = Array.isArray(sessionBundle?.session?.messages)
      ? sessionBundle.session.messages
      : [];
    const alreadySaved = messages.some(
      (messageItem) =>
        (messageItem?.role ?? "").trim() === "assistant" &&
        (messageItem?.dialogProcessId ?? "").trim() === dialogProcessId,
    );
    if (alreadySaved) return false;
    await this._appendSessionTurn({
      userId,
      sessionId,
      parentSessionId,
      role: "assistant",
      content,
      type: "message",
      dialogProcessId,
      parentDialogProcessId,
      modelAlias: (partialAssistant?.modelAlias ?? "").trim(),
      modelName: (partialAssistant?.modelName ?? "").trim(),
      eventListener: null,
    });
    return true;
  }

  _buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
    const runtimeRef =
      agentContext?.execution?.controllers?.runtime &&
      typeof agentContext.execution.controllers.runtime === "object"
        ? agentContext.execution.controllers.runtime
        : {};
    runtimeRef.abortSignal = abortSignal;
    return {
      ...agentContext,
      execution: {
        ...(agentContext?.execution || {}),
        controllers: {
          ...(agentContext?.execution?.controllers || {}),
          runtime: runtimeRef,
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
      currentSessionModelAlias: String(sessionBundle?.session?.modelAlias || "").trim(),
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
    const turnMessages =
      Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            this._buildDefaultAssistantTurn({
              agentResult,
              dialogProcessId,
            }),
          ];

    await this._appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: turnMessages,
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

    const memoryPostProcessAsyncEnabled =
      this._resolveMemoryPostProcessAsyncEnabled(userConfig);
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      Promise.resolve()
        .then(() =>
          this._runMemoryPostProcessFlow({
            userId,
            sessionId,
            parentSessionId,
            userConfig,
            runtimeEventListener,
            mode: "async",
          }),
        )
        .catch(() => {
          // error already handled in _runMemorySummarizeFlow or error logger
        });
    } else {
      await this._runMemoryPostProcessFlow({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
        runtimeEventListener,
        mode: "sync",
      });
    }

    const executionBundleTimeoutMs = this._resolveExecutionBundleTimeoutMs(userConfig);
    let executionLogs = [];
    try {
      const execution = await Promise.race([
        this.session.getExecutionBundle({
          userId,
          sessionId,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `execution bundle timeout after ${executionBundleTimeoutMs}ms`,
                ),
              ),
            executionBundleTimeoutMs,
          ),
        ),
      ]);
      executionLogs = (execution?.logs || []).slice(executionStartIndex);
    } catch (error) {
      emitEvent(runtimeEventListener, "execution_bundle_unavailable", {
        sessionId,
        timeoutMs: executionBundleTimeoutMs,
        error: error?.message || String(error),
      });
      executionLogs = [];
    }
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
          messages: turnMessages,
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
      messages: turnMessages,
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
        currentSessionModelAlias,
        executionStartIndex,
        runtimeEventListener,
      } = await this._initializeRunSessionRuntime({
        userId,
        sessionId,
        parentSessionId,
        caller,
        eventListener,
      });
      const resolvedRunConfig = this._resolveScenarioRunConfig(
        runConfig,
        userConfig,
      );
      if (
        !String(resolvedRunConfig?.runtimeModel || "").trim() &&
        String(currentSessionModelAlias || "").trim()
      ) {
        resolvedRunConfig.runtimeModel = String(currentSessionModelAlias || "").trim();
      }

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

      const runtimeAgentContext = this._buildRunTurnAgentContext(
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

  async runSessionAsUser({
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
