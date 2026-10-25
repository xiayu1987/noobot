/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { assertTurnJournalBoundary, splitTurnSnapshotIndexes } from "@noobot/session-repair";
import {
  SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION,
  resolveSessionArtifactSchemaVersion,
} from "@noobot/session-protocol";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { RUNTIME_EVENTS_DIR } from "@noobot/runtime-events";
import {
  TRANSFER_DOCUMENT_FORMAT,
  upgradeTransferEnvelopesInDocumentText,
  upgradeTransferEnvelopesInValue,
} from "@noobot/semantic-transfer-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
} from "../session/session-artifact-files.js";
import {
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_TURNS_DIR,
  readExecutionTurnIndex,
} from "../session/session-artifact-execution-logs.js";
import { AUTHORITY_OUTBOX_DIR } from "../session/authority-outbox-store/outbox-journal.js";
import {
  SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  journalPath,
  messageHash,
} from "../session/session-artifact-session/turn-journal-store.js";
import { createSessionDisplaySourceRevision } from "../session/session-display-source-revision.js";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { ignoreSessionProgress, walkSessionManifestDirectories } from "./session-directory-walk.js";

const UPGRADE_INVALID_CODE = "WORKSPACE_SESSION_TRANSFER_ENVELOPE_UPGRADE_INVALID";
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TRANSFER_ENVELOPE;

function upgradeError(code, details) {
  const error = new Error(`workspace session transfer envelope upgrade failed: ${code}`);
  error.code = UPGRADE_INVALID_CODE;
  error.details = { reason: code, ...details };
  return error;
}

function snapshotIndexFile(sessionDir, index) {
  if (typeof index?.file !== "string" || !index.file) {
    throw upgradeError("snapshot_index_file_missing", {
      sessionDir,
      checkpointId: index?.checkpointId,
    });
  }
  return path.join(sessionDir, index.file);
}

function contentHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeText(filePath, content) {
  return writeFileAtomic({ filePath, content, writeFile, rename, remove: rm });
}

async function readTextOrNull(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

async function listEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

function parseJson(text, filePath) {
  try {
    return JSON.parse(text);
  } catch {
    throw upgradeError("invalid_json", { filePath });
  }
}

function createWritePlan() {
  const writes = new Map();
  const stage = (filePath, content) => {
    if (writes.has(filePath)) throw upgradeError("duplicate_staged_write", { filePath });
    writes.set(filePath, content);
  };
  return { writes, stage };
}

async function commitWritePlan({ base, backupBase, writes }) {
  const files = [];
  try {
    for (const [filePath, content] of writes) {
      const target = path.join(backupBase, path.relative(base, filePath));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(filePath, target);
      files.push({ path: path.relative(base, filePath), backupPath: target });
      await writeText(filePath, content);
    }
  } catch (error) {
    for (const file of files) await copyFile(file.backupPath, path.join(base, file.path));
    throw error;
  }
  return files;
}

function upgradeValue(value, filePath) {
  try {
    return upgradeTransferEnvelopesInValue(value);
  } catch (error) {
    throw Object.assign(upgradeError("envelope_rejected", { filePath }), { cause: error });
  }
}

function upgradeJournalRecord(record, filePath, hashMap) {
  if (record?.op !== "upsert") return { record, upgraded: 0 };
  if (record.hash !== messageHash(record.message)) {
    throw upgradeError("journal_hash_mismatch", { filePath, messageUid: record.messageUid });
  }
  hashMap.seen.add(`${record.messageUid}\n${record.hash}`);
  const result = upgradeValue(record.message, filePath);
  if (!result.upgraded) return { record, upgraded: 0 };
  const hash = messageHash(result.value);
  hashMap.set(`${record.messageUid}\n${record.hash}`, hash);
  hashMap.upgradedUids.add(record.messageUid);
  return { record: { ...record, message: result.value, hash }, upgraded: result.upgraded };
}

function upgradeJournalRecords(records, filePath, hashMap) {
  let upgraded = 0;
  const next = records.map((record) => {
    const result = upgradeJournalRecord(record, filePath, hashMap);
    upgraded += result.upgraded;
    return result.record;
  });
  return { records: next, upgraded };
}

function parseJournalLines(text, filePath) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => parseJson(line, filePath));
}

async function readCommittedJournal(sessionDir, turn) {
  const filePath = journalPath(sessionDir, turn.turnId);
  let raw;
  try {
    raw = await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" && turn.committedBytes === 0) {
      return { filePath, exists: false, records: [], droppedTailBytes: 0 };
    }
    throw error;
  }
  const committedBytes = assertTurnJournalBoundary(filePath, raw.length, turn.committedBytes);
  const records = parseJournalLines(raw.subarray(0, committedBytes).toString("utf8"), filePath);
  return { filePath, exists: true, records, droppedTailBytes: raw.length - committedBytes };
}

