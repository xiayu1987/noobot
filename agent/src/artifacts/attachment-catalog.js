/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DatabaseSync } from "node:sqlite";
import {
  ATTACHMENT_CATALOG,
  ATTACHMENT_CATALOG_ERROR,
  AttachmentProtocolError,
  requireAttachmentCatalogRecord,
} from "@noobot/attachment-protocol";
import { fromPersistedAttachmentRecord } from "./service/persisted-record-adapter.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { withStorageCleanup } from "../shared/storage/durable-file.js";

const recordFields = "attachmentId, clientAttachmentId, storageRef, json";
const insertRecord =
  "INSERT INTO records (attachmentId, clientAttachmentId, storageRef, json) VALUES (?, ?, ?, ?)";

const initializeSchema = `
  PRAGMA application_id = ${ATTACHMENT_CATALOG.applicationId};
  PRAGMA user_version = ${ATTACHMENT_CATALOG.version};
  CREATE TABLE catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sessionId TEXT NOT NULL,
    attachmentSource TEXT NOT NULL,
    migrationDigest TEXT
  ) STRICT;
  CREATE TABLE records (
    ordinal INTEGER PRIMARY KEY,
    attachmentId TEXT UNIQUE NOT NULL,
    clientAttachmentId TEXT UNIQUE,
    storageRef TEXT UNIQUE NOT NULL,
    json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE pending_bodies (
    storageRef TEXT PRIMARY KEY,
    attachmentId TEXT UNIQUE NOT NULL
  ) STRICT, WITHOUT ROWID;
`;

function invalidCatalog(file) {
  return new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { file });
}

function transaction(database, run) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError([cause, rollbackError], "Attachment catalog write failed", {
        cause,
      });
    }
    throw cause;
  }
}

function bindRecord(statement, record) {
  return statement.run(
    record.identity.attachmentId,
    record.descriptor.clientAttachmentId ?? null,
    record.storageRef.ref,
    JSON.stringify(record),
  );
}

export async function withAttachmentCatalog(file, { basePath, scope, writable, initialize }, run) {
  const database = new DatabaseSync(file, {
    readOnly: !writable,
    timeout: TIME_THRESHOLDS.fileMutation.lockTimeoutMs,
  });
  return withStorageCleanup(
    async () => {
      const { application_id: applicationId } = database.prepare("PRAGMA application_id").get();
      if (initialize !== undefined && applicationId === 0) {
        database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
        transaction(database, () => {
          database.exec(initializeSchema);
          database
            .prepare("INSERT INTO catalog VALUES (1, ?, ?, ?)")
            .run(scope.sessionId, scope.attachmentSource, initialize.migrationDigest);
          const insert = database.prepare(insertRecord);
          for (const record of initialize.records) bindRecord(insert, record);
        });
      }
      const { application_id: storedApplicationId } = database
        .prepare("PRAGMA application_id")
        .get();
      const { user_version: version } = database.prepare("PRAGMA user_version").get();
      if (
        storedApplicationId !== ATTACHMENT_CATALOG.applicationId ||
        version !== ATTACHMENT_CATALOG.version
      )
        throw invalidCatalog(file);
      const owner = database
        .prepare("SELECT sessionId, attachmentSource, migrationDigest FROM catalog WHERE id = 1")
        .get();
      if (
        !owner ||
        owner.sessionId !== scope.sessionId ||
        owner.attachmentSource !== scope.attachmentSource
      )
        throw invalidCatalog(file);
      if (writable) database.exec("PRAGMA synchronous=FULL");
      else database.exec("BEGIN");
      const decode = (row) =>
        row === undefined
          ? null
          : fromPersistedAttachmentRecord(basePath, requireAttachmentCatalogRecord(row, scope));
      const byAttachmentId = database.prepare(
        `SELECT ${recordFields} FROM records WHERE attachmentId = ?`,
      );
      const byClientId = database.prepare(
        `SELECT ${recordFields} FROM records WHERE clientAttachmentId = ?`,
      );
      const bodyOwner = database.prepare("SELECT 1 FROM records WHERE storageRef = ?");
      const result = await run({
        read: (attachmentId) => decode(byAttachmentId.get(attachmentId)),
        readClient: (clientAttachmentId) => decode(byClientId.get(clientAttachmentId)),
        list: () =>
          database
            .prepare(`SELECT ${recordFields} FROM records ORDER BY ordinal`)
            .all()
            .map(decode),
        migrationDigest: owner.migrationDigest,
        pendingBodies: () =>
          database
            .prepare("SELECT storageRef, attachmentId FROM pending_bodies")
            .all()
            .map(({ storageRef, attachmentId }) => {
              if (bodyOwner.get(storageRef)) throw invalidCatalog(file);
              return { storageRef, attachmentId };
            }),
        stageBodies(records) {
          const insert = database.prepare("INSERT INTO pending_bodies VALUES (?, ?)");
          transaction(database, () => {
            for (const { identity, storageRef } of records) {
              if (bodyOwner.get(storageRef.ref)) throw invalidCatalog(file);
              insert.run(storageRef.ref, identity.attachmentId);
            }
          });
        },
        publish(records) {
          const insert = database.prepare(insertRecord);
          const retire = database.prepare(
            "DELETE FROM pending_bodies WHERE storageRef = ? AND attachmentId = ?",
          );
          transaction(database, () => {
            for (const record of records) {
              bindRecord(insert, record);
              if (retire.run(record.storageRef.ref, record.identity.attachmentId).changes !== 1)
                throw invalidCatalog(file);
            }
          });
        },
        clearStagedBodies() {
          database.exec("DELETE FROM pending_bodies");
        },
        replace(record) {
          const { changes } = database
            .prepare(
              "UPDATE records SET json = ? WHERE attachmentId = ? AND storageRef = ? AND clientAttachmentId IS ?",
            )
            .run(
              JSON.stringify(record),
              record.identity.attachmentId,
              record.storageRef.ref,
              record.descriptor.clientAttachmentId ?? null,
            );
          if (changes !== 1) throw invalidCatalog(file);
        },
      });
      if (initialize !== undefined) {
        const { busy } = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        if (busy !== 0) throw invalidCatalog(file);
      }
      return result;
    },
    () => database.close(),
  );
}
