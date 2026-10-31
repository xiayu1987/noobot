/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { runAtomicSessionRepair } from "@noobot/session-repair";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session/session-artifact-files.js";
import {
  authorityOutboxJournalPath,
  readAuthorityOutboxRecords,
} from "../session/authority-outbox-store/outbox-journal.js";
import {
  assertIncrementalJournalRecords,
  journalPath,
  messageHash,
  readJournalRecords,
  summarySnapshotContentHash,
} from "../session/session-artifact-session/turn-journal-store.js";
import { backupRewrittenFiles } from "./session-rewrite-backup.js";

function createSessionRewriteReader(upgradeError) {
  async function readJson(filePath) {
    let text;
    try {
      text = await readFile(filePath, "utf8");
    } catch (cause) {
      throw upgradeError("artifact_unreadable", { filePath }, cause);
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw upgradeError("artifact_not_json", { filePath }, cause);
    }
  }

  function readVerifiedCheckpoint(payload, index, previousCheckpointHash, filePath) {
    if (
      !isPlainObject(payload) ||
      payload.schemaVersion !== SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION ||
      !Array.isArray(payload.records) ||
      Object.hasOwn(payload, "messages") ||
      payload.previousCheckpointHash !== previousCheckpointHash ||
      payload.checkpointId !== index.checkpointId ||
      payload.checkpointRevision !== index.checkpointRevision ||
      summarySnapshotContentHash(payload) !== index.contentHash
    ) {
      throw upgradeError("snapshot_chain_mismatch", { filePath });
    }
    return payload;
  }

  async function readVerifiedJournal(sessionDir, turn) {
    const filePath = journalPath(sessionDir, turn.turnId);
    try {
      const records = await readJournalRecords(filePath, turn.committedBytes);
      assertIncrementalJournalRecords(records, filePath);
      return { filePath, records };
    } catch (cause) {
      throw upgradeError("journal_invalid", { filePath }, cause);
    }
  }

  async function readSessionMessages(sessionDir, manifest) {
    const messages = [];
    const collect = (records) => {
      for (const record of records) if (record.op === "upsert") messages.push(record.message);
    };
    for (const turn of manifest.turnOrder) {
      let previous = "";
      for (const index of turn.summarySnapshots) {
        const filePath = path.join(sessionDir, index.file);
        collect(
          readVerifiedCheckpoint(await readJson(filePath), index, previous, filePath).records,
        );
        previous = index.contentHash;
      }
      if (turn.committedBytes) collect((await readVerifiedJournal(sessionDir, turn)).records);
    }
    return messages;
  }

  return { readJson, readVerifiedCheckpoint, readVerifiedJournal, readSessionMessages };
}

async function planOutboxToolResults({
  sessionDir,
  manifest,
  writes,
  migrateOutboxToolResult,
  shared,
  loadSessionMessages,
}) {
  if (migrateOutboxToolResult === null) return 0;
  const records = await readAuthorityOutboxRecords(sessionDir);
  let migratedRecords = 0;
  const next = await Promise.all(
    records.map(async (record) => {
      const payload = record.envelope?.payload;
      if (payload?.eventType !== MESSAGE_EVENT_TYPE.TOOL_CALL_END) return record;
      const { identity } = record.envelope;
      const result = await migrateOutboxToolResult(payload, {
        manifest,
        identity,
        shared,
        loadSessionMessages,
        details: { eventId: identity.eventId },
      });
      if (result === null) return record;
      migratedRecords += 1;
      return { ...record, envelope: { ...record.envelope, payload: { ...payload, result } } };
    }),
  );
  if (migratedRecords) {
    writes.set(
      authorityOutboxJournalPath(sessionDir),
      next.map((record) => `${JSON.stringify(record)}\n`).join(""),
    );
  }
  return migratedRecords;
}

