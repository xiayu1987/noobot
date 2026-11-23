/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { filePath as path } from "@noobot/path-resolver";
import {
  ATTACHMENT_CATALOG_ERROR,
  AttachmentProtocolError,
  parsePersistedAttachmentIndex,
} from "@noobot/attachment-protocol";
import { fsLstat, fsReadFile, fsReaddir, fsRm } from "../shared/storage/fs-adapter.js";
import {
  ensureDurableStorageDirectory,
  syncStorageDirectory,
  writeDurableJsonFile,
} from "../shared/storage/durable-file.js";
import { publishAttachmentCatalog, recoverAttachmentScope } from "../artifacts/index-manager.js";
import { withAttachmentCatalog } from "../artifacts/attachment-catalog.js";
import {
  attachScopedRoot,
  attachmentScopeIndexPath,
  decodeAttachmentStorageSegment,
  legacyAttachmentScopeIndexPath,
} from "../artifacts/service/attachment-storage-layout.js";
import { fromPersistedAttachmentRecord } from "../artifacts/service/persisted-record-adapter.js";

async function listDirectories(directory) {
  try {
    const entries = await fsReaddir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readLegacyIndex(file) {
  try {
    const info = await fsLstat(file);
    if (!info.isFile())
      throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
    return await fsReadFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function verifyCatalog(basePath, scope, records, digest) {
  const file = attachmentScopeIndexPath(basePath, scope);
  const expected = new Map(
    records.map((record) => [
      record.identity.attachmentId,
      fromPersistedAttachmentRecord(basePath, record),
    ]),
  );
  await withAttachmentCatalog(file, { basePath, scope, writable: false }, (catalog) => {
    const actual = catalog.list();
    if (
      catalog.migrationDigest !== digest ||
      actual.length !== expected.size ||
      !actual.every((record) => isDeepStrictEqual(record, expected.get(record.attachmentId)))
    )
      throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
  });
  await syncStorageDirectory(path.dirname(file));
}

async function ensureCatalog(basePath, scope, raw) {
  const digest = hash("sha256", raw);
  const { attachments } = parsePersistedAttachmentIndex(JSON.parse(raw), scope);
  const records = Object.values(attachments);
  const file = attachmentScopeIndexPath(basePath, scope);
  let hasCatalog;
  try {
    const info = await fsLstat(file);
    if (!info.isFile())
      throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
    hasCatalog = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    hasCatalog = false;
  }
  if (!hasCatalog)
    await publishAttachmentCatalog(basePath, scope, { records, migrationDigest: digest });
  await verifyCatalog(basePath, scope, records, digest);
}

async function* walkAttachmentScopes(base) {
  const scopedRoot = attachScopedRoot(base);
  for (const session of await listDirectories(scopedRoot)) {
    for (const source of await listDirectories(path.join(scopedRoot, session.name))) {
      yield {
        sessionId: decodeAttachmentStorageSegment(session.name, "sessionId"),
        attachmentSource: decodeAttachmentStorageSegment(source.name, "attachmentSource"),
      };
    }
  }
}

export async function recoverWorkspaceAttachmentCatalogs(base) {
  for await (const scope of walkAttachmentScopes(base)) await recoverAttachmentScope(base, scope);
}

export async function upgradeAttachmentCatalogs({ base, backupBase, onSessionProcessed }) {
  let migrated = 0;
  for await (const scope of walkAttachmentScopes(base)) {
    const legacy = legacyAttachmentScopeIndexPath(base, scope);
    const raw = await readLegacyIndex(legacy);
    if (raw === null) continue;
    await ensureCatalog(base, scope, raw);
    const backup = path.join(backupBase, path.relative(base, legacy));
    await ensureDurableStorageDirectory(path.dirname(backup));
    await writeDurableJsonFile(backup, raw);
    await fsRm(legacy);
    await syncStorageDirectory(path.dirname(legacy));
    migrated += 1;
    onSessionProcessed();
  }
  return { migrated };
}
