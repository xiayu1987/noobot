/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  assertExecutionIsolationProtocol,
  resolveWorkspaceSandboxMountProjection,
  resolveWorkspaceSandboxLayout,
} from "@noobot/execution-isolation-protocol";
import { randomUUID } from "node:crypto";

export function buildDockerCommand({ userRoot, userId = "", command, isolation, workdir = "" }) {
  const resolvedIsolation = assertExecutionIsolationProtocol(isolation);
  const layout = resolveWorkspaceSandboxLayout({
    isolation: resolvedIsolation,
    userId: userId || path.basename(userRoot),
  });
  const { scope, image, mounts } = resolvedIsolation.sandbox;
  const containerName = layout.containerName;
  const workspaceMount = resolveWorkspaceSandboxMountProjection({
    isolation: resolvedIsolation,
    userId: userId || path.basename(userRoot),
    hostUserRoot: userRoot,
  });
  const workspaceSource = workspaceMount.source;
  const workspaceTarget = workspaceMount.target;
  const dockerExtraMountArgs = mounts.map(
    (item) =>
      `-v ${JSON.stringify(item.source)}:${JSON.stringify(item.target)}${item.readOnly ? ":ro" : ""}`,
  );
  const expectedMountPairs = [
    { source: workspaceSource, target: workspaceTarget },
    ...mounts.map((item) => ({
      source: item.source,
      target: item.target,
      readOnly: item.readOnly,
    })),
  ];
  const mountValidationExpr = expectedMountPairs
    .map((item, index) => {
      const marker = `__NOOBOT_MOUNT_${index}__`;
      const inspectTemplate = `{{range .Mounts}}{{if and (eq .Source ${JSON.stringify(item.source)}) (eq .Destination ${JSON.stringify(item.target)}) (eq .RW ${item.readOnly === true ? "false" : "true"})}}${marker}{{end}}{{end}}`;
      return `docker inspect --format ${JSON.stringify(inspectTemplate)} ${JSON.stringify(containerName)} 2>/dev/null | grep -Fqx ${JSON.stringify(marker)}`;
    })
    .join(" && ");
  const resolvedWorkdir = String(workdir || "").trim() || layout.opsWorkdir;
  const encodedCommand = Buffer.from(String(command || ""), "utf8").toString("base64");
  const executionToken = randomUUID();
  const containerExecCommand = `'printf "%s" "$NOOBOT_SCRIPT_B64" | base64 -d | bash'`;

  const createContainerCmdRaw = `docker create --init --name ${JSON.stringify(containerName)} -v ${JSON.stringify(workspaceSource)}:${JSON.stringify(workspaceTarget)} ${dockerExtraMountArgs.join(" ")} ${JSON.stringify(image)} sleep infinity`;
  const createContainerCmd = `(${createContainerCmdRaw} >/dev/null 2>&1 || docker container inspect ${JSON.stringify(containerName)} >/dev/null 2>&1)`;
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
    `docker exec -e NOOBOT_SCRIPT_B64=${JSON.stringify(encodedCommand)} -e NOOBOT_EXECUTION_TOKEN=${JSON.stringify(executionToken)} -w ${JSON.stringify(resolvedWorkdir)} ${JSON.stringify(containerName)} sh -c ${containerExecCommand}`,
  ].join(" &&\n");

  return {
    cmd,
    containerName,
    scope,
    image,
    workspaceSource,
    workspaceTarget,
    mounts,
    workdir: resolvedWorkdir,
    executionToken,
  };
}
