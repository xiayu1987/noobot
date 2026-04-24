/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fatalSystemError } from "../error/index.js";

const moduleCache = new Map();

function normalizeName(value = "") {
  return String(value || "").trim();
}

function resolveBasePath({ globalConfig = {}, userId = "" }) {
  const normalizedUserId = normalizeName(userId);
  const workspaceRoot = normalizeName(globalConfig?.workspaceRoot || "");
  if (!normalizedUserId || !workspaceRoot) {
    throw fatalSystemError("workspaceRoot/userId required", {
      code: "FATAL_WORKSPACE_PATH_INVALID",
    });
  }
  return path.resolve(workspaceRoot, normalizedUserId);
}

function resolveHandlerPath({ basePath = "", handlerModuleName = "" }) {
  const name = normalizeName(handlerModuleName);
  if (!name) return "";
  return path.join(basePath, "services", `${name}.js`);
}

function resolveHandlerFromModule(mod, handlerName = "") {
  const name = normalizeName(handlerName);
  if (name && typeof mod?.[name] === "function") return mod[name];
  if (typeof mod?.default === "function") return mod.default;
  if (name && typeof mod?.default?.[name] === "function")
    return mod.default[name];
  return null;
}

async function tryLoadUserServiceModule({
  basePath = "",
  handlerModuleName = "",
}) {
  const handlerPath = resolveHandlerPath({ basePath, handlerModuleName });
  if (!handlerPath) return null;
  try {
    await access(handlerPath);
  } catch {
    return null;
  }
  const mtimeMs = Number((await stat(handlerPath)).mtimeMs || 0);
  const cached = moduleCache.get(handlerPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.mod;
  const importedModule = await import(
    `${pathToFileURL(handlerPath).href}?t=${mtimeMs}`,
  );
  moduleCache.set(handlerPath, { mtimeMs, mod: importedModule });
  return importedModule;
}

export async function invokeServiceHandler({
  globalConfig = {},
  userId = "",
  serviceName = "",
  endpointName = "",
  serviceCfg = {},
  endpointCfg = {},
  customParam = "",
  queryString = {},
  body,
}) {
  const basePath = resolveBasePath({ globalConfig, userId });
  const handlerName = normalizeName(serviceCfg?.handler || "");
  if (!handlerName) {
    throw fatalSystemError("service handler required", {
      code: "FATAL_SERVICE_HANDLER_MISSING",
      details: { serviceName, endpointName },
    });
  }

  const userModule = await tryLoadUserServiceModule({
    basePath,
    handlerModuleName: handlerName,
  });
  if (!userModule) {
    throw fatalSystemError(
      `service handler module not found: services/${handlerName}.js`,
      {
        code: "FATAL_SERVICE_HANDLER_MODULE_NOT_FOUND",
        details: { serviceName, endpointName, handlerName },
      },
    );
  }
  const userHandler = resolveHandlerFromModule(userModule, handlerName);
  if (!userHandler) {
    throw fatalSystemError(
      `service handler not found: ${serviceName}.${endpointName} -> ${handlerName}`,
      {
        code: "FATAL_SERVICE_HANDLER_NOT_FOUND",
        details: { serviceName, endpointName, handlerName },
      },
    );
  }
  return await userHandler({
    serviceName,
    endpointName,
    serviceCfg,
    endpointCfg,
    custom_param: String(customParam || "").trim(),
    queryString,
    body,
    fetch: globalThis.fetch,
  });
}
