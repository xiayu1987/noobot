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
  const workdir =
    scope === "user"
      ? "/workspace/runtime/workspace"
      : `/workspace/${userPart}/runtime/workspace`;

  const cmd = [
    `docker container inspect ${JSON.stringify(containerName)} >/dev/null 2>&1`,
    "||",
    `docker create --name ${JSON.stringify(containerName)} -v ${JSON.stringify(mountSource)}:/workspace ${JSON.stringify(image)} sleep infinity >/dev/null`,
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
    workdir,
  };
}
