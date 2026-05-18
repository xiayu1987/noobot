/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createRuntimeConfigService({
  readWorkspaceConfigParams,
  globalConfigBuilder,
  BotManager,
  setApiKeyTtlMs,
  setGlobalConfigRaw,
  setGlobalConfig,
  setBot,
  workspaceRootPath,
  initConnectorHistoryStore,
} = {}) {
  async function rebuildRuntimeConfig() {
    if (!globalConfigBuilder || typeof globalConfigBuilder.build !== "function") {
      throw new Error("[runtime-config-service] globalConfigBuilder.build is required");
    }
    const paramsPayload = await readWorkspaceConfigParams({ createIfMissing: true });
    const configParams = paramsPayload.values || {};
    const builtConfig = await globalConfigBuilder.build({ configParams });
    const rawGlobalConfig = builtConfig?.rawConfig || {};
    const resolvedGlobalConfig = builtConfig?.resolvedConfig || {};
    setApiKeyTtlMs(Number(resolvedGlobalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000));
    const bot = new BotManager(resolvedGlobalConfig);
    setGlobalConfigRaw(rawGlobalConfig);
    setGlobalConfig(resolvedGlobalConfig);
    setBot(bot);
    initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });
    return {
      bot,
      globalConfigRaw: rawGlobalConfig,
      globalConfig: resolvedGlobalConfig,
      configParams,
    };
  }

  return {
    rebuildRuntimeConfig,
  };
}
