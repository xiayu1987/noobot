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
  createSessionRuntime,
  now,
  setGlobalConfigRaw,
  setGlobalConfig,
  getBot,
  setBot,
  withBotRetirement,
  connectorAccessPort,
} = {}) {
  const connectorPort = assertConnectorAccessPort(connectorAccessPort);
  if (!isFunction(createSessionRuntime))
    throw new TypeError("createRuntimeConfigService requires createSessionRuntime");
  if (!isFunction(now)) throw new TypeError("createRuntimeConfigService requires now function");
  if (!isFunction(getBot)) throw new TypeError("createRuntimeConfigService requires getBot");
  if (!isFunction(withBotRetirement))
    throw new TypeError("createRuntimeConfigService requires withBotRetirement");
  let pending = Promise.resolve();
  async function rebuild() {
    if (!globalConfigBuilder || !isFunction(globalConfigBuilder.build)) {
      throw new Error("[runtime-config-service] globalConfigBuilder.build is required");
    }
    const paramsPayload = await readWorkspaceConfigParams({ createIfMissing: true });
    const configParams = paramsPayload.values || {};
    const builtConfig = await globalConfigBuilder.build({
      configParams,
      requirePartitionStorage: true,
    });

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
      createSessionRuntime,
      now,
    });
    try {
      await withBotRetirement(async () => {
        const previous = getBot();
        if (previous !== null) await previous.close();
        setGlobalConfigRaw(persistedGlobalConfig);
        setGlobalConfig(resolvedGlobalConfig);
        setBot(bot);
      });
    } catch (cause) {
      try {
        await bot.close();
      } catch (cleanup) {
        throw new AggregateError(
          [cause, cleanup],
          "Runtime replacement and candidate cleanup failed",
        );
      }
      throw cause;
    }
    return {
      bot,
      globalConfigRaw: persistedGlobalConfig,
      globalConfig: resolvedGlobalConfig,
      configParams,
    };
  }

  function rebuildRuntimeConfig() {
    const result = pending.then(rebuild);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    rebuildRuntimeConfig,
  };
}
