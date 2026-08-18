/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";
import { normalizeContextPolicy } from "@noobot/agent-config-protocol/enums";
import { projectSessionRecordsToContextMessages } from "@noobot/context-protocol/message/session-projection";
import { resolveRuntimeBasePath, buildStaticInfo } from "./providers/environment-provider.js";
import { resolveWorkspaceDirectories } from "./providers/workspace-provider.js";
import { resolveAllEnabledProviders } from "./providers/model-provider.js";
import { resolveSessionTreeWithRootSessionId } from "./providers/session-tree-resolver.js";
import { resolveLongMemory } from "./providers/memory-resolver.js";
import { buildAgentExecutionContext } from "./application/build-agent-execution-context.js";
import {
  applyIdentityToStaticPathInfo,
  buildSystemContext,
  buildSystemRuntime,
} from "./application/build-system-context.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { emitModelContextTrace } from "../observability/model-context-trace-emitter.js";
import { summarizeDiagnosticMessages } from "@noobot/context-protocol/assembly/diagnostics";
import { resolveConfiguredSuperUserId } from "../shared/utils/super-user.js";

function resolveRuntimeSuperUserFlag({ globalConfig = {}, userId = "" } = {}) {
  const configuredSuperUserId = resolveConfiguredSuperUserId(globalConfig);
  if (!configuredSuperUserId) return false;
  return String(userId || "").trim() === configuredSuperUserId;
}

