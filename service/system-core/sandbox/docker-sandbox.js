/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

function sanitizeDockerNamePart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function resolveDockerContainerScope(scriptConfig = {}) {
  const scope = String(scriptConfig?.dockerContainerScope || "")
    .trim()
    .toLowerCase();
  if (scope === "user" || scope === "per_user" || scope === "per-user") {
    return "user";
  }
  return "global";
}

function normalizeContainerMountTarget(target = "") {
  const normalized = String(target || "").trim();
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function normalizeDockerMounts(scriptConfig = {}) {
  const configuredMounts = Array.isArray(scriptConfig?.dockerMounts)
    ? scriptConfig.dockerMounts
    : [];
  const normalizedMounts = configuredMounts
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => {
      const source = String(item?.source || item?.mountSource || "").trim();
      const target = normalizeContainerMountTarget(
        item?.target || item?.mountTarget || "",
      );
      const description = String(
        item?.description || item?.mountDescription || "",
      ).trim();
      return { source, target, description };
    })
    .filter((item) => Boolean(item.source && item.target));

  if (normalizedMounts.length) return normalizedMounts;

  const legacySource = String(scriptConfig?.dockerProjectMountSource || "").trim();
  const legacyTarget = normalizeContainerMountTarget(
    scriptConfig?.dockerProjectMountTarget || "",
  );
  if (legacySource && legacyTarget) {
    return [
      {
        source: legacySource,
        target: legacyTarget,
        description: "",
      },
    ];
  }
  return [];
}

export function buildDockerCommand({
  userRoot,
  userId = "",
  command,
  scriptConfig = {},
}) {
  const scope = resolveDockerContainerScope(scriptConfig);
  const image = String(scriptConfig?.dockerImage || "node:20").trim() || "node:20";
  const baseContainerName = sanitizeDockerNamePart(
    scriptConfig?.dockerContainerName || "noobot-script-sandbox",
  );
  const userPart = sanitizeDockerNamePart(userId || path.basename(userRoot) || "user");
  const containerName =
    scope === "user" ? `${baseContainerName}-${userPart}` : baseContainerName;
  const mountSource = scope === "user" ? userRoot : path.dirname(userRoot);
  const mountTarget = "/workspace";
  const dockerMounts = normalizeDockerMounts(scriptConfig);
  const dockerExtraMountArgs = dockerMounts.map(
    (item) =>
      `-v ${JSON.stringify(item.source)}:${JSON.stringify(item.target)}`,
  );
  const workdir =
    scope === "user"
      ? "/workspace/runtime/workspace"
      : `/workspace/${userPart}/runtime/workspace`;

  const cmd = [
    `docker container inspect ${JSON.stringify(containerName)} >/dev/null 2>&1`,
    "||",
    `docker create --name ${JSON.stringify(containerName)} -v ${JSON.stringify(mountSource)}:${JSON.stringify(mountTarget)} ${dockerExtraMountArgs.join(" ")} ${JSON.stringify(image)} sleep infinity >/dev/null`,
    "&&",
    `docker start ${JSON.stringify(containerName)} >/dev/null`,
    "&&",
    `docker exec -w ${JSON.stringify(workdir)} ${JSON.stringify(containerName)} bash -lc ${JSON.stringify(command)}`,
  ].join(" ");

  return {
    cmd,
    containerName,
    scope,
    image,
    mountSource,
    mountTarget,
    dockerMounts,
    workdir,
  };
}
