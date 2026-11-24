/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { UNSUPPORTED_SESSION_STORAGE } from "@noobot/session-protocol/session-storage-format";
import {
  PARTITION_JOURNAL_HEAD_FILE,
  encodePartitionJournalControl,
  partitionEpochOctets,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MIGRATION_AUTHORITY,
  encodePartitionMigrationAuthority,
} from "@noobot/session-protocol/session-reader";
import {
  createJournalCase,
  journalRequest,
} from "../../agent/__tests__/helpers/partition-journal-cases.js";
import { resolveWorkspaceSessionLocation } from "../src/session-location.js";
import { persistSession, tempRoot } from "./runtime-events-test-fixtures.js";

test("runtime events follow partition publication and never fall back to a retained source", async (t) => {
  const workspaceRoot = await tempRoot();
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const location = { workspaceRoot, userId: "admin", sessionId: "partition-session" };
  const sessionDir = await persistSession(workspaceRoot, location.userId, {
    sessionId: location.sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const immutableFile = path.join(sessionDir, UNSUPPORTED_SESSION_STORAGE.head);
  const original = "retained unsupported source";
  await fs.writeFile(immutableFile, original);
  const source = {
    sessionId: location.sessionId,
    format: "noobot.immutable-session/5",
    generation: 1,
    commit: "a".repeat(64),
  };
  const { journal } = await createJournalCase(t, {}, { sessionId: location.sessionId });
  await journal.append(journalRequest(journal, 1));
  const head = journal.head;
  const resolve = () => resolveWorkspaceSessionLocation(location);
  const native = path.join(sessionDir, PARTITION_JOURNAL_HEAD_FILE);
  const corrupt = { code: "SESSION_STORAGE_CORRUPT" };
  const writeHead = (file, record) => fs.writeFile(file, encodePartitionJournalControl(record));

  await writeHead(native, head);
  await assert.rejects(resolve(), corrupt);
  await fs.rm(immutableFile);
  await fs.rm(path.join(sessionDir, UNSUPPORTED_SESSION_STORAGE.format), { force: true });
  assert.deepEqual(await resolve(), { sessionDir });
  await writeHead(native, { ...head, sessionId: "foreign" });
  await assert.rejects(resolve(), corrupt);
  await writeHead(native, head);

  const migratedDir = path.join(sessionDir, PARTITION_MIGRATION_AUTHORITY.directory);
  const migrated = path.join(migratedDir, PARTITION_JOURNAL_HEAD_FILE);
  const marker = path.join(sessionDir, PARTITION_MIGRATION_AUTHORITY.file);
  await fs.mkdir(migratedDir);
  await fs.rename(native, migrated);
  await fs.writeFile(immutableFile, original);
  await assert.rejects(resolve(), { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" });
  const target = { sessionId: head.sessionId, epoch: head.epoch, generation: head.sequence };
  await fs.writeFile(marker, encodePartitionMigrationAuthority({ source, target }));
  assert.deepEqual(await resolve(), { sessionDir });
  await writeHead(native, head);
  await assert.rejects(resolve(), corrupt);
  await fs.rm(native);
  await writeHead(migrated, { ...head, epoch: randomBytes(partitionEpochOctets).toString("hex") });
  await assert.rejects(resolve(), corrupt);
  await fs.writeFile(migrated, "malformed");
  await assert.rejects(resolve(), corrupt);
  await fs.rm(migrated);
  await assert.rejects(resolve(), corrupt);
  await fs.rm(marker);
  await fs.rm(immutableFile);
  const legacyDocument = path.join(sessionDir, "session.json");
  await assert.rejects(fs.access(legacyDocument), { code: "ENOENT" });
  await fs.writeFile(legacyDocument, JSON.stringify({ sessionId: location.sessionId }));
  await assert.rejects(resolve(), { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" });
});
