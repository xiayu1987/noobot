/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { requireWorkspaceRootEnv } from "@noobot/runtime-topology-protocol/workspace-root";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import { initializeRuntimeParams } from "@noobot/shared/runtime-params-node";

initializeRuntimeParams(
  path.join(requireWorkspaceRootEnv(), WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE),
);
const { startAgentProxy } = await import("./src/server/main.js");
await startAgentProxy();
