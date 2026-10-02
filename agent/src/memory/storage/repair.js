/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { repairMemoryWorkspace } from "@noobot/memory-repair";
import { MEMORY_RELATIVE_PATHS } from "./paths.js";
import {
  ensureDir,
  fileExists,
  listTextFilesRecursive,
  readText,
  removeText,
  writeText,
} from "./file-ops.js";

const MEMORY_REPAIR_BACKUP_DIR = "runtime/memory-repair-backups";

const OBSOLETE_MEMORY_FILES = Object.freeze(["memory/long-memory-model.md"]);

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
    removeFile: (relativePath) => removeText(resolve(relativePath)),
    async listMarkdownFiles(relativeDir) {
      const files = await listTextFilesRecursive(resolve(relativeDir), ".md");
      return files.map((filePath) => path.relative(base, filePath));
    },
  };
}

export async function repairWorkspaceMemoryDocuments({ base, templateBase, now = new Date() }) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupBase = path.join(base, MEMORY_REPAIR_BACKUP_DIR, stamp);
  const experienceModelTemplate = await readFile(
    path.join(templateBase, MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL),
    "utf8",
  );
  return repairMemoryWorkspace({
    io: createRepairIo(base, backupBase),
    layout: {
      longMemory: MEMORY_RELATIVE_PATHS.LONG_MEMORY,
      experienceModel: MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL,
      experienceModelTemplate,
      experienceMetadata: MEMORY_RELATIVE_PATHS.EXPERIENCE_METADATA,
      dailySummaryDir: MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR,
      weeklySummaryDir: MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR,
      monthlySummaryDir: MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR,
      yearlySummaryDir: MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR,
      obsoleteFiles: OBSOLETE_MEMORY_FILES,
    },
  });
}
