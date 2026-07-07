/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig, CONTEXT_SECTION_ALIASES } from "../config/index.js";
import { buildTools } from "../tools/index.js";
import { getConnectorChannelStore } from "../connectors/index.js";
import { getConnectorHistoryStore } from "../connectors/index.js";
import {
  resolveRuntimeBasePath,
  buildStaticInfo,
  buildSandboxViewStaticInfo,
  buildDynamicInfo,
} from "./providers/environment-provider.js";
import { resolveWorkspaceDirectories } from "./providers/workspace-provider.js";
import { resolveConnectorStatusSection } from "./providers/connector-status-provider.js";
import { resolveServices } from "./providers/service-provider.js";
import { resolveAvailableMcpServers } from "./providers/mcp-provider.js";
import {
  resolveModelSection,
  resolveAllEnabledProviders,
} from "./providers/model-provider.js";
import { loadSystemPrompt } from "./providers/system-prompt-loader.js";
import { resolveSessionTreeWithRootSessionId } from "./providers/session-tree-resolver.js";
import { resolveAttachments } from "./providers/attachment-resolver.js";
import { resolveSkills } from "./providers/skills-resolver.js";
import { resolveLongMemory } from "./providers/memory-resolver.js";
import { toConversationMessages } from "./session/message-converter.js";
import {
  buildRuntimeContext,
  initializeRuntimeEnvironment,
} from "./builders/runtime-environment-builder.js";
import { resolveScenarioProfile } from "./builders/scenario-resolver.js";
import { composeSystemInfoSections } from "./formatters/system-prompt-formatter.js";
import { mapToAgentContextSchema } from "./formatters/agent-context-mapper.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeParentSessionId } from "./parent-session-id-resolver.js";
import { emitModelContextTrace, summarizeDiagnosticMessages } from "../agent/core/message-context/context-diagnostics.js";
import { resolveConfiguredSuperUserId } from "../utils/super-user.js";

function resolveRuntimeSuperUserFlag({ globalConfig = {}, userId = "" } = {}) {
  const configuredSuperUserId = resolveConfiguredSuperUserId(globalConfig);
  if (!configuredSuperUserId) return false;
  return String(userId || "").trim() === configuredSuperUserId;
}