function rewriteJournalSnapshotIndexes(records, upgradedIndexes) {
  let next = 0;
  return records.map((record) =>
    record?.op === "summary_snapshot" ? { ...record, ...upgradedIndexes[next++] } : record,
  );
}

async function upgradeTurnArtifacts({ sessionDir, turn, schemaVersion, hashMap, stage }) {
  const journal = await readCommittedJournal(sessionDir, turn);
  const { indexes } = splitTurnSnapshotIndexes(schemaVersion, turn, journal.records);
  const snapshots = await upgradeTurnSnapshots({
    sessionDir,
    indexes,
    schemaVersion,
    hashMap,
    stage,
  });
  const indexesInJournal = schemaVersion < SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION;
  const nextTurn = indexesInJournal
    ? { ...turn }
    : { ...turn, summarySnapshots: snapshots.summarySnapshots };
  if (!journal.exists) return { turn: nextTurn, upgraded: snapshots.upgraded, droppedTailBytes: 0 };
  const upserts = upgradeJournalRecords(journal.records, journal.filePath, hashMap);
  const indexesChanged =
    indexesInJournal && snapshots.summarySnapshots.some((index, i) => index !== indexes[i]);
  if (!upserts.upgraded && !indexesChanged) {
    return { turn: nextTurn, upgraded: snapshots.upgraded, droppedTailBytes: 0 };
  }
  const records = indexesInJournal
    ? rewriteJournalSnapshotIndexes(upserts.records, snapshots.summarySnapshots)
    : upserts.records;
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  stage(journal.filePath, payload);
  return {
    turn: { ...nextTurn, committedBytes: Buffer.byteLength(payload, "utf8") },
    upgraded: upserts.upgraded + snapshots.upgraded,
    droppedTailBytes: journal.droppedTailBytes,
  };
}

function upgradeLegacySnapshotMessages(messages, filePath, hashMap) {
  let upgraded = 0;
  const next = messages.map((message) => {
    const result = upgradeJournalRecord(
      { op: "upsert", messageUid: message?.messageUid, message, hash: messageHash(message) },
      filePath,
      hashMap,
    );
    upgraded += result.upgraded;
    return result.record.message;
  });
  return { messages: next, upgraded };
}

async function upgradeCumulativeMessageSnapshots({ sessionDir, indexes, hashMap, stage }) {
  const nextIndexes = [];
  let upgraded = 0;
  for (const index of indexes) {
    const filePath = snapshotIndexFile(sessionDir, index);
    const text = await readTextOrNull(filePath);
    if (text === null) throw upgradeError("snapshot_missing", { filePath });
    const payload = parseJson(text, filePath);
    if (!Array.isArray(payload?.messages) || contentHash(payload) !== index.contentHash) {
      throw upgradeError("snapshot_chain_mismatch", { filePath });
    }
    const result = upgradeLegacySnapshotMessages(payload.messages, filePath, hashMap);
    upgraded += result.upgraded;
    if (!result.upgraded) {
      nextIndexes.push(index);
      continue;
    }
    const nextPayload = { ...payload, messages: result.messages };
    stage(filePath, jsonText(nextPayload));
    nextIndexes.push({ ...index, contentHash: contentHash(nextPayload) });
  }
  return { summarySnapshots: nextIndexes, upgraded };
}

async function upgradeTurnSnapshots({ sessionDir, indexes, schemaVersion, hashMap, stage }) {
  if (schemaVersion < SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION) {
    return upgradeCumulativeMessageSnapshots({ sessionDir, indexes, hashMap, stage });
  }
  const nextIndexes = [];
  let previousOld = "";
  let previousNew = "";
  let upgraded = 0;
  for (const index of indexes) {
    const filePath = snapshotIndexFile(sessionDir, index);
    const text = await readTextOrNull(filePath);
    if (text === null) throw upgradeError("snapshot_missing", { filePath });
    const payload = parseJson(text, filePath);
    if (
      Number(payload?.schemaVersion) !== SUMMARY_SNAPSHOT_SCHEMA_VERSION ||
      !Array.isArray(payload.records) ||
      contentHash(payload) !== index.contentHash ||
      payload.previousCheckpointHash !== previousOld
    ) {
      throw upgradeError("snapshot_chain_mismatch", { filePath });
    }
    const records = upgradeJournalRecords(payload.records, filePath, hashMap);
    const nextPayload = {
      ...payload,
      previousCheckpointHash: previousNew,
      records: records.records,
    };
    const nextHash = contentHash(nextPayload);
    if (nextHash !== index.contentHash) {
      stage(filePath, jsonText(nextPayload));
    }
    upgraded += records.upgraded;
    previousOld = index.contentHash;
    previousNew = nextHash;
    nextIndexes.push(nextHash === index.contentHash ? index : { ...index, contentHash: nextHash });
  }
  return { summarySnapshots: nextIndexes, upgraded };
}

