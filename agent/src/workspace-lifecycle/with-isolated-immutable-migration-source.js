/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, opendir, truncate, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isFunction } from "@noobot/shared/value";
import {
  bindImmutableMigrationSource,
  captureImmutableMigrationSourceIdentity,
  encodeImmutableSessionHead,
  IMMUTABLE_SESSION_HEAD_FILE,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileId,
} from "@noobot/session-protocol/immutable-segment";
import { withStorageCleanup } from "../shared/storage/durable-file.js";
import { fsLstat, fsRealpath, fsRm } from "../shared/storage/fs-adapter.js";
import { withImmutableAuthorityMutation } from "../session/session-storage-authority.js";
import { ImmutableSessionStore } from "../session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSnapshot } from "../session/session-artifact-session/immutable-session-audit.js";
import { legacyActivityEvidenceFiles } from "./legacy-activity-evidence-files.js";

async function copyCommittedTail(from, to, size, end) {
  if (size < end) throw immutableStorageError("Migration source committed tail is truncated");
  await copyFile(from, to, constants.COPYFILE_EXCL);
  if (size !== end) await truncate(to, end);
}

async function copySegments(store, head, replica, signal) {
  const source = store.objects.segments.directory;
  if (!(await fsLstat(source)).isDirectory())
    throw immutableStorageError("Migration source segment path is not a directory");
  const target = path.join(replica, IMMUTABLE_SEGMENT.directory);
  await mkdir(target);
  let capturedTail = false;
  for await (const entry of await opendir(source)) {
    signal?.throwIfAborted();
    const segmentId = immutableSegmentFileId(entry.name);
    if (segmentId === null) continue;
    if (!entry.isFile()) throw immutableStorageError("Migration source segment is not a file");
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const { size } = await fsLstat(from);
    const tail = head.segmentTail;
    if (size < IMMUTABLE_SEGMENT.magic.length || size > IMMUTABLE_SEGMENT.bytes)
      throw immutableStorageError("Invalid migration source segment size");
    if (segmentId !== tail.segmentId) {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      continue;
    }
    await copyCommittedTail(from, to, size, tail.end);
    capturedTail = true;
  }
  if (!capturedTail) throw immutableStorageError("Migration source committed tail is missing");
}

async function copyLegacyActivityEvidence(sessionDir, replica, signal) {
  for await (const file of legacyActivityEvidenceFiles(sessionDir)) {
    signal?.throwIfAborted();
    const target = path.join(replica, path.relative(sessionDir, file));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target, constants.COPYFILE_EXCL);
  }
}

async function captureReplica(sessionDir, expected, replica, signal) {
  return withImmutableAuthorityMutation(sessionDir, async () => {
    signal?.throwIfAborted();
    const store = await ImmutableSessionStore.open({ sessionDir });
    const head = await store.snapshot();
    const identity = bindImmutableMigrationSource(head, expected);
    await copySegments(store, head, replica, signal);
    await copyLegacyActivityEvidence(sessionDir, replica, signal);
    signal?.throwIfAborted();
    await writeFile(
      path.join(replica, IMMUTABLE_SESSION_HEAD_FILE),
      encodeImmutableSessionHead(head, store.format),
      { flag: "wx" },
    );
    return identity;
  });
}

export async function withIsolatedImmutableMigrationSource(
  { sessionDir, scratchRoot, expectedSource, signal },
  run,
) {
  if (!isFunction(run)) throw new TypeError("Isolated migration source requires a callback");
  const expected = captureImmutableMigrationSourceIdentity(expectedSource);
  signal?.throwIfAborted();
  const [source, scratch] = await Promise.all([fsRealpath(sessionDir), fsRealpath(scratchRoot)]);
  const relative = path.relative(source, scratch);
  if (
    !relative ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  )
    throw new TypeError("Migration scratch root must be outside the source session directory");
  const directory = await mkdtemp(path.join(scratch, "immutable-migration-"));
  const replica = path.join(directory, "session");
  return withStorageCleanup(
    async () => {
      await mkdir(replica);
      const identity = await captureReplica(source, expected, replica, signal);
      const store = await ImmutableSessionStore.open({
        sessionDir: replica,
        sessionId: identity.sessionId,
      });
      const snapshot = await store.snapshot();
      bindImmutableMigrationSource(snapshot, identity);
      const audit = await auditImmutableSnapshot({ store, snapshot, signal });
      if (!audit.ok || !audit.complete)
        throw Object.assign(immutableStorageError("Isolated migration source failed graph audit"), {
          audit,
        });
      signal?.throwIfAborted();
      return run({ sessionDir: replica, identity, audit });
    },
    () => fsRm(directory, { recursive: true }),
  );
}