function createSessionRewritePlanner({ upgradeError, migrateMessage, migrateOutboxToolResult }) {
  const { readJson, readVerifiedCheckpoint, readVerifiedJournal, readSessionMessages } =
    createSessionRewriteReader(upgradeError);
  async function migrateRecords(records, context, hashes) {
    let migratedMessages = 0;
    const next = [];
    for (const record of records) {
      if (record.op !== "upsert") {
        next.push(record);
        continue;
      }
      if (record.hash !== messageHash(record.message)) {
        throw upgradeError("record_hash_mismatch", {
          ...context.details,
          messageUid: record.messageUid,
        });
      }
      const message = await migrateMessage(record.message, context);
      if (message === record.message) {
        next.push(record);
        continue;
      }
      const hash = messageHash(message);
      hashes.set(record.hash, hash);
      migratedMessages += 1;
      next.push({ ...record, message, hash });
    }
    return { records: next, migratedMessages };
  }

  async function planCheckpoints({ sessionDir, turn, context, hashes, writes }) {
    let previousOld = "";
    let previousNew = "";
    let migratedMessages = 0;
    const summarySnapshots = [];
    for (const index of turn.summarySnapshots) {
      const filePath = path.join(sessionDir, index.file);
      const payload = readVerifiedCheckpoint(
        await readJson(filePath),
        index,
        previousOld,
        filePath,
      );
      const migrated = await migrateRecords(payload.records, context, hashes);
      const nextPayload = {
        ...payload,
        previousCheckpointHash: previousNew,
        records: migrated.records,
      };
      const contentHash = summarySnapshotContentHash(nextPayload);
      if (contentHash !== index.contentHash) writes.set(filePath, jsonText(nextPayload));
      migratedMessages += migrated.migratedMessages;
      previousOld = index.contentHash;
      previousNew = contentHash;
      summarySnapshots.push(contentHash === index.contentHash ? index : { ...index, contentHash });
    }
    return { summarySnapshots, migratedMessages };
  }

  async function planJournal({ sessionDir, turn, context, hashes, writes }) {
    if (!turn.committedBytes) return { committedBytes: turn.committedBytes, migratedMessages: 0 };
    const { filePath, records } = await readVerifiedJournal(sessionDir, turn);
    const migrated = await migrateRecords(records, context, hashes);
    if (!migrated.migratedMessages)
      return { committedBytes: turn.committedBytes, migratedMessages: 0 };
    const content = migrated.records.map((record) => `${JSON.stringify(record)}\n`).join("");
    writes.set(filePath, content);
    return {
      committedBytes: Buffer.byteLength(content, "utf8"),
      migratedMessages: migrated.migratedMessages,
    };
  }

  async function planSession(sessionDir) {
    const manifestPath = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.session);
    const manifest = await readJson(manifestPath);
    if (manifest?.schemaVersion !== SESSION_ARTIFACT_SCHEMA_VERSION) {
      throw upgradeError("manifest_schema_unsupported", { filePath: manifestPath });
    }
    const shared = {};
    let sessionMessages = null;
    const loadSessionMessages = async () =>
      (sessionMessages ??= await readSessionMessages(sessionDir, manifest));
    const writes = new Map();
    let migratedMessages = 0;
    const turnOrder = [];
    for (const turn of manifest.turnOrder) {
      const hashes = new Map();
      const context = {
        sessionDir,
        manifest,
        shared,
        loadSessionMessages,
        details: { turnId: turn.turnId },
      };
      const checkpoints = await planCheckpoints({ sessionDir, turn, context, hashes, writes });
      const journal = await planJournal({ sessionDir, turn, context, hashes, writes });
      migratedMessages += checkpoints.migratedMessages + journal.migratedMessages;
      turnOrder.push(
        hashes.size
          ? {
              ...turn,
              committedBytes: journal.committedBytes,
              messageHashes: syncMessageHashes(turn.messageHashes, hashes),
              summarySnapshots: checkpoints.summarySnapshots,
            }
          : turn,
      );
    }
    if (migratedMessages) writes.set(manifestPath, jsonText({ ...manifest, turnOrder }));
    const migratedRecords = await planOutboxToolResults({
      sessionDir,
      manifest,
      writes,
      migrateOutboxToolResult,
      shared,
      loadSessionMessages,
    });
    return { writes, migratedMessages, migratedRecords };
  }

  return planSession;
}

export function createSessionMessageRewriter({
  upgradeError,
  migrateMessage,
  migrateOutboxToolResult = null,
}) {
  const planSession = createSessionRewritePlanner({
    upgradeError,
    migrateMessage,
    migrateOutboxToolResult,
  });
  async function upgradeSessionDirectory({ base, backupBase, sessionDir }) {
    if (!(await planSession(sessionDir)).writes.size) return null;
    let report = null;
    await runAtomicSessionRepair({
      sessionDir,
      repair: async (stagingDir) => {
        const plan = await planSession(stagingDir);
        for (const [filePath, content] of plan.writes) {
          await writeFileAtomic({ filePath, content, writeFile, rename, remove: rm });
        }
        report = {
          migratedMessages: plan.migratedMessages,
          ...(plan.migratedRecords ? { migratedRecords: plan.migratedRecords } : {}),
        };
      },
      validate: async (stagingDir) => {
        if ((await planSession(stagingDir)).writes.size) {
          throw upgradeError("upgrade_not_canonical", {});
        }
        report.files = await backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir });
      },
    });
    return { sessionDir: path.relative(base, sessionDir), ...report };
  }

  return { upgradeSessionDirectory };
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function syncMessageHashes(messageHashes, hashes) {
  return Object.fromEntries(
    Object.entries(messageHashes).map(([uid, hash]) => [uid, hashes.get(hash) ?? hash]),
  );
}
