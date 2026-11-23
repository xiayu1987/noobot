/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { ensureRuntimeDirectories } from "../../src/workspace-lifecycle/sections.js";
import { ensureSessionTree } from "../../src/workspace-lifecycle/session-storage-upgrade.js";
import {
  completeQuarantineRestores,
  restoreQuarantinedUnits,
} from "../../src/workspace-lifecycle/migration-quarantine.js";

export async function releaseQuarantinedUnits({ base, kind }) {
  const released = [];
  await restoreQuarantinedUnits({ base, kind, released });
  await completeQuarantineRestores({ base, kind });
  return released;
}

export async function initializeUserWorkspace(workspaceRoot, userId) {
  const base = path.join(workspaceRoot, userId);
  await mkdir(base, { recursive: true });
  await ensureRuntimeDirectories(base);
  await ensureSessionTree({ base });
  return base;
}
