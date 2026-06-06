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
import path from "node:path";
import { mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../event/index.js";
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
import {
  getNoobotPluginRuntime,
  resolveFirstLoadedNoobotPluginByCapability,
  resolvePluginRegisterByCapability,
} from "../../plugin/plugin-loader.js";
import { PLUGIN_CAPABILITY } from "../../plugin/capabilities.js";
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
import { normalizeSessionEntity } from "../../session/entities/session-entity.js";
import {
  createPluginPolicyApi,
  hasToolPolicyPatchContent,
  mergeToolPolicyPatch,
} from "./plugin-policy-api.js";

const loadedDynamicPlugins = await getNoobotPluginRuntime({
  requiredApiVersion: "1",
}).catch(() => ({
  pluginRootDir: "",
  requiredApiVersion: "1",
  discoveredCount: 0,
  loadedCount: 0,
  registry: new Map(),
  errors: [],
}));

function resolvePluginKeyByCapability(
  loadedPlugins = null,
  capability = "",
  fallbackKey = "",
) {
  const matched = resolveFirstLoadedNoobotPluginByCapability(loadedPlugins, capability);
  const pluginKey = String(matched?.manifest?.pluginKey || matched?.manifest?.id || "").trim();
  return pluginKey || String(fallbackKey || "").trim();
}

function normalizePluginSelectorSet(keys = []) {
  return new Set(
    (Array.isArray(keys) ? keys : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

const HARNESS_PLUGIN_KEY = resolvePluginKeyByCapability(
  loadedDynamicPlugins,
  PLUGIN_CAPABILITY.AGENT_REGISTER,
  "harness",
);
const WORKFLOW_PLUGIN_KEY = resolvePluginKeyByCapability(
  loadedDynamicPlugins,
  PLUGIN_CAPABILITY.BOT_REGISTER,
  "workflow",
);
const HARNESS_PLUGIN_SELECTORS = normalizePluginSelectorSet([HARNESS_PLUGIN_KEY, "harness"]);
const WORKFLOW_PLUGIN_SELECTORS = normalizePluginSelectorSet([WORKFLOW_PLUGIN_KEY, "workflow"]);

function resolvePluginOptionsFromConfig(sourceConfig = {}, pluginSelectors = new Set()) {
  const plugins =
    sourceConfig?.plugins && typeof sourceConfig.plugins === "object" ? sourceConfig.plugins : {};
  const merged = {};
  for (const selector of pluginSelectors) {
    const item = plugins?.[selector];
    if (!item || typeof item !== "object") continue;
    Object.assign(merged, item);
  }
  return merged;
}

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
    const preparedBotHookConfig = this._prepareBotHookRunConfig({
      runConfig: preparedHarnessConfig,
    });
    return this._prepareWorkflowRunConfig({
      userId,
      runConfig: preparedBotHookConfig,
      userConfig,
    });
  }

  _mergeRunConfigWithPluginStrategy({
    baseRunConfig = {},
    runConfigPatch = {},
    disabledPlugins = [],
  } = {}) {
    const merged = {
      ...(baseRunConfig && typeof baseRunConfig === "object" ? baseRunConfig : {}),
      ...(runConfigPatch && typeof runConfigPatch === "object" ? runConfigPatch : {}),
    };
    const disabledSet = new Set(
      (Array.isArray(disabledPlugins) ? disabledPlugins : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!disabledSet.size) return merged;
    const selectedPlugins = Array.isArray(merged?.selectedPlugins)
      ? merged.selectedPlugins
      : [];
    merged.selectedPlugins = selectedPlugins
      .map((item) => String(item || "").trim())
      .filter((item) => item && !disabledSet.has(item));
    const plugins = merged?.plugins && typeof merged.plugins === "object" ? merged.plugins : {};
    const nextPlugins = { ...plugins };
    for (const pluginName of disabledSet) {
      const current =
        nextPlugins?.[pluginName] && typeof nextPlugins[pluginName] === "object"
          ? nextPlugins[pluginName]
          : {};
      nextPlugins[pluginName] = {
        ...current,
        enabled: false,
        mode: "off",
      };
    }
    merged.plugins = nextPlugins;
    return merged;
  }

  _resolveWorkflowScopedDir({
    userId = "",
    relativeDir = "",
    absoluteDir = "",
  } = {}) {
    const workspacePath = this.workspaceService.getWorkspacePath(userId);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    if (absoluteDir && String(absoluteDir || "").trim()) {
      const resolvedAbsoluteDir = path.resolve(String(absoluteDir || "").trim());
      const relativeFromWorkspace = path.relative(
        resolvedWorkspacePath,
        resolvedAbsoluteDir,
      );
      if (
        !relativeFromWorkspace ||
        relativeFromWorkspace.startsWith("..") ||
        path.isAbsolute(relativeFromWorkspace)
      ) {
        throw new Error("workflow scoped output path must be inside workspace");
      }
      return resolvedAbsoluteDir;
    }
    const normalizedRelativeDir = String(relativeDir || "").trim().replaceAll("\\", "/");
    if (!normalizedRelativeDir) return "";
    const resolvedDir = path.resolve(resolvedWorkspacePath, normalizedRelativeDir);
    const relativeFromWorkspace = path.relative(resolvedWorkspacePath, resolvedDir);
    if (
      !relativeFromWorkspace ||
      relativeFromWorkspace.startsWith("..") ||
      path.isAbsolute(relativeFromWorkspace)
    ) {
      throw new Error("workflow scoped output path must be inside workspace");
    }
    return resolvedDir;
  }

  async _persistSubSessionSnapshot({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    outputDir = "",
    metadata = null,
  } = {}) {
    if (!userId || !sessionId || !outputDir) return null;
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    const executionBundle = await this.session.getExecutionBundle({
      userId,
      sessionId,
    });
    const session = sessionBundle?.session && typeof sessionBundle.session === "object"
      ? sessionBundle.session
      : null;
    const tasks = Array.isArray(sessionBundle?.turnTasks) ? sessionBundle.turnTasks : [];
    const execution = executionBundle && typeof executionBundle === "object"
      ? executionBundle
      : { sessionId, logs: [] };
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(outputDir, "session.json"),
        `${JSON.stringify(session || { sessionId, messages: [] }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "task.json"),
        `${JSON.stringify(
          { sessionId, currentTaskId: "", tasks, updatedAt: new Date().toISOString() },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "execution.json"),
        `${JSON.stringify(execution, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "meta.json"),
        `${JSON.stringify(
          metadata && typeof metadata === "object" ? metadata : {},
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);
    return {
      outputDir,
      files: {
        session: path.join(outputDir, "session.json"),
        task: path.join(outputDir, "task.json"),
        execution: path.join(outputDir, "execution.json"),
        meta: path.join(outputDir, "meta.json"),
      },
    };
  }

  _normalizeDetachedSubSessionMessage(message = {}, now = "") {
    const ts = String(now || this._now()).trim() || this._now();
    const normalized = {
      role: String(message?.role || "").trim() || "assistant",
      content: message?.content || "",
      type: String(message?.type || "").trim(),
      dialogProcessId: String(message?.dialogProcessId || "").trim(),
      parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
      taskId: String(message?.taskId || "").trim(),
      taskStatus: String(message?.taskStatus || "").trim(),
      modelAlias: String(message?.modelAlias || "").trim(),
      modelName: String(message?.modelName || "").trim(),
      summarized: message?.summarized === true,
      ts,
    };
    if (Array.isArray(message?.tool_calls)) normalized.tool_calls = message.tool_calls;
    if (String(message?.tool_call_id || "").trim()) {
      normalized.tool_call_id = String(message.tool_call_id || "").trim();
    }
    if (Array.isArray(message?.attachmentMetas) && message.attachmentMetas.length) {
      normalized.attachmentMetas = message.attachmentMetas;
    }
    if (message?.injectedMessage === true || message?.lc_kwargs?.injectedMessage === true) {
      normalized.injectedMessage = true;
    }
    const injectedBy = String(
      message?.injectedBy || message?.lc_kwargs?.injectedBy || "",
    ).trim();
    if (injectedBy) normalized.injectedBy = injectedBy;
    if (
      message?.frontendUserMessage === true ||
      message?.lc_kwargs?.frontendUserMessage === true ||
      message?.additional_kwargs?.frontendUserMessage === true ||
      message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
    ) {
      normalized.frontendUserMessage = true;
    }
    return normalized;
  }

  async _persistDetachedSubSessionSnapshot({
    outputDir = "",
    sessionPayload = {},
    taskPayload = {},
    executionPayload = {},
    metadata = null,
  } = {}) {
    if (!outputDir) return null;
    const normalizedSessionPayload = normalizeSessionEntity(
      sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {},
      { now: () => this._now() },
    );
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(outputDir, "session.json"),
        `${JSON.stringify(
          normalizedSessionPayload,
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "task.json"),
        `${JSON.stringify(
          taskPayload && typeof taskPayload === "object" ? taskPayload : {},
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "execution.json"),
        `${JSON.stringify(
          executionPayload && typeof executionPayload === "object" ? executionPayload : {},
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputDir, "meta.json"),
        `${JSON.stringify(
          metadata && typeof metadata === "object" ? metadata : {},
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);
    return {
      outputDir,
      files: {
        session: path.join(outputDir, "session.json"),
        task: path.join(outputDir, "task.json"),
        execution: path.join(outputDir, "execution.json"),
        meta: path.join(outputDir, "meta.json"),
      },
    };
  }

  async _assertDetachedSubSessionIsolation({
    userId = "",
    sessionId = "",
    eventListener = null,
    scope = "sub_session",
  } = {}) {
    if (!userId || !sessionId) return true;
    const workspacePath = this.workspaceService.getWorkspacePath(userId);
    const leakedMainSessionFile = path.resolve(
      workspacePath,
      "runtime/session",
      sessionId,
      "session.json",
    );
    try {
      await access(leakedMainSessionFile);
    } catch {
      return true;
    }
    const payload = {
      scope,
      userId,
      sessionId,
      leakedMainSessionFile,
      message: "detached sub session leaked into runtime/session main tree",
    };
    emitEvent(
      typeof eventListener === "function" ? eventListener : null,
      "workflow_subsession_persistence_leak",
      payload,
    );
    // Runtime assertion log for easier tracing in non-event environments.
    console.warn("[workflow-subsession-leak]", JSON.stringify(payload));
    return false;
  }

  _createWorkflowScopedJsonWriter() {
    return async ({
      userId = "",
      relativeDir = "",
      absoluteDir = "",
      fileName = "payload.json",
      payload = {},
    } = {}) => {
      const normalizedUserId = String(userId || "").trim();
      if (!normalizedUserId) throw new Error("workflow scoped writer requires userId");
      const outputDir = this._resolveWorkflowScopedDir({
        userId: normalizedUserId,
        relativeDir,
        absoluteDir,
      });
      if (!outputDir) throw new Error("workflow scoped writer requires output directory");
      const normalizedFileName = String(fileName || "payload.json").trim() || "payload.json";
      if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
        throw new Error("workflow scoped writer fileName must be plain file name");
      }
      await mkdir(outputDir, { recursive: true });
      const outputFile = path.join(outputDir, normalizedFileName);
      await writeFile(
        outputFile,
        `${JSON.stringify(
          payload && typeof payload === "object" ? payload : { value: payload },
          null,
          2,
        )}\n`,
        "utf8",
      );
      return {
        outputDir,
        outputFile,
      };
    };
  }

  _createWorkflowScopedEventLogger() {
    return async ({
      userId = "",
      relativeDir = "",
      absoluteDir = "",
      fileName = "events.jsonl",
      event = {},
    } = {}) => {
      const normalizedUserId = String(userId || "").trim();
      if (!normalizedUserId) throw new Error("workflow event logger requires userId");
      const outputDir = this._resolveWorkflowScopedDir({
        userId: normalizedUserId,
        relativeDir,
        absoluteDir,
      });
      if (!outputDir) throw new Error("workflow event logger requires output directory");
      const normalizedFileName = String(fileName || "events.jsonl").trim() || "events.jsonl";
      if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
        throw new Error("workflow event logger fileName must be plain file name");
      }
      const outputFile = path.join(outputDir, normalizedFileName);
      await mkdir(outputDir, { recursive: true });
      await appendFile(
        outputFile,
        `${JSON.stringify({
          timestamp: this._now(),
          ...(event && typeof event === "object" ? event : { value: event }),
        })}\n`,
        "utf8",
      );
      return {
        outputDir,
        outputFile,
      };
    };
  }

  _createGeneratedArtifactPersister() {
    return async ({
      userId = "",
      sessionId = "",
      attachmentSource = "model",
      generationSource = "generated_artifact",
      artifacts = [],
      fallbackMimeType = MIME_TYPE.APPLICATION_OCTET_STREAM,
    } = {}) => {
      const attachmentService = this.attach;
      if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
        return [];
      }
      const normalizedUserId = String(userId || "").trim();
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedUserId || !normalizedSessionId) return [];
      const artifactList = Array.isArray(artifacts) ? artifacts : [];
      if (!artifactList.length) return [];
      const normalizedGenerationSource = String(generationSource || "generated_artifact").trim();
      const records = await attachmentService.ingestGeneratedArtifacts({
        userId: normalizedUserId,
        sessionId: normalizedSessionId,
        attachmentSource: String(attachmentSource || "model").trim() || "model",
        generationSource: normalizedGenerationSource,
        artifacts: artifactList,
      });
      return mapAttachmentRecordsToMetas(records, {
        fallbackMimeType,
        fallbackGenerationSource: normalizedGenerationSource,
      });
    };
  }

  _createBotSubSessionRunner() {
    return async ({
      parentContext = {},
      message = "",
      attachmentMetas = [],
      runConfigPatch = {},
      systemMessages = [],
      strategy = {},
      metadata = {},
      eventListener = null,
    } = {}) => {
      const sourceContext =
        parentContext && typeof parentContext === "object" ? parentContext : {};
      const userId = String(
        strategy?.userId || sourceContext?.userId || "",
      ).trim();
      const parentSessionId = String(
        strategy?.parentSessionId || sourceContext?.sessionId || "",
      ).trim();
      const parentDialogProcessId = String(
        strategy?.parentDialogProcessId || sourceContext?.dialogProcessId || "",
      ).trim();
      if (!userId || !parentSessionId) {
        throw new Error("sub-session runner requires userId and parentSessionId");
      }
      const subSessionId = String(strategy?.sessionId || "").trim() || randomUUID();
      const subDialogProcessId = String(
        strategy?.dialogProcessId || metadata?.workflowDialogId || parentDialogProcessId || subSessionId,
      ).trim();
      const mergedRunConfig = this._mergeRunConfigWithPluginStrategy({
        baseRunConfig: sourceContext?.runConfig || {},
        runConfigPatch,
        disabledPlugins: strategy?.disabledPlugins || [],
      });
      const subSessionAttachmentMetas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
      // 子会话为 detached 执行，不能复用父会话的 hook manager（会把父插件/hook 链一并带入）。
      // 否则即便 selectedPlugins 关闭，也可能继续触发已注册的 harness/workflow hooks。
      delete mergedRunConfig.hookManager;
      delete mergedRunConfig.hooks;
      delete mergedRunConfig.botHookManager;
      delete mergedRunConfig.botHooks;
      let subSessionUserConfig = {};
      try {
        const workspacePath = this.workspaceService.getWorkspacePath(userId);
        subSessionUserConfig = await this.configService.loadUserConfig(workspacePath);
      } catch {
        subSessionUserConfig = {};
      }
      const effectiveRunConfig = this._prepareRunConfig({
        userId,
        runConfig: mergedRunConfig,
        userConfig: subSessionUserConfig,
      });
      effectiveRunConfig.systemRuntimePatch = {
        ...(effectiveRunConfig?.systemRuntimePatch &&
        typeof effectiveRunConfig.systemRuntimePatch === "object"
          ? effectiveRunConfig.systemRuntimePatch
          : {}),
        childRunParentSessionId: parentSessionId,
        durableParentSessionId: parentSessionId,
        detachedSessionScope: "workflow_node",
      };
      const selectedPlugins = Array.isArray(effectiveRunConfig?.selectedPlugins)
        ? effectiveRunConfig.selectedPlugins.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const runtimePluginState = {
        selectedPlugins,
        harness: {
          pluginKey: HARNESS_PLUGIN_KEY,
          enabled:
            resolvePluginOptionsFromConfig(
              effectiveRunConfig,
              HARNESS_PLUGIN_SELECTORS,
            )?.enabled === true,
          mode: String(
            resolvePluginOptionsFromConfig(
              effectiveRunConfig,
              HARNESS_PLUGIN_SELECTORS,
            )?.mode || "",
          )
            .trim()
            .toLowerCase(),
          hookManagerReady: Boolean(effectiveRunConfig?.hookManager),
        },
        workflow: {
          pluginKey: WORKFLOW_PLUGIN_KEY,
          enabled:
            resolvePluginOptionsFromConfig(
              effectiveRunConfig,
              WORKFLOW_PLUGIN_SELECTORS,
            )?.enabled === true,
          mode: String(
            resolvePluginOptionsFromConfig(
              effectiveRunConfig,
              WORKFLOW_PLUGIN_SELECTORS,
            )?.mode || "",
          )
            .trim()
            .toLowerCase(),
          botHookManagerReady: Boolean(effectiveRunConfig?.botHookManager),
        },
        disabledPlugins: Array.isArray(strategy?.disabledPlugins)
          ? strategy.disabledPlugins.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
        scope: "detached_sub_session",
      };
      emitEvent(eventListener, "plugin_runtime_resolved", runtimePluginState);
      const preparedAgentTurnExecution = await this._prepareAgentTurnExecution({
        buildContextPayload: {
          mode: "initial",
          userId,
          sessionId: subSessionId,
          caller: CALLER_ROLE.BOT,
          parentSessionId,
          dialogProcessId: subDialogProcessId || subSessionId,
          userConfig: subSessionUserConfig,
          attachmentMetas: subSessionAttachmentMetas,
          systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
          eventListener:
            eventListener &&
            typeof eventListener === "object" &&
            typeof eventListener.onEvent === "function"
              ? eventListener
              : null,
          runConfig: effectiveRunConfig,
          parentAsyncResultContainer: null,
        },
        abortSignal: null,
      });
      const runtimeAgentContext =
        preparedAgentTurnExecution?.runtimeAgentContext &&
        typeof preparedAgentTurnExecution.runtimeAgentContext === "object"
          ? preparedAgentTurnExecution.runtimeAgentContext
          : preparedAgentTurnExecution?.agentContext &&
              typeof preparedAgentTurnExecution.agentContext === "object"
            ? preparedAgentTurnExecution.agentContext
            : {};
      const agentResult = await this.agentRuntimeFacade.runTurn({
        errorLogger: this.errorLogger,
        agentContext: runtimeAgentContext,
        userMessage: String(message || "").trim(),
      });
      const dialogProcessId = String(
        agentResult?.dialogProcessId ||
          runtimeAgentContext?.payload?.runtime?.systemRuntime?.dialogProcessId ||
          "",
      ).trim();
      const turnMessages = Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            {
              role: "assistant",
              content: String(agentResult?.output || "").trim(),
              type: "message",
              dialogProcessId,
            },
          ];
      const resolvedOutputDir = this._resolveWorkflowScopedDir({
        userId,
        relativeDir: strategy?.relativeDir || "",
        absoluteDir: strategy?.absoluteDir || "",
      });
      let persisted = null;
      if (resolvedOutputDir) {
        const now = this._now();
        const pluginRuntimeResolvedLog = {
          dialogProcessId: subDialogProcessId || subSessionId,
          event: "plugin_runtime_resolved",
          category: "system",
          type: "system",
          data: runtimePluginState,
          ts: now,
        };
        const normalizedTurnMessages = turnMessages.map((item = {}) =>
          this._normalizeDetachedSubSessionMessage(item, now),
        );
        const userTurn = this._normalizeDetachedSubSessionMessage(
          {
            role: "user",
            content: String(message || "").trim(),
            type: "message",
            dialogProcessId,
            parentDialogProcessId,
            frontendUserMessage: false,
            attachmentMetas: subSessionAttachmentMetas,
          },
          now,
        );
        const systemTurns = (Array.isArray(systemMessages) ? systemMessages : [])
          .map((content) => String(content || "").trim())
          .filter(Boolean)
          .map((content) =>
            this._normalizeDetachedSubSessionMessage(
              {
                role: "system",
                content,
                type: "system",
                dialogProcessId,
                parentDialogProcessId,
                injectedMessage: true,
                injectedBy: "workflow",
              },
              now,
            ),
          );
        persisted = await this._persistDetachedSubSessionSnapshot({
          outputDir: resolvedOutputDir,
          sessionPayload: {
            sessionId: subSessionId,
            parentSessionId,
            caller: CALLER_ROLE.BOT,
            modelAlias: "",
            currentTaskId: "",
            shortMemoryCheckpoint: 0,
            messages: [...systemTurns, userTurn, ...normalizedTurnMessages],
          },
          taskPayload: {
            sessionId: subSessionId,
            currentTaskId: "",
            tasks: Array.isArray(agentResult?.turnTasks) ? agentResult.turnTasks : [],
            updatedAt: now,
          },
          executionPayload: {
            sessionId: subSessionId,
            logs: [pluginRuntimeResolvedLog],
          },
          metadata: {
            userId,
            sessionId: subSessionId,
            parentSessionId,
            parentDialogProcessId,
            dialogProcessId,
            ...(metadata && typeof metadata === "object" ? metadata : {}),
          },
        });
      }
      await this._assertDetachedSubSessionIsolation({
        userId,
        sessionId: subSessionId,
        eventListener,
        scope: "workflow_node_subsession",
      });
      return {
        userId,
        sessionId: subSessionId,
        parentSessionId,
        dialogProcessId,
        persisted,
        result: {
          sessionId: subSessionId,
          parentSessionId,
          parentDialogProcessId,
          caller: CALLER_ROLE.BOT,
          answer: String(agentResult?.output || "").trim(),
          traces: Array.isArray(agentResult?.traces) ? agentResult.traces : [],
          messages: turnMessages,
          turnTasks: Array.isArray(agentResult?.turnTasks) ? agentResult.turnTasks : [],
          executionLogs: [],
          dialogProcessId,
        },
      };
    };
  }

  _buildContextBuilder({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId,
    userConfig,
    attachmentMetas,
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
      attachmentMetas,
      systemMessages,
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
    return async ({
      messages = [],
      ctx = {},
      taskSummaryToolName = "task_summary",
      summaryScope = null,
    } = {}) => {
      const source = Array.isArray(messages) ? messages : [];
      const normalizedTaskSummaryToolName =
        String(taskSummaryToolName || "").trim() || "task_summary";
      const normalizedScope =
        summaryScope && typeof summaryScope === "object" ? summaryScope : {};
      const maxMessagesRaw = Number(normalizedScope?.maxMessages);
      const hasScopedSourceLimit =
        Number.isFinite(maxMessagesRaw) && maxMessagesRaw >= 0;
      const scopedSourceLimit = hasScopedSourceLimit
        ? Math.min(source.length, Math.floor(maxMessagesRaw))
        : source.length;
      const limitToProvidedMessagesOnly =
        hasScopedSourceLimit &&
        (normalizedScope?.limitToProvidedMessagesOnly === true ||
          normalizedScope?.applyToStores === false ||
          normalizedScope?.applyToSession === false);
      let changedCount = 0;
      for (let index = 0; index < scopedSourceLimit; index += 1) {
        const messageItem = source[index];
        if (!shouldMark(messageItem, normalizedTaskSummaryToolName)) continue;
        if (markMessage(messageItem)) changedCount += 1;
      }
      const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
      const currentTurnMessages = runtime?.currentTurnMessages;
      if (
        !limitToProvidedMessagesOnly &&
        currentTurnMessages &&
        typeof currentTurnMessages.updateWhere === "function"
      ) {
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
      if (
        !limitToProvidedMessagesOnly &&
        userId &&
        sessionId &&
        this.session?.markSessionMessagesSummarized
      ) {
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
    const effectiveHarness = resolvePluginOptionsFromConfig(
      effectiveConfig,
      HARNESS_PLUGIN_SELECTORS,
    );
    if (effectiveHarness?.enabled === false) return { enabled: false, mode: "off" };
    const runHarness = resolvePluginOptionsFromConfig(
      runConfig,
      HARNESS_PLUGIN_SELECTORS,
    );
    if (runHarness?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const harnessSelected = selectedPlugins.some((item) =>
      HARNESS_PLUGIN_SELECTORS.has(String(item || "").trim()),
    );
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
    const pluginApi = this._buildPluginRegisterApi({
      manager: hookManager,
      pluginName: HARNESS_PLUGIN_KEY,
      options: harnessOptions,
      runConfig,
    });
    const harnessAlreadyRegistered = hookManager.__noobotHarnessPluginRegistered === true;
    if (!harnessAlreadyRegistered) {
      const registerHarness = resolvePluginRegisterByCapability(
        loadedDynamicPlugins,
        PLUGIN_CAPABILITY.AGENT_REGISTER,
      );
      if (typeof registerHarness === "function") {
        registerHarness(
          pluginApi,
          harnessOptions,
        );
        Object.defineProperty(hookManager, "__noobotHarnessPluginRegistered", {
          value: true,
          enumerable: false,
          configurable: true,
        });
      }
    } else if (typeof pluginApi?.policy?.appendDenyToolNames === "function") {
      // Keep per-run policy patch behavior even when hook registration is reused.
      pluginApi.policy.appendDenyToolNames(harnessOptions?.denyToolNames || []);
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
    const pluginToolPolicyPatch = pluginApi?.policy?.getToolPolicyPatch?.() || {};
    const shouldAttachToolPolicy =
      (runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object") ||
      hasToolPolicyPatchContent({
        toolPolicyPatch: pluginToolPolicyPatch,
        normalizeStringArray: (input) => this._normalizeStringArray(input),
      });
    return {
      ...runConfig,
      hookManager,
      ...(shouldAttachToolPolicy
        ? {
            toolPolicy: mergeToolPolicyPatch({
              baseToolPolicy: runConfig?.toolPolicy,
              toolPolicyPatch: pluginToolPolicyPatch,
              normalizeStringArray: (input) => this._normalizeStringArray(input),
            }),
          }
        : {}),
      plugins: {
        ...(runConfig?.plugins || {}),
        [HARNESS_PLUGIN_KEY]: harnessOptions,
      },
    };
  }

  _resolveWorkflowPluginOptions({ runConfig = {}, userConfig = {} } = {}) {
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveWorkflow =
      resolvePluginOptionsFromConfig(
        effectiveConfig,
        WORKFLOW_PLUGIN_SELECTORS,
      );
    if (effectiveWorkflow?.enabled === false) return { enabled: false, mode: "off" };
    const runWorkflow =
      resolvePluginOptionsFromConfig(
        runConfig,
        WORKFLOW_PLUGIN_SELECTORS,
      );
    if (runWorkflow?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const workflowSelected = selectedPlugins.some((item) =>
      WORKFLOW_PLUGIN_SELECTORS.has(String(item || "").trim()),
    );
    const normalizedEffectiveMode = String(effectiveWorkflow?.mode ?? "off")
      .trim()
      .toLowerCase();
    const normalizedRunMode = String(runWorkflow?.mode ?? "")
      .trim()
      .toLowerCase();
    // keep user/global on as baseline; runConfig should primarily elevate workflow,
    // unless it explicitly disables plugin via enabled=false (used by node sub-session strategy)
    const resolvedMode =
      workflowSelected || normalizedRunMode === "on" || normalizedEffectiveMode === "on"
        ? "on"
        : "off";
    if (resolvedMode !== "on") return { enabled: false, mode: "off" };
    const options = {
      ...(effectiveWorkflow && typeof effectiveWorkflow === "object" ? effectiveWorkflow : {}),
      ...(runWorkflow && typeof runWorkflow === "object" ? runWorkflow : {}),
    };
    const next = { ...options, enabled: true, mode: "on" };
    next.miniRunnerMaxTurns =
      Number.isFinite(Number(next?.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
        ? Math.min(Number(next.miniRunnerMaxTurns), 5)
        : 3;
    next.maxAutoTransitions =
      Number.isFinite(Number(next?.maxAutoTransitions)) && Number(next.maxAutoTransitions) > 0
        ? Math.floor(Number(next.maxAutoTransitions))
        : 10;
    next.contextWindowRecentMessageLimit =
      Number.isFinite(Number(next?.contextWindowRecentMessageLimit)) &&
      Number(next.contextWindowRecentMessageLimit) > 0
        ? Math.floor(Number(next.contextWindowRecentMessageLimit))
        : 20;
    next.resolveModelMessages = this._createHarnessResolveModelMessages({
      harnessOptions: next,
    });
    if (!String(next?.semanticMode || "").trim()) {
      next.semanticMode = "separate_model";
    }
    if (
      String(next?.semanticMode || "").trim().toLowerCase() === "separate_model" &&
      typeof next?.capabilityModelInvoker !== "function"
    ) {
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next?.miniRunnerMaxTurns,
        enableToolBinding: false,
        headerNamespace: "workflow",
        flowPrefix: "workflow",
        includeHarnessCompatHeaders: true,
        fallbackGlobalConfig: this.globalConfig || {},
        fallbackUserConfig: userConfig && typeof userConfig === "object" ? userConfig : {},
      });
    }
    if (typeof next?.subSessionRunner !== "function") {
      next.subSessionRunner = this._createBotSubSessionRunner();
    }
    if (typeof next?.generatedArtifactPersister !== "function") {
      next.generatedArtifactPersister = this._createGeneratedArtifactPersister();
    }
    if (typeof next?.workflowDialogPersister !== "function") {
      next.workflowDialogPersister = this._createWorkflowScopedJsonWriter();
    }
    if (typeof next?.workflowEventLogger !== "function") {
      next.workflowEventLogger = this._createWorkflowScopedEventLogger();
    }
    return next;
  }

  _prepareWorkflowRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const workflowOptions = this._resolveWorkflowPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!workflowOptions.enabled) return runConfig;
    const botHookManager =
      runConfig?.botHookManager && typeof runConfig.botHookManager === "object"
        ? runConfig.botHookManager
        : runConfig?.botHooks &&
            typeof runConfig.botHooks === "object" &&
            typeof runConfig.botHooks.on === "function"
          ? runConfig.botHooks
          : createBotHookManager();
    const pluginApi = this._buildPluginRegisterApi({
      manager: botHookManager,
      pluginName: WORKFLOW_PLUGIN_KEY,
      options: workflowOptions,
      runConfig,
    });
    const workflowAlreadyRegistered = botHookManager.__noobotWorkflowPluginRegistered === true;
    if (!workflowAlreadyRegistered) {
      const registerWorkflow = resolvePluginRegisterByCapability(
        loadedDynamicPlugins,
        PLUGIN_CAPABILITY.BOT_REGISTER,
      );
      if (typeof registerWorkflow === "function") {
        registerWorkflow(
          pluginApi,
          workflowOptions,
        );
        Object.defineProperty(botHookManager, "__noobotWorkflowPluginRegistered", {
          value: true,
          enumerable: false,
          configurable: true,
        });
      }
    } else if (typeof pluginApi?.policy?.appendDenyToolNames === "function") {
      // Keep per-run policy patch behavior even when hook registration is reused.
      pluginApi.policy.appendDenyToolNames(workflowOptions?.denyToolNames || []);
    }
    const existingRuntimeMeta =
      botHookManager.runtime && typeof botHookManager.runtime === "object"
        ? botHookManager.runtime
        : {};
    botHookManager.runtime = {
      ...existingRuntimeMeta,
      workflow:
        workflowOptions && typeof workflowOptions === "object"
          ? workflowOptions
          : existingRuntimeMeta.workflow,
    };
    const pluginToolPolicyPatch = pluginApi?.policy?.getToolPolicyPatch?.() || {};
    const shouldAttachToolPolicy =
      (runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object") ||
      hasToolPolicyPatchContent({
        toolPolicyPatch: pluginToolPolicyPatch,
        normalizeStringArray: (input) => this._normalizeStringArray(input),
      });
    return {
      ...runConfig,
      botHookManager,
      ...(shouldAttachToolPolicy
        ? {
            toolPolicy: mergeToolPolicyPatch({
              baseToolPolicy: runConfig?.toolPolicy,
              toolPolicyPatch: pluginToolPolicyPatch,
              normalizeStringArray: (input) => this._normalizeStringArray(input),
            }),
          }
        : {}),
      plugins: {
        ...(runConfig?.plugins || {}),
        [WORKFLOW_PLUGIN_KEY]: workflowOptions,
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

  _buildPluginRegisterApi({ manager = null, pluginName = "", options = {}, runConfig = {} } = {}) {
    const hookManager = manager && typeof manager === "object" ? manager : null;
    const safePluginName = String(pluginName || "").trim();
    const safeOptions = options && typeof options === "object" ? options : {};
    const policy = createPluginPolicyApi({
      baseToolPolicy: runConfig?.toolPolicy,
      normalizeStringArray: (input) => this._normalizeStringArray(input),
    });
    return {
      hookManager,
      hooks: hookManager,
      botHookManager: hookManager,
      botHooks: hookManager,
      policy,
      runtime: {
        plugin: safePluginName,
        options: safeOptions,
      },
      runConfig: {
        plugins: {
          [safePluginName]: safeOptions,
        },
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
