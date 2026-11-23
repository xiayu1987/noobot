/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { filePath as path } from "@noobot/path-resolver";
import { AttachmentService } from "noobot-agent/attach";
import { collectNoobotPluginScopedSessionRootDeclarations } from "@noobot/plugin-runtime";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";
import {
  requireWorkspaceRootEnv,
  resolveGlobalConfigPath,
  resolveWorkspaceRootPath,
} from "@noobot/runtime-topology-protocol/workspace-root";
import { createConfiguredSessionRuntime } from "../../../../../../service/bootstrap/create-app-dependencies.js";
import { normalizeKnownConfigKeys } from "@noobot/agent-config-protocol";

const serviceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../service",
);

export async function openSessionAuditRuntime() {
  const config = normalizeKnownConfigKeys(
    JSON.parse(await readFile(resolveGlobalConfigPath({ serviceDir }), "utf8")),
  );
  const workspaceRoot = requireWorkspaceRootEnv();
  if (
    resolveWorkspaceRootPath({ configuredRoot: config.workspaceRoot, serviceDir }) !== workspaceRoot
  )
    throw new Error("E2E workspace does not match the service configuration");
  const runtimeConfig = { ...config, workspaceRoot };
  const scopedSessionRoots = resolveScopedSessionRoots(
    await collectNoobotPluginScopedSessionRootDeclarations(),
  );
  const runtime = createConfiguredSessionRuntime(runtimeConfig, {
    now: () => new Date().toISOString(),
    attachmentService: new AttachmentService(runtimeConfig),
    scopedSessionRoots,
  });
  return { ...runtime, scopedSessionRoots };
}
