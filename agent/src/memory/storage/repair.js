/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { repairMemoryWorkspace } from "@noobot/memory-repair";
import { MEMORY_RELATIVE_PATHS } from "./paths.js";
import { ensureDir, fileExists, listTextFilesRecursive, readText, writeText } from "./file-ops.js";

const MEMORY_REPAIR_BACKUP_DIR = WORKSPACE_LAYOUT.MEMORY_REPAIR_BACKUPS_DIR;

function createRepairIo(base, backupBase) {
  const resolve = (relativePath) => path.join(base, relativePath);
  return {
    exists: (relativePath) => fileExists(resolve(relativePath)),
    readText: (relativePath) => readText(resolve(relativePath), ""),
    async writeText(relativePath, content) {
      await ensureDir(path.dirname(resolve(relativePath)));
      await writeText(resolve(relativePath), content);
    },
    async writeBackup(relativePath, content) {
      const target = path.join(backupBase, relativePath);
      await ensureDir(path.dirname(target));
      await writeText(target, content);
    },
    async listMarkdownFiles(relativeDir) {
      const files = await listTextFilesRecursive(resolve(relativeDir), ".md");
      return files.map((filePath) => path.relative(base, filePath));
    },
  };
}

export async function repairWorkspaceMemoryDocuments({ base, now = new Date() }) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupBase = path.join(base, MEMORY_REPAIR_BACKUP_DIR, stamp);
  return repairMemoryWorkspace({
    io: createRepairIo(base, backupBase),
    layout: {
      shortMemory: MEMORY_RELATIVE_PATHS.SHORT_MEMORY,
      longMemory: MEMORY_RELATIVE_PATHS.LONG_MEMORY,
      longMemoryModel: MEMORY_RELATIVE_PATHS.LONG_MEMORY_MODEL,
      experienceModel: MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL,
      experienceFields: MEMORY_RELATIVE_PATHS.EXPERIENCE_FIELDS,
      experienceMetadata: MEMORY_RELATIVE_PATHS.EXPERIENCE_METADATA,
      dailySummaryDir: MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR,
      weeklySummaryDir: MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR,
      monthlySummaryDir: MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR,
      yearlySummaryDir: MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR,
    },
  });
}
