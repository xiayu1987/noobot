/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isString } from "../../shared/utils/shared-utils.js";

export function createTemplateResolveContext({ configParams = {}, env = process.env } = {}) {
  const params = isPlainObject(configParams) ? configParams : {};
  const runtimeEnv = isPlainObject(env) ? env : {};
  const normalizeEntries = (source) =>
    Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        String(key || "")
          .trim()
          .toUpperCase(),
        value,
      ]),
    );
  return {
    params,
    runtimeEnv,
    upperCaseParamKeyMap: normalizeEntries(params),
    upperCaseEnvKeyMap: normalizeEntries(runtimeEnv),
  };
}

function resolveTemplateInString(input, context) {
  return String(input || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
    const normalizedKey = String(key || "").trim();
    const upperCaseKey = normalizedKey.toUpperCase();
    const envValue =
      context.runtimeEnv?.[normalizedKey] ??
      context.runtimeEnv?.[upperCaseKey] ??
      context.upperCaseEnvKeyMap?.[upperCaseKey];
    if (envValue !== undefined && envValue !== null && String(envValue) !== "") {
      return String(envValue);
    }
    const paramValue =
      context.params?.[normalizedKey] ??
      context.params?.[upperCaseKey] ??
      context.upperCaseParamKeyMap?.[upperCaseKey];
    return paramValue === undefined || paramValue === null ? "" : String(paramValue);
  });
}

function resolveValue(input, context) {
  if (isString(input)) return resolveTemplateInString(input, context);
  if (Array.isArray(input)) return input.map((item) => resolveValue(item, context));
  if (isPlainObject(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, resolveValue(value, context)]),
    );
  }
  return input;
}

export function resolveConfigSecrets(input, { configParams = {}, env = process.env } = {}) {
  return resolveValue(input, createTemplateResolveContext({ configParams, env }));
}

export function resolveConfigTemplates(input, variables = {}) {
  return resolveConfigSecrets(input, { configParams: variables, env: {} });
}
