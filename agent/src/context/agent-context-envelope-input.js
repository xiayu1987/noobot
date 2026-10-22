/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeParentSessionId } from "@noobot/session-protocol";

export function createAgentContextEnvelopeInput({
  identity,
  runConfig,
  staticInfo,
  workspaceDirectories,
  systemRuntime,
  runtimeModel,
  allEnabledProviders,
  systemMessages,
  conversationMessages,
  incrementalMessages,
  userMetaBackwrites,
}) {
  return {
    identity: {
      userId: identity.userId,
      sessionId: identity.sessionId,
      rootSessionId: identity.rootSessionId,
      parentSessionId: normalizeParentSessionId(identity.parentSessionId),
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: runConfig.turnScopeId,
      runId: runConfig.executionId,
      presentationMessageId: runConfig.presentationMessageId,
    },
    environment: {
      os: {
        platform: staticInfo.platform,
        arch: staticInfo.arch,
        timezone: staticInfo.timezone,
        nodeVersion: staticInfo.nodeVersion,
      },
      workspace: {
        cwd: staticInfo.cwd,
        basePath: staticInfo.basePath,
        workspaceDirectories,
        globalDefaults: staticInfo.globalDefaults,
      },
      permissions: { isSuperUser: systemRuntime.isSuperUser },
    },
    execution: {
      timestamp: systemRuntime.now,
      caller: systemRuntime.caller,
      flags: {
        allowUserInteraction: systemRuntime.config.allowUserInteraction,
        safeConfirm: systemRuntime.config.safeConfirm,
      },
      model: { runtimeModel, allEnabledProviders },
      selectedConnectorIds: systemRuntime.config.selectedConnectorIds,
    },
    messageBlocks: {
      system: systemMessages,
      history: conversationMessages,
      incremental: incrementalMessages,
    },
    userMetaBackwrites,
  };
}
