/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isContextSectionSelected,
  normalizeContextSectionSelection,
} from "@noobot/agent-config-protocol/enums";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { resolveConfiguredSuperUserId } from "../../shared/utils/super-user.js";
import { resolveScenarioProfile } from "../builders/scenario-resolver.js";
import { composeSystemInfoSections } from "../formatters/system-prompt-formatter.js";
import { resolveAttachments } from "../providers/attachment-resolver.js";
import { resolveConnectorStatusSection } from "../providers/connector-status-provider.js";
import { buildDynamicInfo, buildStaticInfo } from "../providers/environment-provider.js";
import { resolveAvailableMcpServers } from "../providers/mcp-provider.js";
import { resolveModelSection } from "../providers/model-provider.js";
import { resolveServices } from "../providers/service-provider.js";
import { resolveSessionTreeWithRootSessionId } from "../providers/session-tree-resolver.js";
import { resolveSkills } from "../providers/skills-resolver.js";
import { loadSystemPrompt } from "../providers/system-prompt-loader.js";

function resolveSuperUserFlag({ globalConfig = {}, userId = "" } = {}) {
  const configuredSuperUserId = resolveConfiguredSuperUserId(globalConfig);
  return Boolean(configuredSuperUserId) && String(userId || "").trim() === configuredSuperUserId;
}

export function applyIdentityToStaticPathInfo(staticInfo = {}, identityInfo = {}) {
  const sourceInfo = staticInfo && typeof staticInfo === "object" ? staticInfo : {};
  const directories =
    sourceInfo?.directories && typeof sourceInfo.directories === "object"
      ? sourceInfo.directories
      : null;
  if (!directories || directories.view !== "host" || identityInfo?.isSuperUser !== true) {
    return sourceInfo;
  }
  return {
    ...sourceInfo,
    directories: {
      ...directories,
      allowedRoots: ["<host-filesystem>"],
      hostAbsolutePaths: true,
    },
  };
}

export function buildSystemRuntime({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  caller = "user",
  dialogProcessId = "",
  rootSessionId = "",
  runConfig = {},
  globalConfig = {},
  botManager = null,
  staticInfo = null,
  now = new Date().toISOString(),
} = {}) {
  const dynamicInfo = buildDynamicInfo({
    userId,
    sessionId,
    caller,
    dialogProcessId,
    runConfig,
    now,
    rootSessionId,
    parentSessionId,
  });
  const dependencySourceSummary =
    botManager?.startupContext?.runtime?.dependencies?.sourceSummary &&
    typeof botManager.startupContext.runtime.dependencies.sourceSummary === "object"
      ? botManager.startupContext.runtime.dependencies.sourceSummary
      : null;
  const runtimeWithStartup = dependencySourceSummary
    ? { ...dynamicInfo, desktopDependencySources: dependencySourceSummary }
    : dynamicInfo;
  const runtimePatch =
    runConfig?.systemRuntimePatch && typeof runConfig.systemRuntimePatch === "object"
      ? runConfig.systemRuntimePatch
      : null;
  const mergedRuntime = runtimePatch
    ? { ...runtimeWithStartup, ...runtimePatch }
    : runtimeWithStartup;
  const protectedDialogProcessId = String(dynamicInfo?.dialogProcessId || "").trim();
  return {
    ...mergedRuntime,
    ...(staticInfo && typeof staticInfo === "object" ? { staticInfo } : {}),
    ...(protectedDialogProcessId
      ? {
          dialogProcessId: protectedDialogProcessId,
          currentDialogProcessId: protectedDialogProcessId,
        }
      : {}),
    isSuperUser: resolveSuperUserFlag({
      globalConfig,
      userId: dynamicInfo?.userId || userId,
    }),
    parentSessionId: normalizeParentSessionId(mergedRuntime?.parentSessionId),
  };
}

