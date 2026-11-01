/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readMemoryDocumentBody } from "@noobot/memory-protocol/document";
import {
  EXPERIENCE_DOCUMENT_EXTENSION,
  EXPERIENCE_PATCH_SCHEMA,
} from "@noobot/memory-protocol/experience/schema";

async function listStageDocumentPaths(storage, dirPath, depth) {
  const leaf = depth === 1;
  const out = [];
  for (const entry of await storage.safeReadDirEntries(dirPath)) {
    const entryPath = path.join(dirPath, entry.name);
    if (!leaf && entry.isDirectory()) {
      const children = await listStageDocumentPaths(storage, entryPath, depth - 1);
      out.push(...children.map((child) => ({ ...child, domainName: entry.name })));
    } else if (leaf && entry.isFile() && entry.name.endsWith(EXPERIENCE_DOCUMENT_EXTENSION)) {
      out.push({
        filePath: entryPath,
        domainName: entry.name.slice(0, -EXPERIENCE_DOCUMENT_EXTENSION.length),
      });
    }
  }
  return out;
}

export async function mergeStageDocumentsByDomain({ storage, stage, periodDir, periodKeys }) {
  const { documentKind, documentPathFields } = EXPERIENCE_PATCH_SCHEMA[stage];
  const domainTexts = new Map();
  for (const periodKey of periodKeys) {
    const documents = await listStageDocumentPaths(
      storage,
      path.join(periodDir, periodKey),
      documentPathFields.length,
    );
    for (const { filePath, domainName } of documents) {
      const content = readMemoryDocumentBody(documentKind, await storage.readText(filePath));
      if (!content) continue;
      const previous = domainTexts.get(domainName);
      domainTexts.set(domainName, previous ? `${previous}\n\n${content}` : content);
    }
  }
  return domainTexts;
}
