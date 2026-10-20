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
import { resolveScenarioProfile } from "../builders/scenario-resolver.js";
import { composeSystemInfoSections } from "../formatters/system-prompt-formatter.js";
import { resolveConnectorStatusSection } from "../providers/connector-status-provider.js";
import {
  buildDynamicInfo,
  buildStaticInfo,
  resolveContextIdentityInfo,
} from "../providers/environment-provider.js";
import { resolveAvailableMcpServers } from "../providers/mcp-provider.js";
import { resolveModelSection } from "../providers/model-provider.js";
import { resolveServices } from "../providers/service-provider.js";
import { resolveRootSessionId } from "../providers/session-tree-resolver.js";
import { resolveSkills } from "../providers/skills-resolver.js";
import { loadSystemPrompt } from "../providers/system-prompt-loader.js";
import { text } from "@noobot/shared/value";

export function buildSystemRuntime({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  caller = "user",
  dialogProcessId = "",
  rootSessionId = "",
  runConfig = {},
  botManager,
  staticInfo = null,
  isSuperUser,
  now = new Date().toISOString(),
} = {}) {
  if (typeof isSuperUser !== "boolean") {
    throw new TypeError("buildSystemRuntime requires boolean isSuperUser");
  }
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
  const startupDependencies = botManager.startupContext.runtime.dependencies;
  const runtimeWithStartup =
    startupDependencies === null
      ? dynamicInfo
      : { ...dynamicInfo, desktopDependencySources: startupDependencies.sourceSummary };
  const protectedDialogProcessId = text(dynamicInfo?.dialogProcessId);
  return {
    ...runtimeWithStartup,
    ...(staticInfo && typeof staticInfo === "object" ? { staticInfo } : {}),
    ...(protectedDialogProcessId
      ? {
          dialogProcessId: protectedDialogProcessId,
          currentDialogProcessId: protectedDialogProcessId,
        }
      : {}),
    isSuperUser,
    parentSessionId: normalizeParentSessionId(runtimeWithStartup?.parentSessionId),
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
  runtimeBasePath,
  longMemory = null,
  sessionManager = null,
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
  const scenarioProfile = resolveScenarioProfile({ runConfig });

  const rootSessionId = await resolveRootSessionId({
    sessionManager,
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
  });
  const attachmentsAvailableToRuntime = contextPolicy.runtimeCapabilities.attachments;
  const [systemPrompt, skills, attachments, workspaceDirectories, connectorStatusSection] =
    await Promise.all([
      enabled("base_prompt") ? loadSystemPrompt({ locale }) : "",
      enabled("skills") ? resolveSkills({ skillService, userId: identity.userId }) : [],
      attachmentsAvailableToRuntime ? userMessageAttachments : [],
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
    ? resolveModelSection({
        globalConfig,
        userConfig,
        effectiveConfig,
        selectedModel: runConfig?.selectedModel,
        scenario: runConfig?.scenario,
      })
    : {};
  const identityInfo = resolveContextIdentityInfo({ userId: identity.userId, globalConfig });
  const staticInfo = enabled("system_runtime")
    ? buildStaticInfo({ runtimeBasePath, identity: identityInfo, globalConfig })
    : { identity: identityInfo };
  const dynamicInfo = enabled("system_runtime")
    ? buildSystemRuntime({
        ...identity,
        caller,
        runConfig,
        botManager,
        rootSessionId,
        isSuperUser: identityInfo.isSuperUser,
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
    attachments,
  };
}
