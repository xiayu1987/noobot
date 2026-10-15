/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { joinClientPath } from "@noobot/client-shared/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { text } from "@noobot/shared/value";

export function e2eRunId() {
  const runId = text(process.env.NOOBOT_E2E_RUN_ID);
  if (!runId) throw new Error("NOOBOT_E2E_RUN_ID is required");
  return runId;
}

export function runOpsWorkdir() {
  return joinClientPath(WORKSPACE_LAYOUT.OPS_WORKDIR, `e2e-${e2eRunId()}`);
}

export function runOpsWorkdirPath(fileName) {
  return joinClientPath(runOpsWorkdir(), fileName);
}
