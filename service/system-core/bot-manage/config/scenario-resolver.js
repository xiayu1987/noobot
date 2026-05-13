/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { SCENARIO_CONFIG_KEYS } from "./constants.js";
import { logError } from "../../tracking/index.js";

/**
 * Resolve and parse scenario configuration from input and options.
 */
export class ScenarioResolver {
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
  }

  async resolve(input, options) {
    const config = this._parseScenarioConfig(input, options);
    return this._resolveScenarioConfig(config, options);
  }

  _parseScenarioConfig(input, options) {
    const config = {};

    if (input.scenarioConfig) {
      Object.assign(config, input.scenarioConfig);
    }

    if (options) {
      for (const key of SCENARIO_CONFIG_KEYS) {
        if (options[key] !== undefined) {
          config[key] = options[key];
        }
      }
    }

    return config;
  }

  async _resolveScenarioConfig(config, options) {
    const resolved = { ...config };

    if (!resolved.tools) {
      resolved.tools = await this._resolveDefaultTools(options);
    }

    if (!resolved.context) {
      resolved.context = await this._resolveDefaultContext(options);
    }

    if (!resolved.model) {
      resolved.model = await this._resolveDefaultModel(options);
    }

    return resolved;
  }

  async _resolveDefaultTools(options) {
    try {
      const userConfig = await this.workspaceService.loadUserConfig(options);
      return userConfig?.tools || [];
    } catch (error) {
      logError("[bot-manage][scenario-resolver] resolve default tools failed", {
        error: error?.message || String(error),
      });
      return [];
    }
  }

  async _resolveDefaultContext(options) {
    try {
      const userConfig = await this.workspaceService.loadUserConfig(options);
      return userConfig?.context || {};
    } catch (error) {
      logError("[bot-manage][scenario-resolver] resolve default context failed", {
        error: error?.message || String(error),
      });
      return {};
    }
  }

  async _resolveDefaultModel(options) {
    try {
      const userConfig = await this.workspaceService.loadUserConfig(options);
      return userConfig?.model || "default";
    } catch (error) {
      logError("[bot-manage][scenario-resolver] resolve default model failed", {
        error: error?.message || String(error),
      });
      return "default";
    }
  }
}
