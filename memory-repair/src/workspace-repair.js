/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MEMORY_DOCUMENT_KIND } from "@noobot/memory-protocol/document";
import { LONG_MEMORY_MODEL, parseLongMemoryModelText } from "@noobot/memory-protocol/long-memory";
import {
  renderDefaultMemoryDocument,
  renderDefaultShortMemoryText,
} from "@noobot/memory-protocol/defaults";
import { MEMORY_REPAIR_STATUS, migrateMemoryDocument } from "./document-migration.js";

function requireIo(io) {
  for (const name of ["exists", "readText", "writeText", "writeBackup", "listMarkdownFiles"]) {
    if (typeof io?.[name] !== "function") {
      throw new TypeError(`memory workspace repair requires io.${name}`);
    }
  }
}

async function collectDocuments(layout, io) {
  const documents = [
    {
      kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL,
      relativePath: layout.longMemoryModel,
      required: true,
    },
    { kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY, relativePath: layout.longMemory, required: true },
    {
      kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL,
      relativePath: layout.experienceModel,
      required: true,
    },
    {
      kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS,
      relativePath: layout.experienceFields,
      required: true,
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

async function repairDocument(document, { io, backup, report, longMemoryModel }) {
  const entry = (status) => ({ kind: document.kind, relativePath: document.relativePath, status });
  if (!(await io.exists(document.relativePath))) {
    if (!document.required) return null;
    const text = renderDefaultMemoryDocument(document.kind);
    await io.writeText(document.relativePath, text);
    report.push(entry(MEMORY_REPAIR_STATUS.CREATED));
    return text;
  }
  const original = await io.readText(document.relativePath);
  const result = migrateMemoryDocument({ kind: document.kind, text: original, longMemoryModel });
  if (result.status === MEMORY_REPAIR_STATUS.CANONICAL) return original;
  await backup(document.relativePath, original);
  await io.writeText(document.relativePath, result.text);
  report.push(entry(result.status));
  return result.text;
}

export async function repairMemoryWorkspace({ layout, io } = {}) {
  requireIo(io);
  if (
    !layout?.shortMemory ||
    !layout?.longMemory ||
    !layout?.longMemoryModel ||
    !layout?.experienceModel ||
    !layout?.experienceFields
  ) {
    throw new TypeError("memory workspace repair requires a complete layout");
  }
  const report = [];
  const backup = (relativePath, text) => io.writeBackup(relativePath, text);
  if (!(await io.exists(layout.shortMemory))) {
    await io.writeText(layout.shortMemory, renderDefaultShortMemoryText());
    report.push({
      kind: "short_memory",
      relativePath: layout.shortMemory,
      status: MEMORY_REPAIR_STATUS.CREATED,
    });
  }
  let longMemoryModel = LONG_MEMORY_MODEL;
  for (const document of await collectDocuments(layout, io)) {
    const text = await repairDocument(document, { io, backup, report, longMemoryModel });
    if (document.kind === MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL && text !== null) {
      longMemoryModel = parseLongMemoryModelText(text);
    }
  }
  return report;
}