function normalizeAdditionalSystemMessages(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean);
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

  _resolveContextIncludeSet() {
    const contextPolicy = this.runConfig?.contextPolicy;
    const includeContextKeys = Array.isArray(contextPolicy?.includeContextKeys)
      ? contextPolicy.includeContextKeys
      : [];
    const normalizedKeys = includeContextKeys
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
    if (normalizedKeys.includes("*")) return new Set();
    return new Set(normalizedKeys);
  }

  _isContextSectionEnabled(includeSet, sectionKey = "") {
    if (!(includeSet instanceof Set) || includeSet.size === 0) return true;
    const normalizedSectionKey = String(sectionKey || "").trim().toLowerCase();
    if (!normalizedSectionKey) return false;
    const aliasMap = CONTEXT_SECTION_ALIASES;
    const aliasList = aliasMap[normalizedSectionKey] || [normalizedSectionKey];
    return aliasList.some((aliasItem) => includeSet.has(aliasItem));
  }

  async _buildStaticAgentContext({ runtimeBasePath = "" } = {}) {
    const staticInfo = buildStaticInfo({
      runtimeBasePath,
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    const resolvedBasePath = staticInfo.basePath || runtimeBasePath || "";
    return {
      cwd: staticInfo.cwd || process.cwd(),
      userId: staticInfo.userId || "",
      basePath: resolvedBasePath,
      platform: staticInfo.platform || process.platform,
      arch: staticInfo.arch || process.arch,
      nodeVersion: staticInfo.nodeVersion || process.version,
      timezone:
        staticInfo.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "",
      globalDefaults: staticInfo.globalDefaults || {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
      workspaceDirectories: await this._resolveWorkspaceDirectoriesCached(
        resolvedBasePath,
      ),
    };
  }

  _buildSystemRuntime({
    dialogProcessId = "",
    sessionTree = {},
    rootSessionId = "",
  } = {}) {
    const dynamicInfo = buildDynamicInfo({
      userId: this.userId,
      sessionId: this.sessionId,
      caller: this.caller,
      dialogProcessId,
      sessionTree,
      runConfig: this.runConfig,
      now: this._now(),
      rootSessionId,
      parentSessionId: this.parentSessionId,
    });
    const dependencySourceSummary =
      this.botManager?.startupContext?.runtime?.dependencies?.sourceSummary &&
      typeof this.botManager.startupContext.runtime.dependencies.sourceSummary === "object"
        ? this.botManager.startupContext.runtime.dependencies.sourceSummary
        : null;
    const systemRuntimeWithStartup = dependencySourceSummary
      ? { ...dynamicInfo, desktopDependencySources: dependencySourceSummary }
      : dynamicInfo;
    const systemRuntimePatch =
      this.runConfig?.systemRuntimePatch && typeof this.runConfig.systemRuntimePatch === "object"
        ? this.runConfig.systemRuntimePatch
        : null;
    const mergedRuntime = systemRuntimePatch ? { ...systemRuntimeWithStartup, ...systemRuntimePatch } : systemRuntimeWithStartup;
    // dialogProcessId/currentDialogProcessId are per-run identities generated by
    // initializeRunSessionRuntime. A stale systemRuntimePatch must not override
    // them, otherwise plugin injected messages from the current turn can be
    // filtered as "non-current dialog" while old injected summaries are kept.
    const protectedDialogProcessId = String(dynamicInfo?.dialogProcessId || dialogProcessId || "").trim();
    return {
      ...mergedRuntime,
      ...(protectedDialogProcessId
        ? {
            dialogProcessId: protectedDialogProcessId,
            currentDialogProcessId: protectedDialogProcessId,
          }
        : {}),
      isSuperUser: resolveRuntimeSuperUserFlag({
        globalConfig: this.globalConfig,
        userId: dynamicInfo?.userId || this.userId,
      }),
      parentSessionId: normalizeParentSessionId(mergedRuntime?.parentSessionId),
    };
  }

  async _buildAgentContext(
    systemMessages,
    conversationMessages,
    {
      runtimeBasePath = "",
      dialogProcessId = "",
      sessionTree = null,
      rootSessionId = "",
      attachments = [],
    } = {},
  ) {
    const effectiveSystemMessages = [
      ...(Array.isArray(systemMessages) ? systemMessages : []),
      ...this.additionalSystemMessages,
    ];
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
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
            now: this._now(),
          });

    const staticAgentContext = await this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const effectiveConfig = this._getEffectiveConfig();
    const runtime = buildRuntimeContext({
      userId: this.userId,
      basePath: resolvedRuntimeBasePath,
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      attachmentService: this.attachmentService,
      botManager: this.botManager,
      userInteractionBridge: this.userInteractionBridge,
      abortSignal: this.abortSignal,
      runtimeModel: String(this.runConfig?.runtimeModel || "").trim(),
      allEnabledProviders: resolveAllEnabledProviders(effectiveConfig),
      parentAsyncResultContainer: this.parentAsyncResultContainer,
      runConfig: this.runConfig,
      systemRuntime: this._buildSystemRuntime({
        dialogProcessId,
        sessionTree: resolvedSessionTree,
        rootSessionId: resolvedRootSessionId,
      }),
      userMessageAttachments: attachments,
    });
    await initializeRuntimeEnvironment(runtime);

    const agentContext = mapToAgentContextSchema({
      staticAgentContext,
      runtime,
      dialogProcessId,
      resolvedRootSessionId,
      resolvedSessionTree,
      sessionId: this.sessionId,
      parentSessionId: this.parentSessionId,
      caller: this.caller,
      now: this._now(),
      systemMessages: effectiveSystemMessages,
      conversationMessages,
      globalConfig: this.globalConfig,
    });
    const builtTools = await buildTools({
      sessionId: this.sessionId || "",
      parentSessionId: normalizeParentSessionId(this.parentSessionId),
      agentContext: {
        ...agentContext,
        runtime,
      },
    });
    agentContext.payload.tools.registry = Array.isArray(builtTools)
      ? builtTools
      : [];
    return agentContext;
  }

  async _resolveSessionRecords({ sessionId, dialogProcessId = "" } = {}) {
    const resolvedSessionId = sessionId || this.sessionId || "";
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.sessionManager || !runtimeBasePath || !resolvedSessionId)
      return [];
    return this.sessionManager.getContextRecords({
      userId: this.userId,
      sessionId: resolvedSessionId,
      userConfig: this.userConfig,
      currentDialogProcessId: dialogProcessId,
      currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
    });
  }

  async _buildSystemContext({ dialogProcessId = "", longMemory = null } = {}) {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    const effectiveConfig = this._getEffectiveConfig();
    const includeSet = this._resolveContextIncludeSet();
    const includeBasePrompt = this._isContextSectionEnabled(includeSet, "base_prompt");
    const includeSystemRuntime = this._isContextSectionEnabled(
      includeSet,
      "system_runtime",
    );
    const includeScenario = this._isContextSectionEnabled(includeSet, "scenario");
    const includeLongMemory = this._isContextSectionEnabled(includeSet, "long_memory");
    const includeModel = this._isContextSectionEnabled(includeSet, "model");
    const includeSkills = this._isContextSectionEnabled(includeSet, "skills");
    const includeServices = this._isContextSectionEnabled(includeSet, "services");
    const includeMcpServers = this._isContextSectionEnabled(includeSet, "mcp_servers");
    const includeConnectors = this._isContextSectionEnabled(includeSet, "connectors");
    const includeAttachments = this._isContextSectionEnabled(includeSet, "attachments");

    const treeInfo = await resolveSessionTreeWithRootSessionId({
      runtimeBasePath,
      sessionManager: this.sessionManager,
      userId: this.userId,
      sessionId: this.sessionId,
      now: this._now(),
    });

    const [systemPrompt, skills, attachments, workspaceDirectories] =
      await Promise.all([
        includeBasePrompt ? loadSystemPrompt() : "",
        includeSkills
          ? resolveSkills({
              skillService: this.skillService,
              runtimeBasePath,
              userId: this.userId,
            })
          : [],
        resolveAttachments({
          attachmentService: this.attachmentService,
          runtimeBasePath,
          effectiveConfig,
          userMessageAttachments: this.userMessageAttachments,
          userId: this.userId,
          sessionId: this.sessionId,
        }),
        includeSystemRuntime
          ? this._resolveWorkspaceDirectoriesCached(runtimeBasePath)
          : [],
      ]);
    const scenarioProfile = resolveScenarioProfile({
      runConfig: this.runConfig,
      effectiveConfig,
    });
    const services = includeServices
      ? resolveServices(effectiveConfig, {
          includeRefs: scenarioProfile?.services || [],
        })
      : [];
    const mcpServers = includeMcpServers
      ? resolveAvailableMcpServers(effectiveConfig, {
          includeNames: scenarioProfile?.mcpServers || [],
        })
      : [];
    const modelSection = includeModel
      ? resolveModelSection({
          globalConfig: this.globalConfig,
          userConfig: this.userConfig,
          effectiveConfig,
        })
      : {};
    const connectorStatusSection = includeConnectors
      ? await resolveConnectorStatusSection({
          rootSessionId: treeInfo.rootSessionId,
          userId: this.userId,
          selectedConnectors:
            this.runConfig?.selectedConnectors &&
            typeof this.runConfig.selectedConnectors === "object"
              ? this.runConfig.selectedConnectors
              : {},
          connectorChannelStore: getConnectorChannelStore(),
          connectorHistoryStore: getConnectorHistoryStore(),
        })
      : {};
    const identityInfo = {
      userId: String(this.userId || "").trim(),
      isSuperUser: resolveRuntimeSuperUserFlag({
        globalConfig: this.globalConfig,
        userId: this.userId,
      }),
    };

    const staticInfo = includeSystemRuntime
      ? {
          ...buildSandboxViewStaticInfo({
            runtimeBasePath,
            userId: this.userId,
            globalConfig: this.globalConfig,
            effectiveConfig,
          }),
          identity: identityInfo,
        }
      : { identity: identityInfo };
    const dynamicInfo = includeSystemRuntime
      ? this._buildSystemRuntime({
          dialogProcessId,
          sessionTree: treeInfo.sessionTree,
          rootSessionId: treeInfo.rootSessionId,
        })
      : {};
    const normalizedLongMemory = includeLongMemory ? longMemory : null;

    const systemContext = composeSystemInfoSections({
      locale: this.runConfig?.locale || "zh-CN",
      systemPrompt,
      staticInfo,
      dynamicInfo,
      scenarioSection: includeScenario ? scenarioProfile : {},
      longMemory: normalizedLongMemory,
      workspaceDirectories,
      modelSection,
      skills,
      services,
      mcpServers,
      attachments: includeAttachments ? attachments : [],
      connectorStatusSection,
    });
    return {
      systemContext,
      runtimeBasePath,
      sessionTree: treeInfo.sessionTree,
      rootSessionId: treeInfo.rootSessionId,
      attachments,
    };
  }

  async buildInitialContext({ dialogProcessId = "" } = {}) {
    const sessionRecords = await this._resolveSessionRecords({
      sessionId: this.sessionId || "",
      dialogProcessId,
    });
    emitModelContextTrace({ ...(this.runConfig || {}), eventListener: this.eventListener }, "context_records_resolved", {
      mode: "initial",
      sessionId: this.sessionId || "",
      dialogProcessId,
      currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
      records: summarizeDiagnosticMessages(sessionRecords),
    });
    const {
      systemContext,
      runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachments,
    } = await this._buildSystemContext({ dialogProcessId });
    return this._buildAgentContext(systemContext, toConversationMessages(sessionRecords), {
      runtimeBasePath,
      dialogProcessId,
      sessionTree,
      rootSessionId,
      attachments,
    });
  }

  async buildContinueContext({ dialogProcessId = "" } = {}) {
    const sessionRecords = await this._resolveSessionRecords({
      sessionId: this.sessionId || "",
      dialogProcessId,
    });
    emitModelContextTrace({ ...(this.runConfig || {}), eventListener: this.eventListener }, "context_records_resolved", {
      mode: "continue",
      sessionId: this.sessionId || "",
      dialogProcessId,
      currentTurnScopeId: String(this.runConfig?.turnScopeId || "").trim(),
      records: summarizeDiagnosticMessages(sessionRecords),
    });
    const longMemory = await resolveLongMemory({
      memoryService: this.memoryService,
      runtimeBasePath: this._resolveRuntimeBasePath(),
      userId: this.userId,
    });
    const {
      systemContext,
      runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachments,
    } = await this._buildSystemContext({ dialogProcessId, longMemory });
    return this._buildAgentContext(
      systemContext,
      toConversationMessages(sessionRecords),
      {
        runtimeBasePath,
        dialogProcessId,
        sessionTree,
        rootSessionId,
        attachments,
      },
    );
  }
}
