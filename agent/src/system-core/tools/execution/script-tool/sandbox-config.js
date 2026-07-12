/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSandboxProvider, resolveTimeMs } from "../../../config/index.js";
import {
  DOCKER_SANDBOX_DEFAULT,
  ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  SANDBOX_PROVIDER_NAME,
} from "./constants.js";

export function resolveSandboxProviderConfig(scriptConfig = {}) {
  const providerConfig =
    scriptConfig?.sandboxProvider && typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : scriptConfig?.sandbox_provider && typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null;
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return { provider: SANDBOX_PROVIDER_NAME.DOCKER, providerDetail: {} };
  }
  const provider = normalizeSandboxProvider(
    providerConfig?.default || SANDBOX_PROVIDER_NAME.DOCKER,
  );
  const detail =
    providerConfig?.[provider] &&
    typeof providerConfig?.[provider] === "object" &&
    !Array.isArray(providerConfig?.[provider])
      ? providerConfig?.[provider]
      : {};
  return { provider, providerDetail: detail };
}

export function resolveDockerScriptConfig(scriptConfig = {}, providerDetail = {}) {
  void scriptConfig;
  return {
    dockerContainerScope:
      providerDetail?.dockerContainerScope ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_SCOPE,
    dockerContainerName:
      providerDetail?.dockerContainerName ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_NAME,
    dockerImage: providerDetail?.dockerImage || DOCKER_SANDBOX_DEFAULT.DEFAULT_IMAGE,
    dockerMounts: Array.isArray(providerDetail?.dockerMounts)
      ? providerDetail.dockerMounts
      : [],
    dockerProjectMountSource: String(
      providerDetail?.dockerProjectMountSource || "",
    ).trim(),
    dockerProjectMountTarget:
      String(providerDetail?.dockerProjectMountTarget || "").trim() || "/project",
    dockerLockWaitTimeoutMs: resolveTimeMs(providerDetail, {
      key: "dockerLockWaitTimeoutMs",
      legacyKeys: ["docker_lock_wait_timeout_ms"],
      sourceTag: "tools.execute_script",
      warnLegacy: true,
      fallback: ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
      min: 100,
    }),
  };
}
