/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHookRuntimeIdentity } from "@noobot/hook-protocol/runtime-identity";
import { filePath as path, resolveRuntimePathContext } from "@noobot/path-resolver";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { isConfiguredSuperUser } from "../../shared/utils/super-user.js";
import { resolveConfiguredPathPolicy } from "../../config/core/path-policy-adapter.js";
import { isCanonicalText, text } from "@noobot/shared/value";

export function resolveRuntimeBasePath({ userId, globalConfig }) {
  if (!text(userId) || !text(globalConfig.workspaceRoot)) {
    throw new TypeError("resolveRuntimeBasePath requires userId and globalConfig.workspaceRoot");
  }
  return path.resolve(globalConfig.workspaceRoot, userId);
}

export function resolveContextIdentityInfo({ userId, globalConfig }) {
  if (!isCanonicalText(userId)) {
    throw new TypeError("resolveContextIdentityInfo requires canonical userId");
  }
  return {
    userId,
    isSuperUser: isConfiguredSuperUser({ globalConfig, userId }),
  };
}

export function buildStaticInfo({ runtimeBasePath, identity, globalConfig }) {
  const pathContext = resolveRuntimePathContext({
    hostRootDirectory: runtimeBasePath,
    userId: identity.userId,
    globalConfig,
    executionPolicy: resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig }),
    isSuperUser: identity.isSuperUser,
    pathPolicy: resolveConfiguredPathPolicy(globalConfig),
  });
  const { directories } = pathContext;
  return {
    cwd: directories.currentDirectory,
    userId: identity.userId,
    basePath: directories.rootDirectory,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    globalDefaults: {
      workspaceRoot: pathContext.sandbox ? pathContext.sandbox.root : globalConfig.workspaceRoot,
    },
    directories,
    identity,
  };
}

export function buildDynamicInfo({ identity, runConfig, now }) {
  const runtimeIdentity = createHookRuntimeIdentity(identity);
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? { ...runConfig.toolPolicy }
      : null;
  const selectedConnectorIds = normalizeSelectedConnectorIds(runConfig?.selectedConnectorIds);
  const config = {
    allowUserInteraction: runConfig.allowUserInteraction,
    safeConfirm: runConfig.safeConfirm,
    sanitizeOutput: runConfig.sanitizeOutput,
    safeConfirmLevel: runConfig.safeConfirmLevel,
    streaming: runConfig.streaming,
    ...(toolPolicy ? { toolPolicy } : {}),
    selectedConnectorIds,
  };
  return {
    ...runtimeIdentity,
    now,
    config,
  };
}
