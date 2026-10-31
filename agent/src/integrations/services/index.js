/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { pathToFileURL } from "node:url";
import {
  SERVICE_FAILURE_CODE,
  resolveServiceHandler,
} from "@noobot/agent-config-protocol/service-handler";
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { resolveLocaleFromRuntime } from "noobot-i18n/shared";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

const moduleCache = new Map();

function resolveBasePath({ globalConfig, userId }) {
  const normalizedUserId = text(userId);
  const workspaceRoot = text(globalConfig.workspaceRoot);
  if (!normalizedUserId || !workspaceRoot) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
    });
  }
  return path.resolve(workspaceRoot, normalizedUserId);
}

async function statHandlerModule(handlerPath, details) {
  try {
    return await stat(handlerPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw fatalSystemError(
      `${tSystem("services.handlerModuleNotFound")}: services/${details.handlerName}.js`,
      { code: ERROR_CODE.FATAL_SERVICE_HANDLER_MODULE_NOT_FOUND, details, cause: error },
    );
  }
}

async function loadUserServiceModule({ basePath, handlerName, details }) {
  const handlerPath = path.join(basePath, "services", `${handlerName}.js`);
  const { mtimeMs } = await statHandlerModule(handlerPath, details);
  const cached = moduleCache.get(handlerPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.mod;
  const importedModule = await import(`${pathToFileURL(handlerPath).href}?t=${mtimeMs}`);
  moduleCache.set(handlerPath, { mtimeMs, mod: importedModule });
  return importedModule;
}

export async function invokeServiceHandler({
  agentContext,
  runtime,
  globalConfig,
  userId,
  serviceName,
  endpointName,
  serviceCfg,
  endpointCfg,
  customParam,
  queryString,
  body,
  abortSignal,
}) {
  const basePath = resolveBasePath({ globalConfig, userId });
  const handlerName = text(serviceCfg.handler);
  if (!handlerName) {
    throw fatalSystemError(tSystem("services.handlerRequired"), {
      code: ERROR_CODE.FATAL_SERVICE_HANDLER_MISSING,
      details: { serviceName, endpointName },
    });
  }

  const details = { serviceName, endpointName, handlerName };
  const userModule = await loadUserServiceModule({ basePath, handlerName, details });
  let userHandler;
  try {
    userHandler = resolveServiceHandler(userModule);
  } catch (error) {
    throw fatalSystemError(
      `${tSystem("services.handlerNotFound")}: ${serviceName}.${endpointName} -> ${handlerName}`,
      { code: ERROR_CODE.FATAL_SERVICE_HANDLER_NOT_FOUND, details, cause: error },
    );
  }
  return await userHandler({
    agentContext,
    runtime,
    locale: resolveLocaleFromRuntime(runtime),
    failureCode: SERVICE_FAILURE_CODE,
    serviceName,
    endpointName,
    serviceCfg,
    endpointCfg,
    custom_param: customParam,
    queryString,
    body,
    abortSignal,
  });
}
