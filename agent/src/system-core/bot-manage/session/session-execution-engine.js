/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { runAgentTurn } from "../../agent/index.js";
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
import { AgentContextFactory } from "../execution/agent-context-factory.js";
import { CALLER_ROLE } from "../config/constants.js";
import { ERROR_CODE } from "../../error/constants.js";
import { createHookManager } from "../../hook/index.js";
import { registerNoobotPlugin as registerHarnessPlugin } from "../../../../../plugin/noobot-plugin-harness/src/index.js";

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
    this.runner = new SessionExecutionRunner({
      agentRunner: this.agentRunner,
      errorLogger: this.errorLogger,
      normalizeRunMessage: (message) => this._normalizeRunMessage(message),
      validateRunInput: (payload = {}) => this._validateRunInput(payload),
      ensureParentAsyncResultContainer: (payload = {}) =>
        this._ensureParentAsyncResultContainer(payload),
      initializeRunSessionRuntime: (payload = {}) =>
        this._initializeRunSessionRuntime(payload),
      resolveScenarioRunConfig: (runConfig = {}, userConfig = {}) =>
        this._resolveScenarioRunConfig(runConfig, userConfig),
      buildAgentContext: (payload = {}) => this._buildAgentContext(payload),
      appendSessionTurn: (payload = {}) => this._appendSessionTurn(payload),
      buildRunTurnAgentContext: (agentContext = {}, abortSignal = null) =>
        this._buildRunTurnAgentContext(agentContext, abortSignal),
      finalizeRunSession: (payload = {}) => this._finalizeRunSession(payload),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
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
    return this.agentContextFactory.buildAgentContextFromBuilder({
      mode,
      userId,
      sessionId,
      caller,
      parentSessionId,
      eventListener,
      dialogProcessId,
      runConfig,
      contextBuilder,
    });
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

  _buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
    return this.agentContextFactory.buildRunTurnAgentContext(
      agentContext,
      abortSignal,
    );
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
    return items.reduce((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      return { ...acc, ...item };
    }, {});
  }

  _resolveHarnessPluginOptions({ userId = "", runConfig = {} } = {}) {
    const globalHarness =
      this.globalConfig?.plugins?.harness && typeof this.globalConfig.plugins.harness === "object"
        ? this.globalConfig.plugins.harness
        : {};
    const runHarness =
      runConfig?.plugins?.harness && typeof runConfig.plugins.harness === "object"
        ? runConfig.plugins.harness
        : {};
    const legacyRunHarness =
      runConfig?.harness && typeof runConfig.harness === "object" ? runConfig.harness : {};
    const options = this._mergeHarnessPluginOptions(
      globalHarness,
      legacyRunHarness,
      runHarness,
    );
    const explicitlyEnabled =
      options.enabled === true || runConfig?.enableHarness === true || runConfig?.harness === true;
    if (!explicitlyEnabled) return { enabled: false };
    const basePath =
      typeof options.basePath === "string" && options.basePath.trim()
        ? options.basePath.trim()
        : this.workspaceService && userId
          ? this.workspaceService.getWorkspacePath(userId)
          : "";
    return { ...options, enabled: true, basePath };
  }

  _prepareHarnessRunConfig({ userId = "", runConfig = {} } = {}) {
    const harnessOptions = this._resolveHarnessPluginOptions({ userId, runConfig });
    if (!harnessOptions.enabled) return runConfig;
    const hookManager =
      runConfig?.hookManager && typeof runConfig.hookManager === "object"
        ? runConfig.hookManager
        : runConfig?.hooks && typeof runConfig.hooks === "object" && typeof runConfig.hooks.on === "function"
          ? runConfig.hooks
          : createHookManager();
    if (!hookManager.__noobotHarnessPluginRegistered) {
      registerHarnessPlugin({ hookManager }, harnessOptions);
      Object.defineProperty(hookManager, "__noobotHarnessPluginRegistered", {
        value: true,
        enumerable: false,
        configurable: true,
      });
    }
    return {
      ...runConfig,
      hookManager,
      plugins: {
        ...(runConfig?.plugins || {}),
        harness: harnessOptions,
      },
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
    const preparedRunConfig = this._prepareHarnessRunConfig({ userId, runConfig });
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
      runConfig: preparedRunConfig,
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
