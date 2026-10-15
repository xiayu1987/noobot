/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AgentConfigProtocolError, CONFIG_ERROR_CODE } from "../contract/errors.js";
import { text } from "@noobot/shared/value";

export function normalizeConfigValidators(validators = []) {
  return (Array.isArray(validators) ? validators : []).map((entry, index) => {
    const validate = typeof entry === "function" ? entry : entry?.validate;
    if (typeof validate !== "function")
      throw new TypeError(`invalid config validator at index ${index}`);
    return Object.freeze({
      name:
        text(typeof entry === "function" ? entry.name : entry?.name) || `validator#${index + 1}`,
      validate,
    });
  });
}

export async function validateEffectiveConfig({
  rawConfig = {},
  resolvedConfig = {},
  validators = [],
  context = {},
} = {}) {
  const warnings = [];
  for (const validator of normalizeConfigValidators(validators)) {
    const result = await validator.validate({ rawConfig, resolvedConfig, context });
    const detail = result && typeof result === "object" ? text(result.error || result.message) : "";
    if (result === false || result?.ok === false) {
      throw new AgentConfigProtocolError(
        detail
          ? `config validator failed: ${validator.name} (${detail})`
          : `config validator failed: ${validator.name}`,
        { code: CONFIG_ERROR_CODE.VALIDATION_FAILED, details: { validator: validator.name } },
      );
    }
    if (typeof result === "string" && result.trim()) warnings.push(result.trim());
    if (Array.isArray(result?.warnings)) {
      warnings.push(...result.warnings.map((warning) => text(warning)).filter(Boolean));
    }
  }
  return warnings;
}