function syncMessageHashes(turn, hashMap) {
  const hashes =
    turn.messageHashes && typeof turn.messageHashes === "object" ? turn.messageHashes : {};
  return Object.fromEntries(
    Object.entries(hashes).map(([uid, hash]) => {
      const key = `${uid}\n${hash}`;
      if (hashMap.upgradedUids.has(uid) && !hashMap.seen.has(key)) {
        throw upgradeError("manifest_message_hash_mismatch", {
          turnId: turn.turnId,
          messageUid: uid,
        });
      }
      return [uid, hashMap.get(key) ?? hash];
    }),
  );
}

async function upgradeDocumentFile(filePath, format, stage) {
  const text = await readTextOrNull(filePath);
  if (text === null) return null;
  let result;
  try {
    result = upgradeTransferEnvelopesInDocumentText({ text, format });
  } catch (error) {
    throw Object.assign(upgradeError("document_rejected", { filePath }), { cause: error });
  }
  if (!result.upgraded) return { filePath, upgraded: 0, text };

  const next = text.endsWith("\n") ? result.text : result.text.replace(/\n$/, "");
  stage(filePath, next);
  return { filePath, upgraded: result.upgraded, text: next };
}

function documentFormat(name) {
  if (name.endsWith(".jsonl")) return TRANSFER_DOCUMENT_FORMAT.JSONL;
  if (name.endsWith(".json")) return TRANSFER_DOCUMENT_FORMAT.JSON;
  return null;
}

async function upgradeSummaryDetails(sessionDir, stage) {
  const dirName = SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir;
  const refs = new Map();
  for (const entry of await listEntries(path.join(sessionDir, dirName))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(sessionDir, dirName, entry.name);
    const text = await readTextOrNull(filePath);
    const result = upgradeValue(parseJson(text, filePath), filePath);
    if (!result.upgraded) continue;
    stage(filePath, jsonText(result.value));
    refs.set(`${dirName}/${entry.name}`, {
      from: contentHash(parseJson(text, filePath)),
      to: contentHash(result.value),
    });
  }
  return refs;
}

function syncThinkingDetailRef(message, detailRefs, filePath) {
  const ref = message?.thinkingDetailRef;
  const change = ref && detailRefs.get(ref.file);
  if (!change) return message;
  if (ref.contentHash !== change.from) {
    throw upgradeError("summary_detail_ref_mismatch", { filePath, file: ref.file });
  }
  return { ...message, thinkingDetailRef: { ...ref, contentHash: change.to } };
}

async function upgradeSessionSummary({
  sessionDir,
  previousManifest,
  manifest,
  detailRefs,
  stage,
}) {
  const filePath = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.sessionSummary);
  const text = await readTextOrNull(filePath);
  if (text === null) return false;
  const payload = parseJson(text, filePath);
  const result = upgradeValue(payload, filePath);
  const value = Array.isArray(result.value?.messages)
    ? {
        ...result.value,
        messages: result.value.messages.map((message) =>
          syncThinkingDetailRef(message, detailRefs, filePath),
        ),
      }
    : result.value;
  const revision = value?.source?.revision;
  const next =
    revision && revision === createSessionDisplaySourceRevision(previousManifest)
      ? {
          ...value,
          source: { ...value.source, revision: createSessionDisplaySourceRevision(manifest) },
        }
      : value;
  if (JSON.stringify(next) === JSON.stringify(payload)) return false;
  stage(filePath, jsonText(next));
  return true;
}

const PLAIN_DOCUMENT_DIRECTORIES = Object.freeze([RUNTIME_EVENTS_DIR, AUTHORITY_OUTBOX_DIR]);

async function upgradePlainDocuments(sessionDir, stage) {
  let upgraded = 0;
  for (const dirName of PLAIN_DOCUMENT_DIRECTORIES) {
    for (const entry of await listEntries(path.join(sessionDir, dirName))) {
      const format = entry.isFile() ? documentFormat(entry.name) : null;
      if (!format) continue;
      const result = await upgradeDocumentFile(
        path.join(sessionDir, dirName, entry.name),
        format,
        stage,
      );
      upgraded += result?.upgraded || 0;
    }
  }
  return upgraded;
}

function countJsonlRecords(text) {
  return text.split("\n").filter((line) => line.trim()).length;
}

