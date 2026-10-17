/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AgentConfigProtocolError, CONFIG_ERROR_CODE } from "../contract/errors.js";
import { isFunction, isPlainObject, text } from "@noobot/shared/value";

export function normalizeConfigValidators(validators) {
  if (!Array.isArray(validators)) throw new TypeError("config validators must be an array");
  return validators.map((entry, index) => {
    const name = text(entry?.name);
    if (!name || !isFunction(entry?.validate)) {
      throw new TypeError(`config validator at index ${index} requires { name, validate }`);
    }
    return Object.freeze({ name, validate: entry.validate });
  });
}

function normalizeValidatorResult(result, name) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") {
    throw new TypeError(`config validator ${name} must return { ok, error?, warnings? }`);
  }
  if (result.warnings !== undefined && !Array.isArray(result.warnings)) {
    throw new TypeError(`config validator ${name} warnings must be an array`);
  }
  return {
    ok: result.ok,
    error: text(result.error),
    warnings: (result.warnings || []).map((warning) => text(warning)).filter(Boolean),
  };
}

export async function validateEffectiveConfig({
  rawConfig = {},
  resolvedConfig = {},
  validators,
  context = {},
} = {}) {
  const warnings = [];
  for (const validator of normalizeConfigValidators(validators)) {
    const result = normalizeValidatorResult(
      await validator.validate({ rawConfig, resolvedConfig, context }),
      validator.name,
    );
    if (!result.ok) {
      throw new AgentConfigProtocolError(
        result.error
          ? `config validator failed: ${validator.name} (${result.error})`
          : `config validator failed: ${validator.name}`,
        { code: CONFIG_ERROR_CODE.VALIDATION_FAILED, details: { validator: validator.name } },
      );
    }
    warnings.push(...result.warnings);
  }
  return warnings;
}
