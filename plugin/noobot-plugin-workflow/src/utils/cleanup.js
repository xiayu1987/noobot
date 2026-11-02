/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_DATA_SCOPE, resolveWorkflowDataRelativePath } from "../core/constants.js";
import { isCanonicalText } from "@noobot/shared/value";

export async function cleanupWorkflowBySessionIds(basePath, sessionIds) {
  if (!isCanonicalText(basePath) || !Array.isArray(sessionIds)) {
    throw new TypeError("workflow cleanup requires basePath and sessionIds");
  }
  const targets = sessionIds.map((sessionId) =>
    path.resolve(basePath, resolveWorkflowDataRelativePath(WORKFLOW_DATA_SCOPE.SESSION, sessionId)),
  );
  for (const target of targets) {
    await fs.rm(target, { recursive: true, force: true });
  }
}
