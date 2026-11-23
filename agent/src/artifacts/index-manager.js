/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { ATTACHMENT_CATALOG_ERROR, AttachmentProtocolError } from "@noobot/attachment-protocol";
import { fsLstat, fsOpen, fsReaddir, fsRename, fsRm } from "../shared/storage/fs-adapter.js";
import {
  ensureDurableStorageDirectory,
  syncStorageDirectory,
  withStorageCleanup,
} from "../shared/storage/durable-file.js";
import { renameFileAtomic } from "../shared/storage/atomic-file-write.js";
import { SessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import {
  assertSessionsWritable,
  readSessionDeletionState,
} from "../session/session-deletion-state.js";
import { withAttachmentCatalog } from "./attachment-catalog.js";
import {
  attachmentScopeIndexPath,
  legacyAttachmentScopeIndexPath,
} from "./service/attachment-storage-layout.js";
import {
  resolvePersistedStorageRef,
  toPersistedAttachmentRecord,
} from "./service/persisted-record-adapter.js";

const attachmentMutations = new SessionMutationCoordinator();
const EMPTY_CATALOG = Object.freeze({ migrationDigest: null, records: Object.freeze([]) });
const catalogStagingFiles = (file) =>
  ["", "-wal", "-shm"].map((suffix) => `${file}.stage${suffix}`);

export function withAttachmentSessionStorage(basePath, sessionId, operation) {
  const key = hash("sha256", sessionId);
  const lock = path.join(
    basePath,
    WORKSPACE_LAYOUT.SESSION_LIFECYCLE_LOCKS_DIR,
    `.attachments-${key}.lock`,
  );
  return attachmentMutations.run(lock, operation);
}

function withAttachmentSessionsStorage(basePath, sessionIds, operation) {
  const ids = [...new Set(sessionIds)].sort();
  const lockAt = (index) =>
    index === ids.length
      ? operation()
      : withAttachmentSessionStorage(basePath, ids[index], () => lockAt(index + 1));
  return lockAt(0);
}

async function optionalFile(file) {
  try {
    const entry = await fsLstat(file);
    if (!entry.isFile())
      throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
    return file;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function currentCatalogPath(basePath, scope) {
  const legacyFile = await optionalFile(legacyAttachmentScopeIndexPath(basePath, scope));
  if (legacyFile !== null) {
    throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.UPGRADE_REQUIRED, {
      file: legacyFile,
      sessionId: scope.sessionId,
    });
  }
  return optionalFile(attachmentScopeIndexPath(basePath, scope));
}

export async function publishAttachmentCatalog(basePath, scope, initialize) {
  const file = attachmentScopeIndexPath(basePath, scope);
  const directory = path.dirname(file);
  await ensureDurableStorageDirectory(directory);
  const [staging, ...sidecars] = catalogStagingFiles(file);
  for (const candidate of [staging, ...sidecars]) await fsRm(candidate, { force: true });
  await withAttachmentCatalog(staging, { basePath, scope, writable: true, initialize }, () => {});
  await renameFileAtomic({ source: staging, filePath: file, rename: fsRename });
  await syncStorageDirectory(directory);
  return file;
}

async function initializeAttachmentScope(basePath, scope) {
  const file = attachmentScopeIndexPath(basePath, scope);
  const directory = path.dirname(file);
  const stagingFiles = new Set(
    catalogStagingFiles(file).map((candidate) => path.basename(candidate)),
  );
  await ensureDurableStorageDirectory(directory);
  const entries = await fsReaddir(directory);
  if (entries.some((entry) => !stagingFiles.has(entry)))
    throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
  return publishAttachmentCatalog(basePath, scope, EMPTY_CATALOG);
}

async function recoverAttachmentBodies(basePath, scope, catalog, directory) {
  const pending = catalog.pendingBodies();
  if (pending.length === 0) return;
  for (const { storageRef, attachmentId } of pending) {
    const file = resolvePersistedStorageRef(basePath, scope, storageRef);
    const extension = path.extname(file);
    if (
      path.dirname(file) !== directory ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attachmentId) ||
      path.basename(file, extension) !== attachmentId
    )
      throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { storageRef });
    await fsRm(file, { force: true });
  }
  await syncStorageDirectory(directory);
  catalog.clearStagedBodies();
}

async function publishAttachmentBodies(basePath, catalog, directory, entries) {
  if (entries.length === 0) return;
  const records = entries.map(({ record }) => toPersistedAttachmentRecord(basePath, record));
  catalog.stageBodies(records);
  for (const { record, contentBytes } of entries) {
    const handle = await fsOpen(record.path, "wx");
    await withStorageCleanup(
      async () => {
        await handle.writeFile(contentBytes);
        await handle.sync();
      },
      () => handle.close(),
    );
  }
  await syncStorageDirectory(directory);
  catalog.publish(records);
}

export function recoverAttachmentScope(basePath, scope) {
  return withAttachmentSessionStorage(basePath, scope.sessionId, async () => {
    const { sessions } = await readSessionDeletionState(basePath);
    if (Object.hasOwn(sessions, scope.sessionId)) return;
    const file = await currentCatalogPath(basePath, scope);
    if (file === null) return;
    await withAttachmentCatalog(file, { basePath, scope, writable: true }, (catalog) =>
      recoverAttachmentBodies(basePath, scope, catalog, path.dirname(file)),
    );
  });
}

export function withAttachmentSessionWrite(
  { basePath, userId, scope, referencedSessionIds = [], prepare },
  operation,
) {
  const sessionIds = [scope.sessionId, ...referencedSessionIds];
  return withAttachmentSessionsStorage(basePath, sessionIds, async () => {
    await assertSessionsWritable(basePath, userId, sessionIds);
    const prepared = prepare === undefined ? undefined : await prepare();
    const file =
      (await currentCatalogPath(basePath, scope)) ??
      (await initializeAttachmentScope(basePath, scope));
    const directory = path.dirname(file);
    return withAttachmentCatalog(file, { basePath, scope, writable: true }, async (catalog) => {
      await recoverAttachmentBodies(basePath, scope, catalog, directory);
      return operation(
        {
          readClient: catalog.readClient,
          replace: (record) => catalog.replace(toPersistedAttachmentRecord(basePath, record)),
          publish: (entries) => publishAttachmentBodies(basePath, catalog, directory, entries),
        },
        prepared,
      );
    });
  });
}

export async function readAttachmentRecords(basePath, scope, attachmentIds) {
  const file = await currentCatalogPath(basePath, scope);
  if (file === null) return attachmentIds.map(() => null);
  return withAttachmentCatalog(file, { basePath, scope, writable: false }, ({ read }) =>
    attachmentIds.map(read),
  );
}

export async function listAttachmentRecords(basePath, scope) {
  const file = await currentCatalogPath(basePath, scope);
  if (file === null) return [];
  return withAttachmentCatalog(file, { basePath, scope, writable: false }, ({ list }) => list());
}
