/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
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

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";

function upgradeError(code, details) {
  const error = new Error(`workspace session transfer envelope upgrade failed: ${code}`);
  error.code = "WORKSPACE_SESSION_TRANSFER_ENVELOPE_UPGRADE_INVALID";
  error.details = { reason: code, ...details };
  return error;
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
  for (const [filePath, content] of writes) {
    const target = path.join(backupBase, path.relative(base, filePath));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(filePath, target);
    await writeText(filePath, content);
    files.push({ path: path.relative(base, filePath), backupPath: target });
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

async function upgradeTurnJournal({ sessionDir, turn, hashMap, stage }) {
  const filePath = journalPath(sessionDir, turn.turnId);
  let raw;
  try {
    raw = await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" && Number(turn.committedBytes || 0) === 0) return null;
    throw error;
  }
  const committedBytes = Number(turn.committedBytes || 0);
  if (raw.length < committedBytes) {
    throw upgradeError("journal_shorter_than_committed", { filePath, committedBytes });
  }
  const records = parseJournalLines(raw.subarray(0, committedBytes).toString("utf8"), filePath);
  const result = upgradeJournalRecords(records, filePath, hashMap);
  if (!result.upgraded) return null;
  const payload = result.records.map((record) => `${JSON.stringify(record)}\n`).join("");
  stage(filePath, payload);
  return {
    filePath,
    upgraded: result.upgraded,
    committedBytes: Buffer.byteLength(payload, "utf8"),
    droppedTailBytes: raw.length - committedBytes,
  };
}

async function upgradeTurnSnapshots({ sessionDir, turn, hashMap, stage }) {
  const indexes = Array.isArray(turn.summarySnapshots) ? turn.summarySnapshots : [];
  const nextIndexes = [];
  let previousOld = "";
  let previousNew = "";
  let upgraded = 0;
  for (const index of indexes) {
    const filePath = path.join(sessionDir, String(index?.file || ""));
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
    nextIndexes.push({ ...index, contentHash: nextHash });
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
  for (const turn of Array.isArray(manifest.turnOrder) ? manifest.turnOrder : []) {
    const journal = await upgradeTurnJournal({ sessionDir, turn, hashMap, stage });
    const snapshots = await upgradeTurnSnapshots({ sessionDir, turn, hashMap, stage });
    report.envelopes += (journal?.upgraded || 0) + snapshots.upgraded;
    report.droppedTailBytes += journal?.droppedTailBytes || 0;
    turnOrder.push({
      ...turn,
      ...(journal ? { committedBytes: journal.committedBytes } : {}),
      messageHashes: syncMessageHashes(turn, hashMap),
      summarySnapshots: snapshots.summarySnapshots,
    });
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

async function* walkSessionDirectories(directory) {
  for (const entry of await listEntries(directory)) {
    if (!entry.isDirectory()) continue;
    if (SESSION_ARTIFACT_DIRECTORIES.has(entry.name)) continue;
    if (entry.name.endsWith(MUTATION_LOCK_SUFFIX)) continue;
    const child = path.join(directory, entry.name);
    if ((await readTextOrNull(path.join(child, SESSION_ARTIFACT_FILE_NAMES.session))) !== null) {
      yield child;
    }
    yield* walkSessionDirectories(child);
  }
}

export async function upgradeSessionTransferEnvelopes({ base, backupBase, scopedSessionRoots }) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session transfer envelope upgrade requires scopedSessionRoots");
  }
  const sessions = [];
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionDirectories(path.join(base, root))) {
      const result = await sessionMutationCoordinator.run(
        resolveSessionArtifactMutationLock(sessionDir),
        () => upgradeSessionDirectory({ base, backupBase, sessionDir }),
      );
      if (result) sessions.push(result);
    }
  }
  return { sessions };
}
