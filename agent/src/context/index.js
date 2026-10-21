/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";
import { normalizeContextPolicy } from "@noobot/agent-config-protocol/enums";
import {
  resolveRuntimeBasePath,
  buildStaticInfo,
  resolveContextIdentityInfo,
} from "./providers/environment-provider.js";
import { resolveWorkspaceDirectories } from "./providers/workspace-provider.js";
import { resolveAllEnabledProviders } from "./providers/model-provider.js";
import { resolveRootSessionId } from "./providers/session-tree-resolver.js";
import { resolveLongMemory } from "./providers/memory-resolver.js";
import { buildAgentExecutionContext } from "./application/build-agent-execution-context.js";
import { buildSystemContext, buildSystemRuntime } from "./application/build-system-context.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { emitModelContextTrace } from "../observability/model-context-trace-emitter.js";
import { summarizeDiagnosticMessages } from "@noobot/context-protocol/assembly/diagnostics";
import { emitEvent } from "../events/index.js";
import { isAbortError } from "../shared/utils/error-utils.js";
import { BOT_MANAGE_LOG_EVENT, BOT_MANAGE_LOG_SOURCE } from "../bot/config/constants.js";
import { MEMORY_SUMMARY_STAGE } from "../memory/stage-runner.js";
import { text, isFunction, isPlainObject } from "@noobot/shared/value";
import { requireSessionCaller } from "@noobot/shared/session-caller";

function normalizeAdditionalSystemMessages(input) {
  return input.map((item) => text(item)).filter(Boolean);
}

const CONTEXT_BUILDER_INPUT_FIELDS = Object.freeze({
  config: Object.freeze(["globalConfig", "userConfig"]),
  serviceContainer: Object.freeze([
    "eventListener",
    "sessionManager",
    "memoryService",
    "attachmentService",
    "skillService",
    "botManager",
    "errorLogger",
    "userInteractionBridge",
  ]),
  sessionContext: Object.freeze([
    "userId",
    "sessionId",
    "caller",
    "parentSessionId",
    "userMessageAttachments",
    "systemMessages",
    "runConfig",
    "abortSignal",
    "persistenceScope",
  ]),
});

function assertContextBuilderInput(input) {
  if (!isPlainObject(input)) {
    throw new Error(tSystem("context.builderContainerInputRequired"));
  }
  const sections = Object.keys(CONTEXT_BUILDER_INPUT_FIELDS);
  const unknownSections = Object.keys(input).filter((section) => !sections.includes(section));
  if (unknownSections.length) {
    throw new TypeError(`ContextBuilder input has unknown sections: ${unknownSections.join(",")}`);
  }
  for (const [section, fields] of Object.entries(CONTEXT_BUILDER_INPUT_FIELDS)) {
    const value = input[section];
    if (!isPlainObject(value)) {
      throw new Error(tSystem("context.builderContainerInputRequired"));
    }
    const missing = fields.filter((field) => !Object.hasOwn(value, field));
    if (missing.length) {
      throw new TypeError(`ContextBuilder ${section} requires: ${missing.join(",")}`);
    }
    const unknown = Object.keys(value).filter((field) => !fields.includes(field));
    if (unknown.length) {
      throw new TypeError(`ContextBuilder ${section} has unknown fields: ${unknown.join(",")}`);
    }
  }
  const { sessionContext } = input;
  for (const field of ["userMessageAttachments", "systemMessages"]) {
    if (!Array.isArray(sessionContext[field])) {
      throw new TypeError(`ContextBuilder ${field} must be an array`);
    }
  }
  if (!isPlainObject(sessionContext.runConfig)) {
    throw new TypeError("ContextBuilder runConfig must be a plain object");
  }
  if (!isPlainObject(input.config.userConfig)) {
    throw new TypeError("ContextBuilder userConfig must be a plain object");
  }
}

