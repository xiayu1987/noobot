/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, stat } from "node:fs/promises";
import { filePath as path } from "../utils/path-resolver.js";
import { pathToFileURL } from "node:url";
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../error/constants.js";

const moduleCache = new Map();

function normalizeName(value = "") {
  return String(value || "").trim();
}

function resolveBasePath({ globalConfig = {}, userId = "" }) {
  const normalizedUserId = normalizeName(userId);
  const workspaceRoot = normalizeName(globalConfig?.workspaceRoot || "");
  if (!normalizedUserId || !workspaceRoot) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
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
  agentContext = null,
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
    throw fatalSystemError(tSystem("services.handlerRequired"), {
      code: ERROR_CODE.FATAL_SERVICE_HANDLER_MISSING,
      details: { serviceName, endpointName },
    });
  }

  const userModule = await tryLoadUserServiceModule({
    basePath,
    handlerModuleName: handlerName,
  });
  if (!userModule) {
    throw fatalSystemError(
      `${tSystem("services.handlerModuleNotFound")}: services/${handlerName}.js`,
      {
        code: ERROR_CODE.FATAL_SERVICE_HANDLER_MODULE_NOT_FOUND,
        details: { serviceName, endpointName, handlerName },
      },
    );
  }
  const userHandler = resolveHandlerFromModule(userModule, handlerName);
  if (!userHandler) {
    throw fatalSystemError(
      `${tSystem("services.handlerNotFound")}: ${serviceName}.${endpointName} -> ${handlerName}`,
      {
        code: ERROR_CODE.FATAL_SERVICE_HANDLER_NOT_FOUND,
        details: { serviceName, endpointName, handlerName },
      },
    );
  }
  return await userHandler({
    agentContext,
    serviceName,
    endpointName,
    serviceCfg,
    endpointCfg,
    custom_param: String(customParam || "").trim(),
    queryString,
    body,
  });
}
