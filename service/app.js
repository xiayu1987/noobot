/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import path from "node:path";
import {
  resolveGlobalConfigPath,
  resolveConfiguredWorkspaceRoot,
} from "@noobot/runtime-topology-protocol/workspace-root";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol";
import { initializeRuntimeParams } from "@noobot/shared/runtime-params-node";

const serviceDir = process.cwd();
const workspaceRoot = resolveConfiguredWorkspaceRoot({
  serviceDir,
  globalConfigPath: resolveGlobalConfigPath({ serviceDir }),
});
initializeRuntimeParams(path.join(workspaceRoot, WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE));
await import("./app-runtime.js");
