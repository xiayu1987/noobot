/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, rm, stat } from "node:fs/promises";
import { clientFilePath as path } from "../path-resolver.js";
import { WORKSPACE_ASSET_SECTIONS, WORKSPACE_SECTIONS } from "@noobot/workspace-protocol";
import { assertPreparedBackendRuntimeWorkspaces } from "./backend-runtime-workspaces.js";

const ASSET_PACKAGE_RELATIVE_DIR = "user-template/default-user";

const requiredBackendRuntimeFiles = [
  "service/app.js",
  "node_modules/noobot-agent/src/prompts/base.md",
  "node_modules/noobot-agent/src/prompts/base.zh-CN.md",
  "node_modules/noobot-agent/src/prompts/base.en-US.md",
  "node_modules/express/package.json",
  "plugin/noobot-plugin-harness/manifest.json",
  "plugin/noobot-plugin-workflow/manifest.json",
  "plugin/noobot-plugin-character/manifest.json",
  "service/config/global.config.example.json",
  ...WORKSPACE_ASSET_SECTIONS.flatMap((section) =>
    WORKSPACE_SECTIONS[section].paths.map(
      (assetPath) => `${ASSET_PACKAGE_RELATIVE_DIR}/${assetPath}`,
    ),
  ),
];

async function assertRequiredBackendRuntimeFiles(rootDir, label) {
  await assertPreparedBackendRuntimeWorkspaces({ backendRoot: rootDir, label });
  const results = await Promise.allSettled(
    requiredBackendRuntimeFiles.map((relativePath) => stat(path.join(rootDir, relativePath))),
  );
  const missing = requiredBackendRuntimeFiles.filter(
    (_, index) => results[index].status === "rejected",
  );
  if (missing.length === 0) return;
  const causes = results.filter((result) => result.status === "rejected").map((r) => r.reason);
  throw new Error(`Missing required backend runtime files after ${label}: ${missing.join(", ")}`, {
    cause: new AggregateError(causes),
  });
}

function getBackendCopyOptions(context) {
  return { recursive: true, dereference: true };
}

export default async function copyBackendAfterPack(context) {
  const projectDir = context.packager.projectDir;
  const repoRoot = path.resolve(projectDir, "../..");
  const backendSource = path.join(projectDir, "build/backend-runtime/backend");
  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(context.appOutDir, "resources");
  const backendDestination = path.join(resourcesDir, "backend");
  const frontendSource = path.join(repoRoot, "client/noobot-chat/dist");
  const frontendDestination = path.join(resourcesDir, "frontend");

  await assertRequiredBackendRuntimeFiles(backendSource, "prepare");
  await rm(backendDestination, { recursive: true, force: true });
  await cp(backendSource, backendDestination, getBackendCopyOptions(context));
  await assertRequiredBackendRuntimeFiles(backendDestination, "copy");
  console.log(`Copied backend runtime to ${backendDestination}`);

  await stat(path.join(frontendSource, "index.html"));
  await rm(frontendDestination, { recursive: true, force: true });
  await cp(frontendSource, frontendDestination, { recursive: true });
  await stat(path.join(frontendDestination, "index.html"));
  console.log(`Copied frontend runtime to ${frontendDestination}`);
}