export class ContextBuilder {
  constructor(input) {
    assertContextBuilderInput(input);
    const {
      globalConfig,
      userConfig,
      eventListener,
      userId,
      sessionId,
      caller,
      parentSessionId,
      userMessageAttachments,
      sessionManager,
      memoryService,
      attachmentService,
      skillService,
      botManager,
      errorLogger,
      userInteractionBridge,
      runConfig,
      systemMessages,
      abortSignal,
      persistenceScope,
    } = { ...input.config, ...input.serviceContainer, ...input.sessionContext };
    this.globalConfig = globalConfig;
    this.userConfig = userConfig;
    this.eventListener = eventListener;
    if (!text(userId) || !text(sessionId)) {
      throw new TypeError("ContextBuilder requires userId and sessionId");
    }
    if (typeof parentSessionId !== "string") {
      throw new TypeError("ContextBuilder parentSessionId must be a string");
    }
    this.userId = userId;
    this.sessionId = sessionId;
    this.caller = requireSessionCaller(caller);
    this.parentSessionId = parentSessionId;
    this.userMessageAttachments = userMessageAttachments;
    this.sessionManager = sessionManager;
    this.memoryService = memoryService;
    this.attachmentService = attachmentService;
    this.skillService = skillService;
    this.botManager = botManager;
    if (memoryService && !isFunction(errorLogger?.log)) {
      throw new TypeError("ContextBuilder with memoryService requires errorLogger.log");
    }
    this.errorLogger = errorLogger;
    this.userInteractionBridge = userInteractionBridge;
    this.runConfig = runConfig;
    this.contextPolicy = normalizeContextPolicy(runConfig.contextPolicy);
    this.additionalSystemMessages = normalizeAdditionalSystemMessages(systemMessages);
    this.abortSignal = abortSignal;
    const persistenceScopeValidation = validateSessionPersistenceScope(persistenceScope);
    if (!persistenceScopeValidation.valid) {
      throw new TypeError(
        `invalid Session persistence scope: ${persistenceScopeValidation.errors.join(",")}`,
      );
    }
    this.persistenceScope = persistenceScopeValidation.scope;
    this._effectiveConfigCache = null;
    this._runtimeBasePathCache = "";
    this._workspaceDirectoriesPromise = null;
  }

  _now() {
    return new Date().toISOString();
  }

  _getEffectiveConfig() {
    if (this._effectiveConfigCache) return this._effectiveConfigCache;
    this._effectiveConfigCache = mergeConfig(this.globalConfig, this.userConfig);
    return this._effectiveConfigCache;
  }

