/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createConfigScopeService({
  readWorkspaceConfigParams,
  readUserConfigParams,
  writeWorkspaceConfigParams,
  writeUserConfigParams,
  collectConfigTemplateKeys,
  collectUserConfigTemplateKeys,
  buildConfigParamCatalog,
  translateText,
} = {}) {
  function resolveConfigParamScope(req = {}) {
    const scope = String(req.query?.scope || req.body?.scope || "user")
      .trim()
      .toLowerCase();
    return scope === "system" ? "system" : "user";
  }

  async function readScopedConfigParams({ req, createIfMissing = true } = {}) {
    const scope = resolveConfigParamScope(req);
    if (scope === "system") {
      const payload = await readWorkspaceConfigParams({ createIfMissing });
      return { scope, userId: "", payload };
    }
    const userId = String(req?.auth?.userId || "").trim();
    if (!userId) throw new Error(translateText("auth.missingUserAuth", req?.locale));
    const payload = await readUserConfigParams({ userId, createIfMissing });
    return { scope, userId, payload };
  }

  async function writeScopedConfigParams({
    req,
    values = undefined,
    descriptions = undefined,
  } = {}) {
    const { scope, userId, payload: existingPayload } = await readScopedConfigParams({
      req,
      createIfMissing: true,
    });
    const nextPayload = {
      values:
        values && typeof values === "object" ? values : existingPayload?.values || {},
      descriptions:
        descriptions && typeof descriptions === "object"
          ? descriptions
          : existingPayload?.descriptions || {},
    };
    if (scope === "system") {
      const payload = await writeWorkspaceConfigParams(nextPayload);
      return { scope, userId: "", payload };
    }
    const payload = await writeUserConfigParams({ userId, input: nextPayload });
    return { scope, userId, payload };
  }

  async function buildScopedConfigParamsResponse({ req, payload = {}, userId = "" } = {}) {
    const scope = resolveConfigParamScope(req);
    const keys =
      scope === "system"
        ? await collectConfigTemplateKeys()
        : await collectUserConfigTemplateKeys(userId);
    const catalog = buildConfigParamCatalog({
      keys,
      descriptions: payload?.descriptions || {},
      values: payload?.values || {},
    });
    return {
      ok: true,
      scope,
      userId: String(userId || "").trim(),
      values: payload.values || {},
      descriptions: payload.descriptions || {},
      keys,
      catalog,
    };
  }

  return {
    resolveConfigParamScope,
    readScopedConfigParams,
    writeScopedConfigParams,
    buildScopedConfigParamsResponse,
  };
}
