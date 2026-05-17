/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isString } from "../../utils/shared-utils.js";

export function createTemplateResolveContext({
  configParams = {},
  env = process.env,
} = {}) {
  const params = isPlainObject(configParams) ? configParams : {};
  const runtimeEnv = isPlainObject(env) ? env : {};
  return {
    params,
    runtimeEnv,
    lowerCaseParamKeyMap: Object.fromEntries(
      Object.entries(params).map(([paramKey, paramValue]) => [
        String(paramKey || "").trim().toLowerCase(),
        paramValue,
      ]),
    ),
    lowerCaseEnvKeyMap: Object.fromEntries(
      Object.entries(runtimeEnv).map(([envKey, envValue]) => [
        String(envKey || "").trim().toLowerCase(),
        envValue,
      ]),
    ),
  };
}

function resolveTemplateInString(
  input = "",
  {
    params = {},
    runtimeEnv = {},
    lowerCaseParamKeyMap = {},
    lowerCaseEnvKeyMap = {},
  } = {},
) {
  return String(input || "").replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key) => {
    const normalizedKey = String(key || "").trim();
    const lowerCaseKey = normalizedKey.toLowerCase();
    const upperCaseKey = normalizedKey.toUpperCase();
    const envValue =
      runtimeEnv?.[normalizedKey] ??
      runtimeEnv?.[upperCaseKey] ??
      runtimeEnv?.[lowerCaseKey] ??
      lowerCaseEnvKeyMap?.[lowerCaseKey];
    if (envValue !== undefined && envValue !== null && String(envValue) !== "") {
      return String(envValue);
    }
    const value =
      params?.[normalizedKey] ??
      params?.[upperCaseKey] ??
      params?.[lowerCaseKey] ??
      lowerCaseParamKeyMap?.[lowerCaseKey];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function resolveConfigSecretsInternal(input, context) {
  if (isString(input)) {
    return resolveTemplateInString(input, context);
  }
  if (Array.isArray(input)) {
    return input.map((item) => resolveConfigSecretsInternal(item, context));
  }
  if (isPlainObject(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        resolveConfigSecretsInternal(value, context),
      ]),
    );
  }
  return input;
}

export function resolveConfigSecrets(
  input,
  { configParams = {}, env = process.env } = {},
) {
  const context = createTemplateResolveContext({ configParams, env });
  return resolveConfigSecretsInternal(input, context);
}

export function resolveConfigTemplates(input, variables = {}) {
  return resolveConfigSecrets(input, { configParams: variables, env: {} });
}
