/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, rm, stat } from "node:fs/promises";
import { clientFilePath as path } from "../path-resolver.js";
import { assertPreparedBackendRuntimeWorkspaces } from "./backend-runtime-workspaces.js";

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
  "user-template/default-user/config.example.json",
];

async function assertRequiredBackendRuntimeFiles(rootDir, label) {
  await assertPreparedBackendRuntimeWorkspaces({ backendRoot: rootDir, label });
  await Promise.all(
    requiredBackendRuntimeFiles.map(async (relativePath) => {
      try {
        await stat(path.join(rootDir, relativePath));
      } catch (error) {
        throw new Error(`Missing required backend runtime file after ${label}: ${relativePath}`, {
          cause: error,
        });
      }
    }),
  );
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