function normalizeAdditionalSystemMessages(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

export class ContextBuilder {
  constructor(input = {}) {
    const hasContainerShape =
      input &&
      typeof input === "object" &&
      input.config &&
      input.serviceContainer &&
      input.sessionContext;
    if (!hasContainerShape) {
      throw new Error(tSystem("context.builderContainerInputRequired"));
    }
    const normalized = {
      ...(input?.config || {}),
      ...(input?.serviceContainer || {}),
      ...(input?.sessionContext || {}),
    };
    const {
      globalConfig,
      userConfig = {},
      eventListener = null,
      userId = "",
      sessionId = "",
      caller = "user",
      parentSessionId = "",
      userMessageAttachments = [],
      sessionManager,
      memoryService,
      attachmentService,
      skillService,
      botManager = null,
      userInteractionBridge = null,
      runConfig = {},
      systemMessages = [],
      abortSignal = null,
      parentAsyncResultContainer = null,
    } = normalized;
    this.globalConfig = globalConfig;
    this.userConfig = userConfig;
    this.eventListener = eventListener;
    this.userId = userId;
    this.sessionId = sessionId;
    this.caller = caller;
    this.parentSessionId = parentSessionId;
    this.userMessageAttachments = Array.isArray(userMessageAttachments)
      ? userMessageAttachments
      : [];
    this.sessionManager = sessionManager;
    this.memoryService = memoryService;
    this.attachmentService = attachmentService;
    this.skillService = skillService;
    this.botManager = botManager;
    this.userInteractionBridge = userInteractionBridge;
    this.runConfig = runConfig;
    this.contextPolicy = normalizeContextPolicy(runConfig?.contextPolicy);
    this.additionalSystemMessages = normalizeAdditionalSystemMessages(systemMessages);
    this.abortSignal = abortSignal;
    this.parentAsyncResultContainer = parentAsyncResultContainer;
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

  async _buildStaticAgentContext({ runtimeBasePath = "" } = {}) {
    const staticInfo = buildStaticInfo({
      runtimeBasePath,
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    return {
      cwd: staticInfo.cwd || process.cwd(),
      userId: staticInfo.userId || "",
      basePath: staticInfo.basePath || runtimeBasePath || "",
      platform: staticInfo.platform || process.platform,
      arch: staticInfo.arch || process.arch,
      nodeVersion: staticInfo.nodeVersion || process.version,
      timezone: staticInfo.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      globalDefaults: staticInfo.globalDefaults || {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
      workspaceDirectories: await this._resolveWorkspaceDirectoriesCached(runtimeBasePath),
    };
  }

  async buildAgentContext(
    systemMessages,
    conversationMessages,
    {
      runtimeBasePath = "",
      dialogProcessId = "",
      sessionTree = null,
      rootSessionId = "",
      attachments = [],
      incrementalMessages = [],
      sourceRevision = "",
      contextBuildMode = "",
    } = {},
  ) {
    const contextBuildStartedAt = this._now();
    const effectiveSystemMessages = [
      ...(Array.isArray(systemMessages) ? systemMessages : []),
      ...this.additionalSystemMessages,
    ];
    const resolvedRuntimeBasePath = runtimeBasePath || this._resolveRuntimeBasePath();
    const { sessionTree: resolvedSessionTree, rootSessionId: resolvedRootSessionId } =
      sessionTree && typeof sessionTree === "object" && String(rootSessionId || "").trim()
        ? {
            sessionTree,
            rootSessionId: String(rootSessionId || "").trim(),
          }
        : await resolveSessionTreeWithRootSessionId({
            runtimeBasePath: resolvedRuntimeBasePath,
            sessionManager: this.sessionManager,
            userId: this.userId,
            sessionId: this.sessionId,
            parentSessionId: this.parentSessionId,
            now: this._now(),
          });

    const staticAgentContext = await this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const effectiveConfig = this._getEffectiveConfig();
    const runtimeStaticInfo = applyIdentityToStaticPathInfo(
      {
        ...buildStaticInfo({
          runtimeBasePath: resolvedRuntimeBasePath,
          userId: this.userId,
          globalConfig: this.globalConfig,
        }),
        identity: {
          userId: String(this.userId || "").trim(),
          isSuperUser: resolveRuntimeSuperUserFlag({
            globalConfig: this.globalConfig,
            userId: this.userId,
          }),
        },
      },
      {
        userId: String(this.userId || "").trim(),
        isSuperUser: resolveRuntimeSuperUserFlag({
          globalConfig: this.globalConfig,
          userId: this.userId,
        }),
      },
    );
    const runtimeModel = String(this.runConfig?.runtimeModel || "").trim();
    const allEnabledProviders = resolveAllEnabledProviders(effectiveConfig);
    const systemRuntime = buildSystemRuntime({
      userId: this.userId,
      sessionId: this.sessionId,
      parentSessionId: this.parentSessionId,
      caller: this.caller,
      dialogProcessId,
      rootSessionId: resolvedRootSessionId,
      runConfig: this.runConfig,
      globalConfig: this.globalConfig,
      botManager: this.botManager,
      staticInfo: runtimeStaticInfo,
      now: this._now(),
    });
    return buildAgentExecutionContext({
      identity: {
        userId: this.userId,
        sessionId: this.sessionId,
        rootSessionId: resolvedRootSessionId,
        parentSessionId: this.parentSessionId,
        dialogProcessId,
      },
      caller: this.caller,
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      attachmentService: this.attachmentService,
      botManager: this.botManager,
      userInteractionBridge: this.userInteractionBridge,
      abortSignal: this.abortSignal,
      parentAsyncResultContainer: this.parentAsyncResultContainer,
      runConfig: this.runConfig,
      runtimeBasePath: resolvedRuntimeBasePath,
      runtimeModel,
      allEnabledProviders,
      systemRuntime,
      staticAgentContext,
      systemMessages: effectiveSystemMessages,
      conversationMessages,
      incrementalMessages,
      attachments,
      contextBuild: {
        mode: contextBuildMode,
        sourceRevision,
        startedAt: contextBuildStartedAt,
        completedAt: this._now(),
      },
    });
  }

  async _resolveSessionRecords({ sessionId, dialogProcessId = "" } = {}) {
    const resolvedSessionId = sessionId || this.sessionId || "";
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.sessionManager || !runtimeBasePath || !resolvedSessionId)
      return { messages: [], sourceRevision: "" };
    return this.sessionManager.getContextProjection({
      userId: this.userId,
      sessionId: resolvedSessionId,
      parentSessionId: normalizeParentSessionId(this.parentSessionId),
      userConfig: this.userConfig,
      currentDialogProcessId: dialogProcessId,
      currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
    });
  }

  async _buildSystemContext({ dialogProcessId = "", longMemory = null } = {}) {
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
      attachmentService: this.attachmentService,
      skillService: this.skillService,
      botManager: this.botManager,
      userMessageAttachments: this.userMessageAttachments,
      resolveWorkspaceDirectories: (basePath) => this._resolveWorkspaceDirectoriesCached(basePath),
      now: () => this._now(),
    });
  }

  async buildNewSessionContext({ dialogProcessId = "" } = {}) {
    const sessionProjection = await this._resolveSessionRecords({
      sessionId: this.sessionId || "",
      dialogProcessId,
    });
    const sessionRecords = sessionProjection?.messages || [];
    emitModelContextTrace(
      { ...(this.runConfig || {}), eventListener: this.eventListener },
      "context_records_resolved",
      {
        mode: "new_session",
        sessionId: this.sessionId || "",
        dialogProcessId,
        currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
        records: summarizeDiagnosticMessages(sessionRecords),
      },
    );
    const { systemContext, runtimeBasePath, sessionTree, rootSessionId, attachments } =
      await this._buildSystemContext({ dialogProcessId });
    return this.buildAgentContext(
      systemContext,
      projectSessionRecordsToContextMessages(sessionRecords),
      {
        runtimeBasePath,
        dialogProcessId,
        sessionTree,
        rootSessionId,
        attachments,
        sourceRevision: sessionProjection?.sourceRevision || "",
        contextBuildMode: "new_session",
      },
    );
  }

  async buildExistingSessionContext({ dialogProcessId = "" } = {}) {
    const sessionProjection = await this._resolveSessionRecords({
      sessionId: this.sessionId || "",
      dialogProcessId,
    });
    const sessionRecords = sessionProjection?.messages || [];
    emitModelContextTrace(
      { ...(this.runConfig || {}), eventListener: this.eventListener },
      "context_records_resolved",
      {
        mode: "existing_session",
        sessionId: this.sessionId || "",
        dialogProcessId,
        currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
        records: summarizeDiagnosticMessages(sessionRecords),
      },
    );
    const longMemory = await resolveLongMemory({
      memoryService: this.memoryService,
      runtimeBasePath: this._resolveRuntimeBasePath(),
      userId: this.userId,
    });
    const { systemContext, runtimeBasePath, sessionTree, rootSessionId, attachments } =
      await this._buildSystemContext({ dialogProcessId, longMemory });
    return this.buildAgentContext(
      systemContext,
      projectSessionRecordsToContextMessages(sessionRecords),
      {
        runtimeBasePath,
        dialogProcessId,
        sessionTree,
        rootSessionId,
        attachments,
        sourceRevision: sessionProjection?.sourceRevision || "",
        contextBuildMode: "existing_session",
      },
    );
  }

  async buildInitialContext(payload = {}) {
    return this.buildNewSessionContext(payload);
  }

  async buildContinueContext(payload = {}) {
    return this.buildExistingSessionContext(payload);
  }
}