export async function buildSystemContext({
  identity = {},
  caller = "user",
  globalConfig = {},
  userConfig = {},
  runConfig = {},
  contextPolicy = {},
  effectiveConfig = {},
  runtimeBasePath = "",
  longMemory = null,
  sessionManager = null,
  attachmentService = null,
  skillService = null,
  botManager = null,
  userMessageAttachments = [],
  resolveWorkspaceDirectories,
  now = () => new Date().toISOString(),
} = {}) {
  const includeSet = normalizeContextSectionSelection(contextPolicy.promptSections);
  const enabled = (section) => isContextSectionSelected(includeSet, section);
  const selectedConnectorIds = normalizeSelectedConnectorIds(runConfig?.selectedConnectorIds);
  const includeConnectors = enabled("connectors") || selectedConnectorIds.length > 0;
  const locale = runConfig?.locale || "zh-CN";
  const scenarioProfile = resolveScenarioProfile({ runConfig, effectiveConfig });

  const treeInfo = await resolveSessionTreeWithRootSessionId({
    runtimeBasePath,
    sessionManager,
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    now: now(),
  });
  const attachmentsAvailableToRuntime = contextPolicy.runtimeCapabilities.attachments;
  const [systemPrompt, skills, attachments, workspaceDirectories, connectorStatusSection] =
    await Promise.all([
      enabled("base_prompt") ? loadSystemPrompt({ locale }) : "",
      enabled("skills")
        ? resolveSkills({ skillService, runtimeBasePath, userId: identity.userId })
        : [],
      attachmentsAvailableToRuntime
        ? resolveAttachments({
            attachmentService,
            runtimeBasePath,
            effectiveConfig,
            userMessageAttachments,
            userId: identity.userId,
            sessionId: identity.sessionId,
          })
        : [],
      enabled("system_runtime") ? resolveWorkspaceDirectories(runtimeBasePath) : [],
      includeConnectors
        ? resolveConnectorStatusSection({
            userId: identity.userId,
            selectedConnectorIds,
            connectorAccessPort: botManager?.connectorAccessPort,
          })
        : {},
    ]);
  const services = enabled("services")
    ? resolveServices(effectiveConfig, { includeRefs: scenarioProfile?.services || [] })
    : [];
  const mcpServers = enabled("mcp_servers")
    ? resolveAvailableMcpServers(effectiveConfig, {
        includeNames: scenarioProfile?.mcpServers || [],
      })
    : [];
  const modelSection = enabled("model")
    ? resolveModelSection({ globalConfig, userConfig, effectiveConfig })
    : {};
  const identityInfo = {
    userId: String(identity.userId || "").trim(),
    isSuperUser: resolveSuperUserFlag({ globalConfig, userId: identity.userId }),
  };
  const staticInfo = enabled("system_runtime")
    ? applyIdentityToStaticPathInfo(
        {
          ...buildStaticInfo({ runtimeBasePath, userId: identity.userId, globalConfig }),
          identity: identityInfo,
        },
        identityInfo,
      )
    : { identity: identityInfo };
  const dynamicInfo = enabled("system_runtime")
    ? buildSystemRuntime({
        ...identity,
        caller,
        runConfig,
        globalConfig,
        botManager,
        rootSessionId: treeInfo.rootSessionId,
        now: now(),
      })
    : {};
  return {
    systemContext: composeSystemInfoSections({
      locale,
      systemPrompt,
      staticInfo,
      dynamicInfo,
      scenarioSection: enabled("scenario") ? scenarioProfile : {},
      longMemory: enabled("long_memory") ? longMemory : null,
      workspaceDirectories,
      modelSection,
      skills,
      services,
      mcpServers,
      attachments: enabled("attachments") ? attachments : [],
      connectorStatusSection,
    }),
    runtimeBasePath,
    sessionTree: treeInfo.sessionTree,
    rootSessionId: treeInfo.rootSessionId,
    attachments,
  };
}
