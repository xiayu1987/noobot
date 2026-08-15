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
  const resolvedWorkdir = String(workdir || "").trim() || layout.userRoot;
  const encodedCommand = Buffer.from(String(command || ""), "utf8").toString("base64");
  const executionToken = randomUUID();
  const mountArgs = [
    "--mount",
    `type=bind,source=${workspaceSource},target=${workspaceTarget}`,
    ...mounts.flatMap((item) => [
      "--mount",
      `type=bind,source=${item.source},target=${item.target}${item.readOnly ? ",readonly" : ""}`,
    ]),
  ];
  const createArgs = [
    "create",
    "--init",
    "--name",
    containerName,
    ...mountArgs,
    image,
    "sleep",
    "infinity",
  ];
  const execArgs = [
    "exec",
    "-e",
    `NOOBOT_SCRIPT_B64=${encodedCommand}`,
    "-e",
    `NOOBOT_EXECUTION_TOKEN=${executionToken}`,
    "-w",
    resolvedWorkdir,
    containerName,
    "sh",
    "-c",
    'printf "%s" "$NOOBOT_SCRIPT_B64" | base64 -d | bash',
  ];

  return {
    executable: "docker",
    createArgs,
    inspectArgs: ["container", "inspect", containerName],
    inspectMountsArgs: ["inspect", "--format", "{{json .Mounts}}", containerName],
    removeArgs: ["rm", "-f", containerName],
    startArgs: ["start", containerName],
    execArgs,
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
