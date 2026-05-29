/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  runAgentTurn,
  AgentContextFactory,
  AgentRuntimeFacade,
} from "../../agent/index.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { SessionExecutionInitializer } from "../execution/initializer.js";
import { SessionExecutionFinalizer } from "../execution/finalizer.js";
import { SessionTurnPersister } from "../execution/turn-persister.js";
import { SessionExecutionRunner } from "../execution/runner.js";
import { BotManageValidator } from "../config/validator.js";
import { ParentAsyncTaskManager } from "../execution/parent-async-task-manager.js";
import { RunConfigResolver } from "../config/run-config-resolver.js";
import { MemoryPostProcessService } from "../execution/memory-postprocess.js";
import { CALLER_ROLE } from "../config/constants.js";
import { ERROR_CODE } from "../../error/constants.js";
import { createAgentHookManager } from "../../hook/index.js";
import { createBotHookManager } from "../hook/index.js";
import { mergeConfig } from "../../config/index.js";
import { registerNoobotPlugin as registerHarnessPlugin } from "../../../../../plugin/noobot-plugin-harness/src/index.js";
import { createAgentCapabilityModelInvoker } from "../../agent/core/capability-mini-runner/index.js";
import {
  resolveModelContextMessages,
} from "../../session/utils/context-window-normalizer.js";
import {
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "../../context/session/summarized-message-policy.js";
import { resolveMessageRole } from "../../context/session/message-context-policy.js";
import { extractMessageTextContent } from "../../context/session/message-content-utils.js";
import { resolveDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";

function normalizeMessageForHarness(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (!role) return null;
  const content = extractMessageTextContent(
    messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "",
  );
  const normalized = {
    role,
    content,
    summarized:
      messageItem?.summarized === true || messageItem?.lc_kwargs?.summarized === true,
  };
  const toolCalls = Array.isArray(messageItem?.tool_calls)
    ? messageItem.tool_calls
    : Array.isArray(messageItem?.lc_kwargs?.tool_calls)
      ? messageItem.lc_kwargs.tool_calls
      : Array.isArray(messageItem?.additional_kwargs?.tool_calls)
        ? messageItem.additional_kwargs.tool_calls
        : [];
  if (toolCalls.length) normalized.tool_calls = toolCalls;
  const toolCallId = String(
    messageItem?.tool_call_id || messageItem?.lc_kwargs?.tool_call_id || "",
  ).trim();
  if (toolCallId) normalized.tool_call_id = toolCallId;
  if (messageItem?.injectedMessage === true || messageItem?.lc_kwargs?.injectedMessage === true) {
    normalized.injectedMessage = true;
  }
  const injectedBy = String(
    messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "",
  ).trim();
  if (injectedBy) normalized.injectedBy = injectedBy;
  if (
    messageItem?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.frontendUserMessage === true ||
    messageItem?.additional_kwargs?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  ) {
    normalized.frontendUserMessage = true;
  }
  return normalized;
}

function resolveCurrentTurnUserMessage(ctx = {}) {
  const directCandidates = [
    ctx?.userMessage,
    ctx?.message,
    ctx?.latestUserMessage,
    ctx?.latestUserGoal,
    ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.currentTurnUserMessage,
  ];
  for (const candidate of directCandidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return "";
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
    this.validator = new BotManageValidator();
    this.parentAsyncTaskManager = new ParentAsyncTaskManager({
      now: () => this._now(),
    });
    this.runConfigResolver = new RunConfigResolver({
      globalConfig: this.globalConfig,
    });
    this.memoryPostProcessService = new MemoryPostProcessService({
      globalConfig: this.globalConfig,
      memory: this.memory,
      errorLogger: this.errorLogger,
    });
    this.agentContextFactory = new AgentContextFactory({
      globalConfig: this.globalConfig,
      session: this.session,
      memory: this.memory,
      attach: this.attach,
      skill: this.skill,
      botManager: this.botManager,
      applyRunConfigToolPolicy: (agentContext = {}, runConfig = {}) =>
        this._applyRunConfigToolPolicy(agentContext, runConfig),
    });
    this.agentRuntimeFacade = new AgentRuntimeFacade({
      contextFactory: this.agentContextFactory,
      turnRunner: this.agentRunner,
    });
    this.turnPersister = new SessionTurnPersister({
      session: this.session,
    });
    this.initializer = new SessionExecutionInitializer({
      session: this.session,
      configService: this.configService,
      workspaceService: this.workspaceService,
    });
    this.finalizer = new SessionExecutionFinalizer({
      session: this.session,
      turnPersister: this.turnPersister,
      resolveMemoryPostProcessAsyncEnabled: (userConfig = {}) =>
        this._resolveMemoryPostProcessAsyncEnabled(userConfig),
      runMemoryPostProcessFlow: (payload = {}) =>
        this._runMemoryPostProcessFlow(payload),
      resolveExecutionBundleTimeoutMs: (userConfig = {}) =>
        this._resolveExecutionBundleTimeoutMs(userConfig),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
      now: () => this._now(),
    });
    // SessionExecutionRunner dependency wiring (grouped by concern)
    const runnerValidationDeps = {
      normalizeRunMessage: (message) => this._normalizeRunMessage(message),
      validateRunInput: (payload = {}) => this._validateRunInput(payload),
    };
    const runnerRuntimeDeps = {
      ensureParentAsyncResultContainer: (payload = {}) =>
        this._ensureParentAsyncResultContainer(payload),
      initializeRunSessionRuntime: (payload = {}) =>
        this._initializeRunSessionRuntime(payload),
      resolveScenarioRunConfig: (runConfig = {}, userConfig = {}) =>
        this._resolveScenarioRunConfig(runConfig, userConfig),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
      prepareAgentTurnExecution: (payload = {}) =>
        this._prepareAgentTurnExecution(payload),
    };
    const runnerPersistenceDeps = {
      appendSessionTurn: (payload = {}) => this._appendSessionTurn(payload),
      finalizeRunSession: (payload = {}) => this._finalizeRunSession(payload),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
    };
    this.runner = new SessionExecutionRunner({
      agentRunner: (payload = {}) => this.agentRuntimeFacade.runTurn(payload),
      errorLogger: this.errorLogger,
      ...runnerValidationDeps,
      ...runnerRuntimeDeps,
      ...runnerPersistenceDeps,
      now: () => this._now(),
    });
  }

  _now() {
    return new Date().toISOString();
  }

  _normalizeRunMessage(message = "") {
    return this.validator.normalizeRunMessage(message);
  }

  _validateRunInput({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
  }) {
    this.validator.validateRunInput({
      userId,
      sessionId,
      caller,
      parentSessionId,
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
    return this.parentAsyncTaskManager.upsertParentAsyncTask({
      parentAsyncResultContainer,
      sessionId,
      parentSessionId,
      task,
      sharedTaskSpec,
      patch,
    });
  }

  _ensureParentAsyncResultContainer({
    parentAsyncResultContainer = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
  }) {
    return this.parentAsyncTaskManager.ensureParentAsyncResultContainer({
      parentAsyncResultContainer,
      caller,
      parentSessionId,
      parentDialogProcessId,
    });
  }



  _normalizeStringArray(input = []) {
    return this.runConfigResolver.normalizeStringArray(input);
  }

  _normalizeToolItems(input = []) {
    return this.runConfigResolver.normalizeToolItems(input);
  }

  _buildDefaultAssistantTurn({ agentResult = {}, dialogProcessId = "" }) {
    return this.turnPersister.buildDefaultAssistantTurn({
      agentResult,
      dialogProcessId,
    });
  }

  _resolveMemorySummaryTimeoutMs(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemorySummaryTimeoutMs(userConfig);
  }

  _resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemorySummaryAsyncEnabled(userConfig);
  }

  _resolveMemoryPostProcessAsyncEnabled(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemoryPostProcessAsyncEnabled(userConfig);
  }

  _resolveExecutionBundleTimeoutMs(userConfig = {}) {
    return this.memoryPostProcessService.resolveExecutionBundleTimeoutMs(userConfig);
  }

  async _runMemorySummarizeFlow({
    userId,
    sessionId,
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    return this.memoryPostProcessService.runMemorySummarizeFlow({
      userId,
      sessionId,
      userConfig,
      runtimeEventListener,
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
    return this.memoryPostProcessService.runMemoryPostProcessFlow({
      userId,
      sessionId,
      parentSessionId,
      userConfig,
      runtimeEventListener,
      mode,
    });
  }

  _applyRunConfigToolPolicy(agentContext = {}, runConfig = {}) {
    return this.runConfigResolver.applyRunConfigToolPolicy(agentContext, runConfig);
  }

  _mergeScenarioRestrictedList({ scenarioItems = [], currentItems = [], hasWildcard = false }) {
    return this.runConfigResolver.mergeScenarioRestrictedList({
      scenarioItems,
      currentItems,
      hasWildcard,
    });
  }

  _resolveScenarioRunConfig(runConfig = {}, userConfig = {}) {
    return this.runConfigResolver.resolveScenarioRunConfig(runConfig, userConfig);
  }

  _prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const preparedHarnessConfig = this._prepareHarnessRunConfig({
      userId,
      runConfig,
      userConfig,
    });
    return this._prepareBotHookRunConfig({ runConfig: preparedHarnessConfig });
  }

  _buildContextBuilder({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId,
    userConfig,
    attachmentMetas,
    eventListener,
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    return this.agentContextFactory.buildContextBuilder({
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
  }

  async _prepareAgentTurnExecution({
    buildContextPayload = {},
    abortSignal = null,
  } = {}) {
    const payload =
      buildContextPayload && typeof buildContextPayload === "object"
        ? buildContextPayload
        : {};
    const contextBuilder =
      payload?.contextBuilder && typeof payload.contextBuilder === "object"
        ? payload.contextBuilder
        : this._buildContextBuilder(payload);
    const prepared = await this.agentRuntimeFacade.prepareTurnExecution({
      buildContextPayload: {
        ...payload,
        contextBuilder,
      },
      abortSignal,
    });
    const preparedRuntime = getRuntimeFromAgentContext(prepared?.agentContext || {});
    const runtimeAttachmentMetas = Array.isArray(preparedRuntime?.attachmentMetas)
      ? preparedRuntime.attachmentMetas
      : [];
    return {
      ...(prepared && typeof prepared === "object" ? prepared : {}),
      userMessageAttachmentMetas: mapAttachmentRecordsToMetas(runtimeAttachmentMetas, {
        fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
        userId: String(payload?.userId || "").trim(),
      }),
    };
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
    await this.turnPersister.appendSessionTurn({
      userId,
      sessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
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
      dialogProcessId,
      parentDialogProcessId,
      parentSessionId,
      eventListener,
    });
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
    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages,
      dialogProcessId,
      parentDialogProcessId,
      eventListener,
    });
  }

  async persistStoppedAssistantMessage({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    partialAssistant = {},
  } = {}) {
    return this.turnPersister.persistStoppedAssistantMessage({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      partialAssistant,
    });
  }

  async _initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId = "",
    caller = CALLER_ROLE.USER,
    eventListener = null,
  }) {
    return this.initializer.initializeRunSessionRuntime({
      userId,
      sessionId,
      parentSessionId,
      caller,
      eventListener,
    });
  }

  async _finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = CALLER_ROLE.USER,
    dialogProcessId = "",
    agentResult = {},
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
  }) {
    return this.finalizer.finalizeRunSession({
      userId,
      sessionId,
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
  }


  _mergeHarnessPluginOptions(...items) {
    const deepMergeKeys = new Set([
      "stepModels",
      "capabilityModelByPurpose",
      "capabilityToolAllowlistByPurpose",
      "acceptance",
      "review",
    ]);
    return items.reduce((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const next = { ...acc };
      for (const [key, value] of Object.entries(item)) {
        if (
          deepMergeKeys.has(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          next[key] = {
            ...(next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
              ? next[key]
              : {}),
            ...value,
          };
          continue;
        }
        next[key] = value;
      }
      return next;
    }, {});
  }

  _createHarnessResolveModelMessages({ harnessOptions = {} } = {}) {
    const recentLimit = Number(
      harnessOptions?.contextWindowRecentMessageLimit || 20,
    );
    return ({ messages = [], ctx = {} } = {}) => {
      const explicitMessages = Array.isArray(messages) ? messages : [];
      const source = explicitMessages.length
        ? explicitMessages
        : Array.isArray(ctx?.messages)
          ? ctx.messages
          : [];
      const currentDialogProcessId = resolveDialogProcessId({
        ctx,
        messages: source,
      });
      return resolveModelContextMessages({
        sourceMessages: source,
        currentDialogProcessId,
        mode: "agent",
        useRecentWindow: true,
        recentLimit,
        normalizeMessage: (item) => normalizeMessageForHarness(item),
      });
    };
  }

  _createHarnessResolveMessageBlock({ harnessOptions = {} } = {}) {
    const historyRecentLimit = Number(
      harnessOptions?.contextWindowRecentMessageLimit || 20,
    );
    const incrementalRecentLimit = Number(
      harnessOptions?.incrementalRecentMessageLimit || historyRecentLimit || 20,
    );
    return ({ scope = "history", messages = [], ctx = {} } = {}) => {
      const source = Array.isArray(messages) ? messages : [];
      const currentDialogProcessId = resolveDialogProcessId({
        ctx,
        messages: source,
      });
      const normalizedScope = String(scope || "history").trim().toLowerCase();
      if (normalizedScope === "system") {
        return resolveModelContextMessages({
          sourceMessages: source,
          currentDialogProcessId,
          mode: "agent",
          useRecentWindow: false,
        });
      }
      if (normalizedScope === "incremental") {
        return resolveModelContextMessages({
          sourceMessages: source,
          currentDialogProcessId,
          mode: "agent",
          useRecentWindow: true,
          recentLimit: incrementalRecentLimit,
        });
      }
      if (normalizedScope === "conversation" || normalizedScope === "non_system") {
        return resolveModelContextMessages({
          sourceMessages: source,
          currentDialogProcessId,
          mode: "agent",
          useRecentWindow: true,
          recentLimit: historyRecentLimit,
        });
      }
      return resolveModelContextMessages({
        sourceMessages: source,
        currentDialogProcessId,
        mode: "agent",
        useRecentWindow: true,
        recentLimit: historyRecentLimit,
      });
    };
  }

  _createHarnessMarkMessagesSummarized() {
    const shouldMark = (messageItem = {}, taskSummaryToolName = "task_summary") =>
      shouldMarkCurrentTurnSummarizedMessage(messageItem, { taskSummaryToolName }) ||
      shouldMarkCurrentTurnSummarizedModelMessage(messageItem, { taskSummaryToolName });
    const isSummarized = (messageItem = {}) =>
      messageItem?.summarized === true || messageItem?.lc_kwargs?.summarized === true;
    const markMessage = (messageItem = null) => {
      if (!messageItem || typeof messageItem !== "object") return false;
      if (isSummarized(messageItem)) return false;
      messageItem.summarized = true;
      if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
        messageItem.lc_kwargs.summarized = true;
      }
      return true;
    };
    return async ({ messages = [], ctx = {}, taskSummaryToolName = "task_summary" } = {}) => {
      const source = Array.isArray(messages) ? messages : [];
      const normalizedTaskSummaryToolName =
        String(taskSummaryToolName || "").trim() || "task_summary";
      let changedCount = 0;
      for (const messageItem of source) {
        if (!shouldMark(messageItem, normalizedTaskSummaryToolName)) continue;
        if (markMessage(messageItem)) changedCount += 1;
      }
      const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
      const currentTurnMessages = runtime?.currentTurnMessages;
      if (currentTurnMessages && typeof currentTurnMessages.updateWhere === "function") {
        changedCount += currentTurnMessages.updateWhere(
          { summarized: true },
          (messageItem) =>
            !isSummarized(messageItem) &&
            shouldMark(messageItem, normalizedTaskSummaryToolName),
        );
      }
      const sessionIds = getSessionIdsFromAgentContext(ctx?.agentContext || {}, runtime);
      const userId = String(ctx?.userId || sessionIds.userId || "").trim();
      const sessionId = String(ctx?.sessionId || sessionIds.sessionId || "").trim();
      if (userId && sessionId && this.session?.markSessionMessagesSummarized) {
        try {
          changedCount += await this.session.markSessionMessagesSummarized({
            userId,
            sessionId,
            parentSessionId: String(
              ctx?.parentSessionId || sessionIds.parentSessionId || "",
            ).trim(),
            shouldMark: (messageItem) => shouldMark(messageItem, normalizedTaskSummaryToolName),
          });
        } catch {
          // In-memory marking above is enough for the active turn; persistence
          // failures should not break the model loop.
        }
      }
      return changedCount;
    };
  }

  _resolveHarnessPluginOptions({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveHarness =
      effectiveConfig?.plugins?.harness && typeof effectiveConfig.plugins.harness === "object"
        ? effectiveConfig.plugins.harness
        : {};
    if (effectiveHarness?.enabled === false) return { enabled: false, mode: "off" };
    const runHarness =
      runConfig?.plugins?.harness && typeof runConfig.plugins.harness === "object"
        ? runConfig.plugins.harness
        : {};
    if (runHarness?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const harnessSelected = selectedPlugins.includes("harness");
    const options = this._mergeHarnessPluginOptions(
      effectiveHarness,
      runHarness,
    );
    const normalizedMode = String(harnessSelected ? "on" : options?.mode ?? "off")
      .trim()
      .toLowerCase();
    const resolvedMode = normalizedMode === "on" ? "on" : "off";
    if (resolvedMode !== "on") return { enabled: false, mode: "off" };
    const basePath =
      typeof options.basePath === "string" && options.basePath.trim()
        ? options.basePath.trim()
        : this.workspaceService && userId
          ? this.workspaceService.getWorkspacePath(userId)
          : "";
    const next = { ...options, enabled: true, mode: "on", basePath };
    next.incrementalRecentMessageLimit =
      Number.isFinite(Number(next?.incrementalRecentMessageLimit)) &&
      Number(next.incrementalRecentMessageLimit) > 0
        ? Math.floor(Number(next.incrementalRecentMessageLimit))
        : Number.isFinite(Number(next?.contextWindowRecentMessageLimit)) &&
            Number(next.contextWindowRecentMessageLimit) > 0
          ? Math.floor(Number(next.contextWindowRecentMessageLimit))
          : 20;
    next.resolveModelMessages = this._createHarnessResolveModelMessages({
      harnessOptions: next,
    });
    next.resolveMessageBlock = this._createHarnessResolveMessageBlock({
      harnessOptions: next,
    });
    next.markMessagesSummarized = this._createHarnessMarkMessagesSummarized();
    next.miniRunnerMaxTurns =
      Number.isFinite(Number(next?.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
        ? Math.min(Number(next.miniRunnerMaxTurns), 5)
        : 5;
    if (!String(next?.planningGuidanceMode || "").trim()) {
      next.planningGuidanceMode = "separate_model";
    }
    if (String(next?.planningGuidanceMode || "").trim().toLowerCase() === "separate_model") {
      const timeoutMs = Number(next?.timeoutMs);
      // Separate-model planning performs external model calls; 1s timeout is too
      // aggressive and causes repeated scheduling across turns.
      if (!Number.isFinite(timeoutMs) || timeoutMs < 180_000) {
        next.timeoutMs = 180_000;
      }
    }
    if (
      String(next?.planningGuidanceMode || "").trim().toLowerCase() === "separate_model" &&
      typeof next?.capabilityModelInvoker !== "function"
    ) {
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next?.miniRunnerMaxTurns,
        enableToolBinding: false,
      });
    }
    return next;
  }

  _prepareHarnessRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const harnessOptions = this._resolveHarnessPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!harnessOptions.enabled) return runConfig;
    const hookManager =
      runConfig?.hookManager && typeof runConfig.hookManager === "object"
        ? runConfig.hookManager
        : runConfig?.hooks && typeof runConfig.hooks === "object" && typeof runConfig.hooks.on === "function"
          ? runConfig.hooks
          : createAgentHookManager();
    if (!hookManager.__noobotHarnessPluginRegistered) {
      registerHarnessPlugin({ hookManager }, harnessOptions);
      Object.defineProperty(hookManager, "__noobotHarnessPluginRegistered", {
        value: true,
        enumerable: false,
        configurable: true,
      });
    }
    const existingRuntimeMeta =
      hookManager.runtime && typeof hookManager.runtime === "object" ? hookManager.runtime : {};
    hookManager.runtime = {
      ...existingRuntimeMeta,
      harness:
        harnessOptions && typeof harnessOptions === "object"
          ? harnessOptions
          : existingRuntimeMeta.harness,
    };
    return {
      ...runConfig,
      hookManager,
      plugins: {
        ...(runConfig?.plugins || {}),
        harness: harnessOptions,
      },
    };
  }

  _prepareBotHookRunConfig({ runConfig = {} } = {}) {
    const botHookManager =
      runConfig?.botHookManager && typeof runConfig.botHookManager === "object"
        ? runConfig.botHookManager
        : runConfig?.botHooks &&
            typeof runConfig.botHooks === "object" &&
            typeof runConfig.botHooks.on === "function"
          ? runConfig.botHooks
          : createBotHookManager();
    return {
      ...runConfig,
      botHookManager,
    };
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
    return this.runner.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller,
      parentSessionId,
      parentDialogProcessId,
      abortSignal,
      userInteractionBridge,
      runConfig,
      parentAsyncResultContainer,
    });
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
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: CALLER_ROLE.USER,
      parentSessionId: "",
    });
  }
}
