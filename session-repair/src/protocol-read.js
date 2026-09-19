/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveRepairArtifactPath, text } from "./repair-primitives.js";
import { readRepairJson, readRepairJournal } from "./repair-artifact-io.js";

function materializeRepairRecords(records, order, baseMessages = []) {
  const byUid = new Map(
    baseMessages.map((message) => [text(message?.messageUid), message]).filter(([uid]) => uid),
  );
  for (const record of records) {
    const uid = text(record?.messageUid);
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && record.message && typeof record.message === "object")
      byUid.set(uid, record.message);
  }
  const orderedUids = Array.isArray(order) ? order.map(text).filter(Boolean) : [];
  const ordered = orderedUids.map((uid) => byUid.get(uid)).filter(Boolean);
  const selected = new Set(orderedUids);
  return [
    ...ordered,
    ...[...byUid].filter(([uid]) => !selected.has(uid)).map(([, message]) => message),
  ];
}

async function readLegacyCheckpointMessages(sessionDir, records) {
  const indexes = records.filter((record) => record?.op === "summary_snapshot");
  if (!indexes.length) return [];
  const latest = indexes.at(-1);
  const file = resolveRepairArtifactPath(sessionDir, latest.file, "turn-snapshots", [".json"]);
  const payload = await readRepairJson(file);
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  if (
    payload?.checkpointId !== latest.checkpointId ||
    Number(payload?.checkpointRevision) !== Number(latest.checkpointRevision) ||
    contentHash !== latest.contentHash ||
    !Array.isArray(payload.messages)
  ) {
    throw Object.assign(
      new Error(`legacy cumulative checkpoint does not match its index: ${latest.file}`),
      {
        code: "SESSION_REPAIR_CHECKPOINT_MISMATCH",
      },
    );
  }
  return payload.messages;
}

export async function readSessionForProtocolRepair({ sessionDir = "", session = null } = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: "SESSION_REPAIR_SOURCE_INVALID",
    });
  }
  if (Array.isArray(session.messages)) return session;
  const messagesByTurnId = new Map();
  const messages = [];
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const relativeFile = typeof item === "string" ? item : item?.file;
    if (!relativeFile) continue;
    const artifact = resolveRepairArtifactPath(sessionDir, relativeFile, "turns", [
      ".json",
      ".jsonl",
    ]);
    let turnMessages;
    if (path.extname(artifact) === ".jsonl") {
      const records = await readRepairJournal(artifact, item?.committedBytes);
      const baseMessages = await readLegacyCheckpointMessages(sessionDir, records);
      turnMessages = materializeRepairRecords(records, item?.messageOrder, baseMessages);
    } else {
      const turn = await readRepairJson(artifact);
      if (!Array.isArray(turn?.messages)) {
        throw Object.assign(new Error(`legacy Session turn is invalid: ${relativeFile}`), {
          code: "SESSION_TURN_ARTIFACT_MISSING",
        });
      }
      turnMessages = turn.messages;
    }
    const turnId = text(item?.turnId);
    if (turnId) messagesByTurnId.set(turnId, turnMessages);
    messages.push(...turnMessages);
  }
  const order = Array.isArray(session.messageOrder) ? session.messageOrder : [];
  return {
    ...session,
    messages:
      order.length && order.some((reference) => reference?.turnId)
        ? order
            .map(
              (reference) =>
                messagesByTurnId.get(text(reference?.turnId))?.[Number(reference?.messageIndex)],
            )
            .filter(Boolean)
        : order.length
          ? order
              .map((reference) =>
                messages.find(
                  (message) => text(message?.messageUid) === text(reference?.messageUid),
                ),
              )
              .filter(Boolean)
          : messages,
  };
}
