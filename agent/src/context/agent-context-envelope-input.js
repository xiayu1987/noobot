/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function projectAgentContextIdentity(identity, runConfig) {
  return {
    userId: identity.userId,
    sessionId: identity.sessionId,
    rootSessionId: identity.rootSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    runId: runConfig.executionId,
    presentationMessageId: runConfig.presentationMessageId,
  };
}

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
    identity: projectAgentContextIdentity(identity, runConfig),
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
