/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { ACTIVITY_KIND, MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  ACTIVITY_TIMELINE_FACT_FIELDS,
  isCanonicalActivityTimelineFact,
} from "@noobot/event-protocol/activity-timeline";
import {
  RUNTIME_EVENTS_DIR,
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_SCOPES,
  resolveRuntimeEventFileName,
} from "@noobot/runtime-events";
import { isPlainObject } from "@noobot/shared/value";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { createSessionMessageRewriter } from "./session-message-rewrite.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";

const UPGRADE_INVALID_CODE = "WORKSPACE_SESSION_ACTIVITY_TIMELINE_UPGRADE_INVALID";
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_ACTIVITY_TIMELINE;

const LEGACY_MAIN_MODEL_CONTENT = "main_model_content";
const LEGACY_LOG_FACT_FIELDS = Object.freeze(["event", "eventId", "log", "output", "text", "type"]);
const LEGACY_EVIDENCE_FIELDS = Object.freeze([
  "sequence",
  "sequenceScopeId",
  "sequenceDomain",
  "timestamp",
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
  "presentationMessageId",
]);
const SYSTEM_EVENT_FILE = resolveRuntimeEventFileName({
  scope: RUNTIME_EVENT_SCOPES.SESSION,
  category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
});

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session activity timeline upgrade failed: ${reason}`);
  error.code = UPGRADE_INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

function isLegacyLogFact(fact) {
  return (
    isPlainObject(fact) &&
    fact.event === LEGACY_MAIN_MODEL_CONTENT &&
    fact.type === LEGACY_MAIN_MODEL_CONTENT &&
    Object.keys(fact).every((field) => LEGACY_LOG_FACT_FIELDS.includes(field))
  );
}

function isLegacyEvidenceRecord(record) {
  return (
    record?.event === LEGACY_MAIN_MODEL_CONTENT &&
    isPlainObject(record.data) &&
    record.data.eventType === LEGACY_MAIN_MODEL_CONTENT &&
    typeof record.data.eventId === "string"
  );
}

async function readLegacyEvidence(sessionDir) {
  const filePath = path.join(sessionDir, RUNTIME_EVENTS_DIR, SYSTEM_EVENT_FILE);
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  const evidence = new Map();
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (cause) {
      throw upgradeError("legacy_evidence_not_json", { filePath, line: index + 1 }, cause);
    }
    if (!isLegacyEvidenceRecord(record)) continue;
    if (evidence.has(record.data.eventId)) {
      throw upgradeError("legacy_evidence_ambiguous", { filePath, eventId: record.data.eventId });
    }
    evidence.set(record.data.eventId, record.data);
  }
  return evidence;
}

async function migrateLegacyFact(fact, context) {
  context.shared.evidence ??= await readLegacyEvidence(context.sessionDir);
  const data = context.shared.evidence.get(fact.eventId);
  const details = { ...context.details, eventId: fact.eventId };
  if (!data) throw upgradeError("legacy_activity_evidence_missing", details);
  if (
    data.text !== fact.text ||
    data.sessionId !== context.message.sessionId ||
    data.presentationMessageId !== context.message.presentationMessageId
  ) {
    throw upgradeError("legacy_activity_evidence_mismatch", details);
  }
  const migrated = {
    eventId: fact.eventId,
    eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
    text: fact.text,
    activityKind: ACTIVITY_KIND.MAIN_MODEL_ANALYSIS,
    authority: "authoritative",
    activityId: fact.eventId,
  };
  for (const field of LEGACY_EVIDENCE_FIELDS) migrated[field] = data[field];
  return migrated;
}

function trimToFactFields(fact) {
  return Object.fromEntries(
    Object.entries(fact).filter(([field]) => ACTIVITY_TIMELINE_FACT_FIELDS.has(field)),
  );
}

async function migrateActivityFact(fact, context) {
  if (isCanonicalActivityTimelineFact(fact)) return fact;
  const migrated = isLegacyLogFact(fact)
    ? await migrateLegacyFact(fact, context)
    : trimToFactFields(fact);
  if (!isCanonicalActivityTimelineFact(migrated)) {
    throw upgradeError("activity_fact_unrecognized", {
      ...context.details,
      eventId: fact?.eventId,
    });
  }
  return migrated;
}

async function migrateMessage(message, context) {
  if (!Array.isArray(message.activityTimeline)) return message;
  const messageContext = {
    ...context,
    message,
    details: { ...context.details, messageUid: message.messageUid },
  };
  let changed = false;
  const activityTimeline = [];
  for (const fact of message.activityTimeline) {
    const migrated = await migrateActivityFact(fact, messageContext);
    changed ||= migrated !== fact;
    activityTimeline.push(migrated);
  }
  return changed ? { ...message, activityTimeline } : message;
}

const rewriter = createSessionMessageRewriter({ upgradeError, migrateMessage });

export async function upgradeSessionActivityTimeline({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session activity timeline upgrade requires scopedSessionRoots");
  }
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: QUARANTINE_KIND,
    upgrade: ({ sessionDir }) => rewriter.upgradeSessionDirectory({ base, backupBase, sessionDir }),
    quarantineCode: UPGRADE_INVALID_CODE,
    normalizeError: (error) => error,
    onSessionProcessed,
  });
}
