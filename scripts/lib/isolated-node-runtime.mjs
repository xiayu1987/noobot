/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import { ISOLATED_TMP_ENV } from "./isolated-tmp.mjs";

const WORKER_INITIALIZED_ENV = "NOOBOT_TEST_WORKSPACE_INITIALIZED";

if (process.env.NODE_TEST_CONTEXT && !process.env[WORKER_INITIALIZED_ENV]) {
  const runDirectory = process.env[ISOLATED_TMP_ENV];
  if (!runDirectory) throw new Error(`${ISOLATED_TMP_ENV} is required for isolated Node tests`);
  const workerDirectory = mkdtempSync(path.join(runDirectory, "worker-"));
  process.env[WORKSPACE_ROOT_ENV] = path.join(workerDirectory, "workspace");
  process.env[WORKER_INITIALIZED_ENV] = "1";
}

await import("../../shared/testing/runtime-params.js");