async function upgradeExecutionEvents(sessionDir, stage) {
  const turnsDir = path.join(
    sessionDir,
    SESSION_ARTIFACT_FILE_NAMES.executionEventsDir,
    EXECUTION_EVENT_TURNS_DIR,
  );
  let upgraded = 0;
  for (const entry of await listEntries(turnsDir)) {
    if (!entry.isDirectory()) continue;
    const turnDir = path.join(turnsDir, entry.name);
    const indexPath = path.join(turnDir, EXECUTION_EVENT_INDEX_FILE);

    const index = await readExecutionTurnIndex(turnDir);
    if (index === null) continue;
    let changed = false;
    const segments = [];
    for (const segment of index.segments) {
      const segmentPath = path.join(turnDir, String(segment?.file || ""));
      const result = await upgradeDocumentFile(segmentPath, TRANSFER_DOCUMENT_FORMAT.JSONL, stage);
      if (result === null) throw upgradeError("execution_segment_missing", { segmentPath });
      if (!result?.upgraded) {
        segments.push(segment);
        continue;
      }
      upgraded += result.upgraded;
      changed = true;
      segments.push({
        ...segment,
        bytes: Buffer.byteLength(result.text, "utf8"),
        records: countJsonlRecords(result.text),
      });
    }
    if (changed) stage(indexPath, jsonText({ ...index, segments }));
  }
  return upgraded;
}

async function upgradeManifestTurns({ sessionDir, manifest, stage }) {
  const hashMap = Object.assign(new Map(), { seen: new Set(), upgradedUids: new Set() });
  const report = { envelopes: 0, droppedTailBytes: 0 };
  const turnOrder = [];
  const schemaVersion = resolveSessionArtifactSchemaVersion(manifest.schemaVersion);
  for (const turn of Array.isArray(manifest.turnOrder) ? manifest.turnOrder : []) {
    const result = await upgradeTurnArtifacts({ sessionDir, turn, schemaVersion, hashMap, stage });
    report.envelopes += result.upgraded;
    report.droppedTailBytes += result.droppedTailBytes;
    turnOrder.push({ ...result.turn, messageHashes: syncMessageHashes(turn, hashMap) });
  }
  return { turnOrder, changed: hashMap.size > 0, report };
}

async function upgradeSessionDirectory({ base, backupBase, sessionDir }) {
  const manifestPath = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.session);
  const manifestText = await readTextOrNull(manifestPath);
  if (manifestText === null) return null;
  const previousManifest = parseJson(manifestText, manifestPath);
  if (upgradeValue(previousManifest, manifestPath).upgraded) {
    throw upgradeError("manifest_contains_envelope", { filePath: manifestPath });
  }
  const { writes, stage } = createWritePlan();
  const turns = await upgradeManifestTurns({ sessionDir, manifest: previousManifest, stage });
  const manifest = turns.changed
    ? { ...previousManifest, turnOrder: turns.turnOrder }
    : previousManifest;
  if (turns.changed) stage(manifestPath, jsonText(manifest));
  const detailRefs = await upgradeSummaryDetails(sessionDir, stage);
  await upgradeSessionSummary({ sessionDir, previousManifest, manifest, detailRefs, stage });
  const plain = await upgradePlainDocuments(sessionDir, stage);
  const meta = await upgradeDocumentFile(
    path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.meta),
    TRANSFER_DOCUMENT_FORMAT.JSON,
    stage,
  );
  const executionEvents = await upgradeExecutionEvents(sessionDir, stage);
  if (!writes.size) return null;
  const files = await commitWritePlan({ base, backupBase, writes });
  return {
    sessionDir: path.relative(base, sessionDir),
    journalEnvelopes: turns.report.envelopes,
    droppedTailBytes: turns.report.droppedTailBytes,
    plainEnvelopes: plain,
    metaEnvelopes: meta?.upgraded || 0,
    executionEventEnvelopes: executionEvents,
    files,
  };
}

export async function upgradeSessionTransferEnvelopes({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session transfer envelope upgrade requires scopedSessionRoots");
  }
  const sessions = [];
  const quarantined = [];
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root))) {
      try {
        const result = await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () => upgradeSessionDirectory({ base, backupBase, sessionDir }),
        );
        if (result) sessions.push(result);
      } catch (error) {
        if (error?.code !== UPGRADE_INVALID_CODE) throw error;
        quarantined.push(
          await quarantineMigrationUnit({
            base,
            kind: QUARANTINE_KIND,
            relativePath: path.relative(base, sessionDir),
            error,
          }),
        );
      }
      onSessionProcessed();
    }
  }
  return { sessions, quarantined };
}
