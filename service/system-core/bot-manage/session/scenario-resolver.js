/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { SCENARIO_CONFIG_KEYS } from "../constants.js";
import { logError } from "../../tracking/index.js";

/**
 * Resolve and parse scenario configuration from input and options.
 */
export class ScenarioResolver {
  /**
   * @param {Object} workspaceService - Workspace service instance
   */
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
  }

  /**
   * Resolve scenario configuration from input and options.
   * @param {Object} input - User input
   * @param {Object} options - Execution options
   * @returns {Object} Resolved scenario configuration
   */
  async resolve(input, options) {
    const config = this._parseScenarioConfig(input, options);
    return this._resolveScenarioConfig(config, options);
  }

  /**
   * Parse scenario configuration from input and options.
   * @param {Object} input - User input
   * @param {Object} options - Execution options
   * @returns {Object} Parsed scenario configuration
   */
  _parseScenarioConfig(input, options) {
    const config = {};

    // Extract from input
    if (input.scenarioConfig) {
      Object.assign(config, input.scenarioConfig);
    }

    // Extract from options
    if (options) {
      for (const key of SCENARIO_CONFIG_KEYS) {
        if (options[key] !== undefined) {
          config[key] = options[key];
        }
      }
    }

    return config;
  }

  /**
   * Resolve scenario configuration with defaults and workspace data.
   * @param {Object} config - Parsed scenario configuration
   * @param {Object} options - Execution options
   * @returns {Object} Resolved scenario configuration
   */
  async _resolveScenarioConfig(config, options) {
    const resolved = { ...config };

    // Resolve tools
    if (!resolved.tools) {
      resolved.tools = await this._resolveDefaultTools(options);
    }

    // Resolve context
    if (!resolved.context) {
      resolved.context = await this._resolveDefaultContext(options);
    }

    // Resolve model
    if (!resolved.model) {
      resolved.model = await this._resolveDefaultModel(options);
    }

    return resolved;
  }

  /**
   * Resolve default tools from workspace config.
   * @param {Object} options - Execution options
   * @returns {Array} Default tools array
   */
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

  /**
   * Resolve default context from workspace config.
   * @param {Object} options - Execution options
   * @returns {Object} Default context object
   */
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

  /**
   * Resolve default model from workspace config.
   * @param {Object} options - Execution options
   * @returns {string} Default model identifier
   */
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
