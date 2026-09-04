/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../utils.js";

export function createConfigBuildResult({ rawConfig = {}, persistedConfig = rawConfig, resolvedConfig = {}, metadata = {} } = {}) {
  if (!isPlainObject(rawConfig) || !isPlainObject(persistedConfig) || !isPlainObject(resolvedConfig)) {
    throw new TypeError("config build documents must be objects");
  }
  if (
    Object.prototype.hasOwnProperty.call(rawConfig, "configParams") ||
    Object.prototype.hasOwnProperty.call(persistedConfig, "configParams") ||
    Object.prototype.hasOwnProperty.call(resolvedConfig, "configParams")
  ) {
    throw new TypeError("configParams must be supplied through resolution context, not config documents");
  }
  return {
    rawConfig,
    persistedConfig,
    resolvedConfig,
    metadata: {
      ...metadata,
      migrations: [...(Array.isArray(metadata.migrations) ? metadata.migrations : [])],
      warnings: [...(Array.isArray(metadata.warnings) ? metadata.warnings : [])],
    },
  };
}
