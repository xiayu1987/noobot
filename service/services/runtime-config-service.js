/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createRuntimeConfigService({
  globalConfigRaw,
  readWorkspaceConfigParams,
  resolveConfigSecrets,
  BotManager,
  setApiKeyTtlMs,
  setGlobalConfig,
  setBot,
  workspaceRootPath,
  initConnectorHistoryStore,
} = {}) {
  async function rebuildRuntimeConfig() {
    const paramsPayload = await readWorkspaceConfigParams({ createIfMissing: true });
    const configParams = paramsPayload.values || {};
    const resolvedGlobalConfig = resolveConfigSecrets(globalConfigRaw, {
      configParams,
    });
    resolvedGlobalConfig.configParams = { ...configParams };
    setApiKeyTtlMs(Number(resolvedGlobalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000));
    const bot = new BotManager(resolvedGlobalConfig);
    setGlobalConfig(resolvedGlobalConfig);
    setBot(bot);
    initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });
    return {
      bot,
      globalConfig: resolvedGlobalConfig,
      configParams,
    };
  }

  return {
    rebuildRuntimeConfig,
  };
}
