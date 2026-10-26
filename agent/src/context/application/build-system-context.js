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
import { resolveSkills } from "../providers/skills-resolver.js";
import { loadSystemPrompt } from "../providers/system-prompt-loader.js";

export function buildSystemRuntime({
  identity,
  runConfig,
  botManager,
  staticInfo = null,
  isSuperUser,
  now,
}) {
  if (typeof isSuperUser !== "boolean") {
    throw new TypeError("buildSystemRuntime requires boolean isSuperUser");
  }
  const dynamicInfo = buildDynamicInfo({ identity, runConfig, now });
  const startupDependencies = botManager.startupContext.runtime.dependencies;
  const runtimeWithStartup =
    startupDependencies === null
      ? dynamicInfo
      : { ...dynamicInfo, desktopDependencySources: startupDependencies.sourceSummary };
  return {
    ...runtimeWithStartup,
    ...(staticInfo && typeof staticInfo === "object" ? { staticInfo } : {}),
    isSuperUser,
  };
}

export async function buildSystemContext({
  identity,
  globalConfig = {},
  userConfig = {},
  runConfig = {},
  contextPolicy = {},
  effectiveConfig = {},
  runtimeBasePath,
  longMemory = null,
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
        identity,
        runConfig,
        botManager,
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
