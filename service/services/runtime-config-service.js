/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionPluginRuntimeBundle } from "#agent/plugin";
import { assertConnectorAccessPort } from "@noobot/connector-protocol";
import { isFunction } from "@noobot/shared/value";

export function createRuntimeConfigService({
  startupContext,
  readWorkspaceConfigParams,
  globalConfigBuilder,
  BotManager,
  now,
  setGlobalConfigRaw,
  setGlobalConfig,
  setBot,
  connectorAccessPort,
} = {}) {
  const connectorPort = assertConnectorAccessPort(connectorAccessPort);
  if (!isFunction(now)) throw new TypeError("createRuntimeConfigService requires now function");
  async function rebuildRuntimeConfig() {
    if (!globalConfigBuilder || !isFunction(globalConfigBuilder.build)) {
      throw new Error("[runtime-config-service] globalConfigBuilder.build is required");
    }
    const paramsPayload = await readWorkspaceConfigParams({ createIfMissing: true });
    const configParams = paramsPayload.values || {};
    const builtConfig = await globalConfigBuilder.build({ configParams });

    const persistedGlobalConfig = builtConfig?.persistedConfig;
    const resolvedGlobalConfig = builtConfig?.resolvedConfig || {};
    const pluginRuntimeBundle = await createSessionPluginRuntimeBundle({
      pluginRootDir: startupContext.paths.pluginRootDir,
    });
    const bot = new BotManager(resolvedGlobalConfig, {
      globalConfigRaw: persistedGlobalConfig,
      startupContext,
      pluginRuntimeBundle,
      connectorAccessPort: connectorPort,
      now,
    });
    setGlobalConfigRaw(persistedGlobalConfig);
    setGlobalConfig(resolvedGlobalConfig);
    setBot(bot);
    return {
      bot,
      globalConfigRaw: persistedGlobalConfig,
      globalConfig: resolvedGlobalConfig,
      configParams,
    };
  }

  return {
    rebuildRuntimeConfig,
  };
}
