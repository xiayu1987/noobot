/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MEMORY_DOCUMENT_KIND } from "@noobot/memory-protocol/document";
import { MEMORY_REPAIR_STATUS, migrateMemoryDocument } from "./document-migration.js";

function requireIo(io) {
  for (const name of [
    "exists",
    "readText",
    "writeText",
    "writeBackup",
    "removeFile",
    "listMarkdownFiles",
  ]) {
    if (typeof io?.[name] !== "function") {
      throw new TypeError(`memory workspace repair requires io.${name}`);
    }
  }
}

async function collectDocuments(layout, io) {
  const documents = [
    { kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY, relativePath: layout.longMemory },
    {
      kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL,
      relativePath: layout.experienceModel,
      resetText: layout.experienceModelTemplate,
    },
    { kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA, relativePath: layout.experienceMetadata },
  ];
  for (const [kind, dir] of [
    [MEMORY_DOCUMENT_KIND.DAILY_SUMMARY, layout.dailySummaryDir],
    [MEMORY_DOCUMENT_KIND.WEEKLY_SUMMARY, layout.weeklySummaryDir],
    [MEMORY_DOCUMENT_KIND.MONTHLY_SUMMARY, layout.monthlySummaryDir],
    [MEMORY_DOCUMENT_KIND.YEARLY_SUMMARY, layout.yearlySummaryDir],
  ]) {
    for (const relativePath of await io.listMarkdownFiles(dir)) {
      documents.push({ kind, relativePath });
    }
  }
  return documents;
}

export async function repairMemoryWorkspace({ layout, io } = {}) {
  requireIo(io);
  if (!layout) throw new TypeError("memory workspace repair requires layout");
  const report = [];
  const backup = (relativePath, text) => io.writeBackup(relativePath, text);
  for (const document of await collectDocuments(layout, io)) {
    if (!(await io.exists(document.relativePath))) continue;
    const original = await io.readText(document.relativePath);
    const result = migrateMemoryDocument({
      kind: document.kind,
      text: original,
      resetText: document.resetText,
    });
    if (result.status === MEMORY_REPAIR_STATUS.CANONICAL) continue;
    await backup(document.relativePath, original);
    await io.writeText(document.relativePath, result.text);
    report.push({
      kind: document.kind,
      relativePath: document.relativePath,
      status: result.status,
    });
  }
  for (const relativePath of layout.obsoleteFiles || []) {
    if (!(await io.exists(relativePath))) continue;
    await backup(relativePath, await io.readText(relativePath));
    await io.removeFile(relativePath);
    report.push({ kind: "obsolete", relativePath, status: "removed" });
  }
  return report;
}
