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
import {
  getConnectorChannelStore,
  getConnectorRegistry,
} from "../../integrations/connectors/index.js";
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
  const includeBasePrompt = enabled("base_prompt");
  const includeSystemRuntime = enabled("system_runtime");
  const includeScenario = enabled("scenario");
  const includeLongMemory = enabled("long_memory");
  const includeModel = enabled("model");
  const includeSkills = enabled("skills");
  const includeServices = enabled("services");
  const includeMcpServers = enabled("mcp_servers");
  const includeConnectors = enabled("connectors");
  const includeAttachments = enabled("attachments");
  const locale = runConfig?.locale || "zh-CN";

  const treeInfo = await resolveSessionTreeWithRootSessionId({
    runtimeBasePath,
    sessionManager,
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    now: now(),
  });
  const attachmentsAvailableToRuntime = contextPolicy.runtimeCapabilities.attachments;
  const [systemPrompt, skills, attachments, workspaceDirectories] = await Promise.all([
    includeBasePrompt ? loadSystemPrompt({ locale }) : "",
    includeSkills ? resolveSkills({ skillService, runtimeBasePath, userId: identity.userId }) : [],
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
    includeSystemRuntime ? resolveWorkspaceDirectories(runtimeBasePath) : [],
  ]);
  const scenarioProfile = resolveScenarioProfile({ runConfig, effectiveConfig });
  const services = includeServices
    ? resolveServices(effectiveConfig, { includeRefs: scenarioProfile?.services || [] })
    : [];
  const mcpServers = includeMcpServers
    ? resolveAvailableMcpServers(effectiveConfig, {
        includeNames: scenarioProfile?.mcpServers || [],
      })
    : [];
  const modelSection = includeModel
    ? resolveModelSection({ globalConfig, userConfig, effectiveConfig })
    : {};
  const connectorStatusSection = includeConnectors
    ? await resolveConnectorStatusSection({
        userId: identity.userId,
        selectedConnectorIds: normalizeSelectedConnectorIds(runConfig?.selectedConnectorIds),
        connectorChannelStore: getConnectorChannelStore(),
        connectorRegistry: getConnectorRegistry({ required: false }),
      })
    : {};
  const identityInfo = {
    userId: String(identity.userId || "").trim(),
    isSuperUser: resolveSuperUserFlag({ globalConfig, userId: identity.userId }),
  };
  const staticInfo = includeSystemRuntime
    ? applyIdentityToStaticPathInfo(
        {
          ...buildStaticInfo({ runtimeBasePath, userId: identity.userId, globalConfig }),
          identity: identityInfo,
        },
        identityInfo,
      )
    : { identity: identityInfo };
  const dynamicInfo = includeSystemRuntime
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
      scenarioSection: includeScenario ? scenarioProfile : {},
      longMemory: includeLongMemory ? longMemory : null,
      workspaceDirectories,
      modelSection,
      skills,
      services,
      mcpServers,
      attachments: includeAttachments ? attachments : [],
      connectorStatusSection,
    }),
    runtimeBasePath,
    sessionTree: treeInfo.sessionTree,
    rootSessionId: treeInfo.rootSessionId,
    attachments,
  };
}
