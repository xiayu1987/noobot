/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_STORAGE_QUARANTINE_STATUS } from "@noobot/workspace-protocol/migration-quarantine";
import { inspectSessionDirectory, ignoreSessionProgress } from "./session-directory-walk.js";
import { assertWorkspaceQuarantineEmpty, quarantineMigrationUnit } from "./migration-quarantine.js";
import { withSessionStorageAuthorityLock } from "../session/session-storage-authority.js";

async function quarantineSessionStorage({ base, sessionDir, format, status, error, parentPath }) {
  return withSessionStorageAuthorityLock(sessionDir, () =>
    quarantineMigrationUnit({
      base,
      kind: "session-storage-retirement",
      relativePath: path.relative(base, sessionDir),
      move: true,
      sessionStorage: { format, status, ...(parentPath === undefined ? {} : { parentPath }) },
      error,
    }),
  );
}

export async function quarantineSessionStorageTree(options) {
  const { base, sessionDir, signal } = options;
  signal?.throwIfAborted();
  const { children } = await inspectSessionDirectory(sessionDir);
  const quarantined = [];
  async function visit(directory) {
    signal?.throwIfAborted();
    const {
      authority,
      format,
      error,
      children: descendants,
    } = await inspectSessionDirectory(directory);
    for (const child of descendants) await visit(path.join(directory, child.name));
    if (authority === null && error === null) return;
    const unsupported = authority === "immutable";
    quarantined.push(
      await quarantineSessionStorage({
        base,
        sessionDir: directory,
        format,
        status: error
          ? SESSION_STORAGE_QUARANTINE_STATUS.FAILED
          : unsupported
            ? SESSION_STORAGE_QUARANTINE_STATUS.UNSUPPORTED
            : SESSION_STORAGE_QUARANTINE_STATUS.PARENT_UNAVAILABLE,
        ...(unsupported || error ? {} : { parentPath: path.relative(base, sessionDir) }),
        error:
          error ??
          Object.assign(
            new Error(
              unsupported
                ? "Session storage format is no longer supported"
                : `Session parent is unavailable: ${sessionDir}`,
            ),
            {
              code: unsupported
                ? "SESSION_STORAGE_FORMAT_UNSUPPORTED"
                : "SESSION_PARENT_UNAVAILABLE",
            },
          ),
      }),
    );
  }
  for (const child of children) await visit(path.join(sessionDir, child.name));
  quarantined.push(await quarantineSessionStorage(options));
  return quarantined;
}

export async function retireUnsupportedSessionStorage({
  base,
  scopedSessionRoots,
  signal,
  onSessionProcessed = ignoreSessionProgress,
}) {
  await assertWorkspaceQuarantineEmpty(base);
  const quarantined = [];
  async function visit(directory, isRoot) {
    signal?.throwIfAborted();
    const { children, authority, format, error } = await inspectSessionDirectory(directory);
    if (!isRoot && (authority === "immutable" || error !== null)) {
      quarantined.push(
        ...(await quarantineSessionStorageTree({
          base,
          sessionDir: directory,
          format,
          status: error
            ? SESSION_STORAGE_QUARANTINE_STATUS.FAILED
            : SESSION_STORAGE_QUARANTINE_STATUS.UNSUPPORTED,
          signal,
          error:
            error ??
            Object.assign(new Error(`Session storage format is no longer supported: ${format}`), {
              code: "SESSION_STORAGE_FORMAT_UNSUPPORTED",
            }),
        })),
      );
      onSessionProcessed();
      return;
    }
    for (const child of children) await visit(path.join(directory, child.name), false);
  }
  for (const root of new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots])) {
    await visit(path.join(base, root), true);
  }
  return { quarantined };
}
