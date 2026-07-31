/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  runAgentTurn,
  AgentContextFactory,
  AgentRuntimeFacade,
} from "../../runtime/index.js";
import { recoverableToolError } from "../../shared/errors/index.js";
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
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { createDetachedSubSessionRunner } from "./detached-subsession-runner.js";
import { ModelMessageRuntimeHelpers } from "./model-message-runtime-helpers.js";
import { ScopedArtifactPersistenceHelpers } from "./scoped-artifact-persistence-helpers.js";
import {
  createDefaultRunConfigPluginPreparer,
  createRunConfigPluginPreparerFromRuntimeBundle,
  getDefaultSessionPluginRuntime,
} from "../../extensions/plugins/session-plugin-runtime-provider.js";
import {
  resolveExistingUserMessageAttachments,
  enrichUserInputAttachmentsFromIndex,
  resolveAttachmentIndexBasePath,
} from "./turn-attachment-enricher.js";
import {
  prepareTurnInput,
  prepareAgentTurnExecution,
  prepareStoppedSnapshotResumeTurnExecution,
  resolveStoppedResumeAttachments,
} from "./turn-execution-preparer.js";
import { mergeRunConfigWithPluginStrategy } from "./run-config-plugin-strategy.js";
import { commitSummaryCheckpoint } from "./summary-checkpoint-committer.js";

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
    pluginRuntimeBundle = null,
  } = {}) {
    this._assignCoreDependencies({
      globalConfig,
      session,
      memory,
      attach,
      skill,
      configService,
      workspaceService,
      errorLogger,
      botManager,
      agentRunner,
      pluginRuntimeBundle,
    });
    this._initializeCoreServices();
    this._initializeRuntimeServices();
    this._initializeExecutionServices();
    this.runner = this._createRunner();
  }

  _assignCoreDependencies({
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
    pluginRuntimeBundle = null,
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
    this.pluginRuntimeBundle = pluginRuntimeBundle;
  }

  _initializeCoreServices() {
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
  }

  _initializeRuntimeServices() {
    this.agentContextFactory = this._createAgentContextFactory();
    this.agentRuntimeFacade = new AgentRuntimeFacade({
      contextFactory: this.agentContextFactory,
      turnRunner: this.agentRunner,
    });
    this.modelMessageRuntimeHelpers = new ModelMessageRuntimeHelpers({
      session: this.session,
    });
    this.scopedArtifactPersistenceHelpers = new ScopedArtifactPersistenceHelpers({
      session: this.session,
      attach: this.attach,
      workspaceService: this.workspaceService,
      now: () => this._now(),
    });
    this.runConfigPluginPreparer = this._createRunConfigPluginPreparer();
  }

  _initializeExecutionServices() {
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
  }

  _createAgentContextFactory() {
    return new AgentContextFactory({
      globalConfig: this.globalConfig,
      session: this.session,
      memory: this.memory,
      attach: this.attach,
      skill: this.skill,
      botManager: this.botManager,
      applyRunConfigToolPolicy: (agentContext = {}, runConfig = {}) =>
        this._applyRunConfigToolPolicy(agentContext, runConfig),
    });
  }

  _createRunConfigPluginPreparer() {
    const factory = this.pluginRuntimeBundle
      ? createRunConfigPluginPreparerFromRuntimeBundle
      : createDefaultRunConfigPluginPreparer;
    return factory({
      loadedPlugins: this.pluginRuntimeBundle?.loadedPlugins,
      pluginRuntime: this.pluginRuntimeBundle?.pluginRuntime,
      globalConfig: this.globalConfig,
      workspaceService: this.workspaceService,
      normalizeStringArray: (input) => this._normalizeStringArray(input),
      mergePluginOptions: (...items) => this._mergePluginOptions(...items),
      createPluginResolveModelMessages: (payload = {}) =>
        this._createPluginResolveModelMessages(payload),
      createPluginMarkMessagesSummarized: () => this._createPluginMarkMessagesSummarized(),
      createDetachedSubSessionRunner: () => this._createDetachedSubSessionRunner(),
      createGeneratedArtifactPersister: () => this._createGeneratedArtifactPersister(),
      createScopedJsonWriter: () => this._createScopedJsonWriter(),
      createScopedEventLogger: () => this._createScopedEventLogger(),
    });
  }

  _createRunner() {
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
      prepareTurnInput: (payload = {}) => this._prepareTurnInput(payload),
      prepareAgentTurnExecution: (payload = {}) =>
        this._prepareAgentTurnExecution(payload),
      commitSummaryCheckpoint: (payload = {}) => commitSummaryCheckpoint({
        session: this.session,
        turnPersister: this.turnPersister,
        ...payload,
      }),
    };
    const runnerPersistenceDeps = {
      assertPersistenceContextIdentity: typeof this.session?.assertPersistenceContextIdentity === "function"
        ? (context = null, identity = {}) => this.session.assertPersistenceContextIdentity(context, identity)
        : null,
      appendSessionTurn: (payload = {}) => this._appendSessionTurn(payload),
      appendAgentMessages: (payload = {}) => this._appendAgentMessages(payload),
      commitSessionTurn: typeof this.session?.commitTurn === "function"
        ? (payload = {}) => this.session.commitTurn(payload)
        : null,
      stampReusedUserTurnDialogProcessId: (payload = {}) =>
        this._stampReusedUserTurnDialogProcessId(payload),
      getSessionTurns: (payload = {}) => this.session?.getSessionTurns?.(payload),
      getTurnSummaryCheckpointState: (payload = {}) => this.session?.getTurnSummaryCheckpointState?.(payload),
      finalizeRunSession: (payload = {}) => this._finalizeRunSession(payload),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
    };
    return new SessionExecutionRunner({
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
    dialogProcessId = "",
  }) {
    return this.parentAsyncTaskManager.ensureParentAsyncResultContainer({
      parentAsyncResultContainer,
      caller,
      parentSessionId,
      parentDialogProcessId,
      dialogProcessId,
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
    return this.runConfigPluginPreparer.prepareRunConfig({
      userId,
      runConfig,
      userConfig,
    });
  }

  async resolveExecutionIntent({ userId = "", runConfig = {}, turnScopeId = "" } = {}) {
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);
    const userConfig = await this.configService.loadUserConfig(basePath);
    const scenarioResolvedRunConfig = this._resolveScenarioRunConfig(runConfig, userConfig);
    return this.runConfigPluginPreparer.resolveExecutionIntent({
      userId,
      runConfig: scenarioResolvedRunConfig,
      userConfig,
      turnScopeId,
    });
  }

  _mergeRunConfigWithPluginStrategy({
    baseRunConfig = {},
    runConfigPatch = {},
    disabledPlugins = [],
  } = {}) {
    return mergeRunConfigWithPluginStrategy({
      baseRunConfig,
      runConfigPatch,
      disabledPlugins,
    });
  }

  _resolveScopedOutputDir(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.resolveScopedDir(payload);
  }

  _resolveScopedFileTarget(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.resolveScopedFileTarget(payload);
  }

  async _persistSubSessionSnapshot(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.persistSubSessionSnapshot(payload);
  }


  _createScopedJsonWriter() {
    return this.scopedArtifactPersistenceHelpers.createScopedJsonWriter();
  }

  _createScopedEventLogger() {
    return this.scopedArtifactPersistenceHelpers.createScopedEventLogger();
  }

  _createGeneratedArtifactPersister() {
    return this.scopedArtifactPersistenceHelpers.createGeneratedArtifactPersister();
  }

  _createDetachedSubSessionRunner() {
    return createDetachedSubSessionRunner({
      workspaceService: this.workspaceService,
      configService: this.configService,
      sessionRunner: this.runner,
      session: this.session,
      pluginRuntime: this.pluginRuntimeBundle?.pluginRuntime || getDefaultSessionPluginRuntime(),
      mergeRunConfigWithPluginStrategy: (payload = {}) =>
        this._mergeRunConfigWithPluginStrategy(payload),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
    });
  }


  _buildContextBuilder({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId,
    userConfig,
    userMessageAttachments = [],
    attachments,
    systemMessages = [],
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
      userMessageAttachments,
      attachments,
      systemMessages,
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });
  }

  async _prepareTurnInput({ buildContextPayload = {} } = {}) {
    return prepareTurnInput(this, { buildContextPayload });
  }

  async _prepareAgentTurnExecution({
    buildContextPayload = {},
    abortSignal = null,
  } = {}) {
    return prepareAgentTurnExecution(this, { buildContextPayload, abortSignal });
  }

  async _prepareStoppedSnapshotResumeTurnExecution({
    payload = {},
    contextBuilder = null,
    abortSignal = null,
  } = {}) {
    return prepareStoppedSnapshotResumeTurnExecution(this, {
      payload,
      contextBuilder,
      abortSignal,
    });
  }

  async _resolveStoppedResumeAttachments({ contextBuilder = null, payload = {} } = {}) {
    return resolveStoppedResumeAttachments(this, { contextBuilder, payload });
  }

  async _resolveExistingUserMessageAttachments({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
  } = {}) {
    return resolveExistingUserMessageAttachments(this, {
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId,
    });
  }

  async _enrichUserInputAttachmentsFromIndex({ userId = "", sessionId = "", attachments = [], existingAttachments = [] } = {}) {
    return enrichUserInputAttachmentsFromIndex(this, {
      userId,
      sessionId,
      attachments,
      existingAttachments,
    });
  }

  async _resolveAttachmentIndexBasePath(userId = "") {
    return resolveAttachmentIndexBasePath(this, userId);
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
    attachments = [],
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
    turnScopeId = "",
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
      attachments,
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
      turnScopeId,
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
    turnScopeId = "",
    eventListener,
    persistenceContext = null,
  }) {
    return this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      eventListener,
      persistenceContext,
    });
  }

  async _stampReusedUserTurnDialogProcessId(payload = {}) {
    return this.session?.stampReusedUserTurnDialogProcessId?.(payload);
  }

  async upsertTurnStatus(payload = {}) {
    return this.session?.upsertTurnStatus?.(payload);
  }

  async applyTurnLifecycleEvent(payload = {}) {
    return this.session?.applyTurnLifecycleEvent?.(payload);
  }

  async getTurnLifecycleSnapshot(payload = {}) {
    return this.session?.getTurnLifecycleSnapshot?.(payload);
  }

  async getPendingAuthorityEvents(payload = {}) {
    return this.session?.getPendingAuthorityEvents?.(payload);
  }

  async recordAuthorityEventAttempt(payload = {}) {
    return this.session?.recordAuthorityEventAttempt?.(payload);
  }

  async acknowledgeAuthorityEvent(payload = {}) {
    return this.session?.acknowledgeAuthorityEvent?.(payload);
  }

  async getExecution(payload = {}) {
    return this.session?.getExecution?.(payload);
  }

  async getExecutionChildren(payload = {}) {
    return this.session?.getExecutionChildren?.(payload);
  }

  async getExecutionTree(payload = {}) {
    return this.session?.getExecutionTree?.(payload);
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
    turnScopeId = "",
    thinkingStartedAt = "",
    persistenceContext = null,
  }) {
    return this.initializer.initializeRunSessionRuntime({
      userId,
      sessionId,
      parentSessionId,
      caller,
      eventListener,
      turnScopeId,
      thinkingStartedAt,
      persistenceContext,
    });
  }

  async _finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = CALLER_ROLE.USER,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    agentResult = {},
    alreadyPersistedTurnMessageCount = 0,
    persistedTurnMessages = null,
    summaryCheckpointPromotionSources = [],
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
    lifecycle = null,
    persistenceContext = null,
  }) {
    return this.finalizer.finalizeRunSession({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      caller,
      dialogProcessId,
      turnScopeId,
      thinkingStartedAt,
      agentResult,
      alreadyPersistedTurnMessageCount,
      persistedTurnMessages,
      summaryCheckpointPromotionSources,
      executionStartIndex,
      runtimeEventListener,
      userConfig,
      resolvedParentAsyncResultContainer,
      lifecycle,
      persistenceContext,
    });
  }


  _mergePluginOptions(...items) {
    return this.modelMessageRuntimeHelpers.mergePluginOptions(...items);
  }

  _createPluginResolveModelMessages(payload = {}) {
    return this.modelMessageRuntimeHelpers.createResolveModelMessages(payload);
  }

  _createPluginMarkMessagesSummarized() {
    return this.modelMessageRuntimeHelpers.createMarkMessagesSummarized();
  }

  _prepareBotHookRunConfig({ runConfig = {} } = {}) {
    return this.runConfigPluginPreparer.prepareBotHookRunConfig({ runConfig });
  }

  _buildPluginRegisterApi({ manager = null, pluginName = "", options = {}, runConfig = {} } = {}) {
    return this.runConfigPluginPreparer.buildPluginRegisterApi({
      manager,
      pluginName,
      options,
      runConfig,
    });
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    systemMessages = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    dialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    turnScopeId = "",
    parentAsyncResultContainer = null,
  }) {
    return this.runner.runSession({
      userId,
      sessionId,
      message,
      attachments,
      systemMessages,
      eventListener,
      caller,
      parentSessionId,
      parentDialogProcessId,
      dialogProcessId,
      abortSignal,
      userInteractionBridge,
      runConfig,
      turnScopeId,
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
