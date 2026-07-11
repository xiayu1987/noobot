/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { normalizeDockerContainerScope as normalizeDockerContainerScopeEnum } from "../config/index.js";

function sanitizeDockerNamePart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}


function normalizeContainerMountTarget(target = "") {
  const normalized = String(target || "").trim();
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function normalizeDockerContainerScope(scriptConfig = {}) {
  const sourceConfig =
    scriptConfig && typeof scriptConfig === "object" && !Array.isArray(scriptConfig)
      ? scriptConfig
      : {};
  const rawScope = String(
    sourceConfig?.dockerContainerScope || sourceConfig?.scope || "global",
  ).trim();
  return normalizeDockerContainerScopeEnum(rawScope);
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
  const scope = normalizeDockerContainerScope(scriptConfig);
  const image =
    String(scriptConfig?.dockerImage || "nikolaik/python-nodejs:python3.12-nodejs26-bookworm").trim() ||
    "nikolaik/python-nodejs:python3.12-nodejs26-bookworm";
  const baseContainerName = sanitizeDockerNamePart(
    scriptConfig?.dockerContainerName || "noobot-script-sandbox",
  );
  const dockerMounts = normalizeDockerMounts(scriptConfig);
  const userPart = sanitizeDockerNamePart(userId || path.basename(userRoot) || "user");
  const containerName =
    scope === "user" ? `${baseContainerName}-${userPart}` : baseContainerName;
  const mountSource = scope === "user" ? userRoot : path.dirname(userRoot);
  const mountTarget = "/workspace";
  const dockerExtraMountArgs = dockerMounts.map(
    (item) =>
      `-v ${JSON.stringify(item.source)}:${JSON.stringify(item.target)}`,
  );
  const expectedMountPairs = [
    { source: mountSource, target: mountTarget },
    ...dockerMounts.map((item) => ({
      source: item.source,
      target: item.target,
    })),
  ];
  const mountValidationExpr = expectedMountPairs
    .map((item, index) => {
      const marker = `__NOOBOT_MOUNT_${index}__`;
      const inspectTemplate = `{{range .Mounts}}{{if and (eq .Source ${JSON.stringify(
        item.source,
      )}) (eq .Destination ${JSON.stringify(item.target)})}}${marker}{{end}}{{end}}`;
      return `docker inspect --format ${JSON.stringify(inspectTemplate)} ${JSON.stringify(containerName)} 2>/dev/null | grep -Fqx ${JSON.stringify(marker)}`;
    })
    .join(" && ");
  const workdir =
    scope === "user"
      ? "/workspace/runtime/ops_workdir"
      : `/workspace/${userPart}/runtime/ops_workdir`;
  const encodedCommand = Buffer.from(String(command || ""), "utf8").toString(
    "base64",
  );
  const containerExecCommand = `'printf "%s" "$NOOBOT_SCRIPT_B64" | base64 -d | bash'`;

  const createContainerCmdRaw = `docker create --name ${JSON.stringify(containerName)} -v ${JSON.stringify(mountSource)}:${JSON.stringify(mountTarget)} ${dockerExtraMountArgs.join(" ")} ${JSON.stringify(image)} sleep infinity`;
  const createContainerCmd =
    `(${createContainerCmdRaw} >/dev/null 2>&1 || docker container inspect ${JSON.stringify(containerName)} >/dev/null 2>&1)`;
  const ensureContainerCmd = [
    `if docker container inspect ${JSON.stringify(containerName)} >/dev/null 2>&1; then`,
    `if ! { ${mountValidationExpr}; }; then`,
    `docker rm -f ${JSON.stringify(containerName)} >/dev/null 2>&1 || true`,
    createContainerCmd,
    "fi",
    "else",
    createContainerCmd,
    "fi",
  ].join("\n");
  const cmd = [
    ensureContainerCmd,
    `docker start ${JSON.stringify(containerName)} >/dev/null`,
    `docker exec -e NOOBOT_SCRIPT_B64=${JSON.stringify(encodedCommand)} -w ${JSON.stringify(workdir)} ${JSON.stringify(containerName)} sh -c ${containerExecCommand}`,
  ].join(" &&\n");

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