  _resolveRuntimeBasePath() {
    if (this._runtimeBasePathCache) return this._runtimeBasePathCache;
    this._runtimeBasePathCache = resolveRuntimeBasePath({
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    return this._runtimeBasePathCache;
  }

  async _resolveWorkspaceDirectoriesCached(runtimeBasePath = "") {
    if (!this._workspaceDirectoriesPromise) {
      this._workspaceDirectoriesPromise = resolveWorkspaceDirectories(runtimeBasePath);
    }
    return this._workspaceDirectoriesPromise;
  }

  async buildAgentContext(
    systemMessages,
    conversationMessages,
    { dialogProcessId = "", attachments = [], incrementalMessages = [] } = {},
  ) {
    const effectiveSystemMessages = [...systemMessages, ...this.additionalSystemMessages];
    const resolvedRuntimeBasePath = this._resolveRuntimeBasePath();
    const resolvedRootSessionId = await resolveRootSessionId({
      sessionManager: this.sessionManager,
      userId: this.userId,
      sessionId: this.sessionId,
      parentSessionId: this.parentSessionId,
    });

    const runtimeStaticInfo = buildStaticInfo({
      runtimeBasePath: resolvedRuntimeBasePath,
      identity: resolveContextIdentityInfo({
        userId: this.userId,
        globalConfig: this.globalConfig,
      }),
      globalConfig: this.globalConfig,
    });
    const workspaceDirectories =
      await this._resolveWorkspaceDirectoriesCached(resolvedRuntimeBasePath);
    const effectiveConfig = this._getEffectiveConfig();
    const runtimeModel = text(this.runConfig.runtimeModel);
    const allEnabledProviders = resolveAllEnabledProviders(effectiveConfig);
    const systemRuntime = {
      ...buildSystemRuntime({
        userId: this.userId,
        sessionId: this.sessionId,
        parentSessionId: this.parentSessionId,
        caller: this.caller,
        dialogProcessId,
        rootSessionId: resolvedRootSessionId,
        runConfig: this.runConfig,
        botManager: this.botManager,
        staticInfo: runtimeStaticInfo,
        isSuperUser: runtimeStaticInfo.identity.isSuperUser,
        now: this._now(),
      }),
      persistenceScope: this.persistenceScope,
    };
    return buildAgentExecutionContext({
      identity: {
        userId: this.userId,
        sessionId: this.sessionId,
        rootSessionId: resolvedRootSessionId,
        parentSessionId: this.parentSessionId,
        dialogProcessId,
      },
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      attachmentService: this.attachmentService,
      botManager: this.botManager,
      userInteractionBridge: this.userInteractionBridge,
      abortSignal: this.abortSignal,
      runConfig: this.runConfig,
      runtimeBasePath: resolvedRuntimeBasePath,
      runtimeModel,
      allEnabledProviders,
      systemRuntime,
      staticInfo: runtimeStaticInfo,
      workspaceDirectories,
      systemMessages: effectiveSystemMessages,
      conversationMessages,
      incrementalMessages,
      attachments,
    });
  }

  async _resolveSessionRecords({ dialogProcessId }) {
    return this.sessionManager.getContextProjection({
      userId: this.userId,
      sessionId: this.sessionId,
      persistenceScope: this.persistenceScope,
      currentDialogProcessId: dialogProcessId,
      currentTurnScopeId: text(this.runConfig.turnScopeId),
    });
  }

  async _buildSystemContext({ dialogProcessId, longMemory }) {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    return buildSystemContext({
      identity: {
        userId: this.userId,
        sessionId: this.sessionId,
        parentSessionId: this.parentSessionId,
        dialogProcessId,
      },
      caller: this.caller,
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      runConfig: this.runConfig,
      contextPolicy: this.contextPolicy,
      effectiveConfig: this._getEffectiveConfig(),
      runtimeBasePath,
      longMemory,
      sessionManager: this.sessionManager,
      skillService: this.skillService,
      botManager: this.botManager,
      userMessageAttachments: this.userMessageAttachments,
      resolveWorkspaceDirectories: (basePath) => this._resolveWorkspaceDirectoriesCached(basePath),
      now: () => this._now(),
    });
  }

  async _resolveLongMemoryForInjection() {
    try {
      return await resolveLongMemory({
        memoryService: this.memoryService,
        userId: this.userId,
      });
    } catch (error) {
      if (isAbortError(error, this.abortSignal)) throw error;
      emitEvent(this.eventListener, BOT_MANAGE_LOG_EVENT.MEMORY_INJECTION_FAILED, {
        sessionId: this.sessionId || "",
        stage: MEMORY_SUMMARY_STAGE.LONG_MEMORY,
        error: error?.message || String(error),
      });
      await this.errorLogger.log({
        userId: this.userId,
        sessionId: this.sessionId || "",
        source: BOT_MANAGE_LOG_SOURCE.MEMORY_INJECTION,
        event: BOT_MANAGE_LOG_EVENT.MEMORY_INJECTION_FAILED,
        error,
        extra: { stage: MEMORY_SUMMARY_STAGE.LONG_MEMORY },
      });
      return "";
    }
  }

  async _buildSessionContext({ dialogProcessId, mode }) {
    const sessionProjection = await this._resolveSessionRecords({ dialogProcessId });
    const sessionRecords = sessionProjection.messages;
    emitModelContextTrace(this.eventListener, "context_records_resolved", {
      mode,
      records: summarizeDiagnosticMessages(sessionRecords),
    });
    const longMemory = await this._resolveLongMemoryForInjection();
    const { systemContext, attachments } = await this._buildSystemContext({
      dialogProcessId,
      longMemory,
    });
    return this.buildAgentContext(systemContext, sessionRecords, {
      dialogProcessId,
      attachments,
    });
  }

  async buildNewSessionContext({ dialogProcessId }) {
    return this._buildSessionContext({ dialogProcessId, mode: "new_session" });
  }

  async buildExistingSessionContext({ dialogProcessId }) {
    return this._buildSessionContext({ dialogProcessId, mode: "existing_session" });
  }
}
