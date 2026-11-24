/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { classifyHistoricalMigrationQuarantine } from "@noobot/workspace-protocol/migration-quarantine";
import { SESSION_DOCUMENT_FILE } from "@noobot/session-protocol/session-reader";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { text } from "@noobot/shared/value";
import { fsLstat, fsOpen, fsRealpath, fsRm } from "../shared/storage/fs-adapter.js";
import { syncStorageDirectory, writeDurableJsonFile } from "../shared/storage/durable-file.js";
import {
  readQuarantineIdentity,
  readQuarantineInventory,
  withQuarantineMutation,
} from "./migration-quarantine.js";

async function* sessionInventory(base) {
  for await (const { file, held, relativePath, reason } of readQuarantineInventory(base)) {
    if (!reason.moved || reason.restored) continue;
    const record = classifyHistoricalMigrationQuarantine(reason);
    if (!record.sessionStorage) continue;
    const id = hash(
      "sha256",
      JSON.stringify([reason.kind, relativePath, reason.moveIdentity, reason.quarantinedAt]),
    );
    yield { file, held, relativePath, record, id };
  }
}

async function readSessionTitle(held, sessionId) {
  const file = path.join(held, SESSION_DOCUMENT_FILE);
  try {
    if (!(await fsLstat(held)).isDirectory() || !(await fsLstat(file)).isFile()) return "";
    const limit = LENGTH_THRESHOLDS.sessionStorage.journalControlBytes;
    const document = JSON.parse(await readFilePrefix(file, limit, fsOpen));
    if (document?.sessionId !== sessionId) return "";
    return (text(document.title) || text(document.autoTitle)).slice(
      0,
      LENGTH_THRESHOLDS.sessionStorage.listMessagePreviewChars,
    );
  } catch (error) {
    if (error instanceof SyntaxError || error.code === "ENOENT" || error.code === "ENOTDIR")
      return "";
    throw error;
  }
}

export function listQuarantinedSessions(base) {
  return withQuarantineMutation(base, async () => {
    const sessions = [];
    for await (const { held, relativePath, record, id } of sessionInventory(base)) {
      const sessionId = path.basename(relativePath);
      sessions.push({
        id,
        sessionId,
        title: record.deleting ? "" : await readSessionTitle(held, sessionId),
        quarantinedAt: record.quarantinedAt,
        quarantinePath: path.relative(base, held),
        status: record.sessionStorage.status,
        errorCode: record.error.code,
        deleting: record.deleting === true,
      });
    }
    return sessions.sort(
      (left, right) => Date.parse(right.quarantinedAt) - Date.parse(left.quarantinedAt),
    );
  });
}

async function verifyRetainedPath(base, held) {
  const root = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR);
  const realBase = await fsRealpath(base);
  const expectedParent = path.join(realBase, path.relative(base, path.dirname(held)));
  const parent = await fsRealpath(path.dirname(held));
  const relative = path.relative(path.join(realBase, path.relative(base, root)), parent);
  if (
    path.relative(expectedParent, parent) ||
    !relative ||
    relative.split(path.sep)[0] === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("Invalid retained quarantine directory");
}

export async function deleteQuarantinedSession(base, id) {
  const entry = await withQuarantineMutation(base, async () => {
    for await (const candidate of sessionInventory(base)) {
      if (candidate.id !== id) continue;
      const { file, held, record } = candidate;
      await verifyRetainedPath(base, held);
      const identity = await readQuarantineIdentity(held);
      if (identity !== record.moveIdentity && !(record.deleting && identity === null))
        throw Object.assign(new Error("Quarantined session data has changed"), {
          code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
        });
      if (!record.deleting)
        await writeDurableJsonFile(file, JSON.stringify({ ...record, deleting: true }));
      return candidate;
    }
    return null;
  });
  if (!entry) return false;

  await fsRm(entry.held, { recursive: true, force: true });
  const directory = path.dirname(entry.file);
  await syncStorageDirectory(directory);
  await withQuarantineMutation(base, async () => {
    await fsRm(entry.file);
    await syncStorageDirectory(directory);
  });
  return true;
}
