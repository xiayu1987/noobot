/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  createEventEnvelope,
  getEventFamily,
  listPendingAuthorityEvents,
  pluginArtifactKey,
  projectPluginArtifacts,
  recordAuthorityEventDeliveryAttempt,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import {
  PLUGIN_ARTIFACT_ERROR_CODE,
  PLUGIN_ARTIFACT_FAMILY,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  appendAuthorityOutboxRecords,
  authorityOutboxCommitRecord,
  authorityOutboxSequenceKey,
  mergeAuthorityOutboxSequenceFloors,
  readAuthorityOutbox,
  readAuthorityOutboxCheckpoint,
  authorityOutboxRecordsFromOutbox,
  replaceAuthorityOutboxRecords,
  withAuthorityOutboxMutation,
  writeAuthorityOutboxCheckpoint,
} from "../../authority-outbox-store/outbox-journal.js";
import { requireOutboxSessionDir, resolveOutboxSessionDir } from "./outbox-scope.js";

const text = (value) => String(value || "").trim();

async function readOutboxSessionDir(service, userId, sessionId, parentSessionId, context) {
  const resolvedParentSessionId = await service._resolveParentSessionId(
    userId,
    sessionId,
    parentSessionId,
    context,
  );
  return resolveOutboxSessionDir(service, userId, sessionId, resolvedParentSessionId, context);
}

function nextSequence(outbox = [], artifactEvents = [], domain = "", scopeId = "", floor = 0) {
  const envelopes = [
    ...normalizeAuthorityEventOutbox(outbox).map((item) => item.envelope),
    ...(Array.isArray(artifactEvents) ? artifactEvents : []),
  ];
  return (
    envelopes.reduce((maximum, envelope) => {
      const ordering = envelope?.ordering;
      if (ordering?.domain !== domain || ordering?.scopeId !== scopeId) return maximum;
      return Math.max(maximum, Number(ordering.sequence) || 0);
    }, Math.max(0, Number(floor) || 0)) + 1
  );
}

export async function commitAuthorityEvent({
  userId,
  sessionId,
  parentSessionId = "",
  family,
  schemaVersion = 1,
  identity = {},
  causality = {},
  ordering = {},
  producer = {},
  payload = {},
  persistenceContext = null,
} = {}) {
  const owner = {
    userId: text(userId),
    sessionId: text(sessionId),
  };
  const orderingDomain = text(ordering?.domain);
  const orderingScopeId = text(ordering?.scopeId);
  if (!owner.userId || !owner.sessionId || !text(family)) {
    throw new TypeError("authority event commit requires user, session and family");
  }
  if (!orderingDomain || !orderingScopeId) {
    throw new TypeError("authority event commit requires ordering domain and scope");
  }
  return this._withSessionMutation(
    owner.userId,
    owner.sessionId,
    async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        owner.userId,
        owner.sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(
        owner.userId,
        owner.sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      if (!session) return { committed: false, reason: "session_not_found" };
      const eventPayload = { ...payload };
      const descriptor = getEventFamily(family);
      const isArtifact = descriptor?.sessionArtifact === true && family === PLUGIN_ARTIFACT_FAMILY;
      const artifactKey = isArtifact ? pluginArtifactKey(payload) : "";
      const currentArtifact = isArtifact
        ? projectPluginArtifacts(session.sessionArtifactEvents || [])[artifactKey] || null
        : null;
      const currentRevision = currentArtifact ? Number(currentArtifact.revision) : 0;
      const expectedRevision = payload?.baseRevision == null ? null : Number(payload.baseRevision);
      if (isArtifact && payload?.operation === "replaced" && !currentArtifact) {
        return {
          committed: false,
          reason: "artifact_not_found",
          code: PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND,
          currentRevision: 0,
        };
      }
      if (isArtifact && payload?.operation === "replaced" && expectedRevision !== currentRevision) {
        return {
          committed: false,
          reason: "revision_conflict",
          code: PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT,
          currentRevision,
        };
      }
      if (isArtifact && payload?.operation === "created" && currentArtifact) {
        return {
          committed: false,
          reason: "artifact_exists",
          code: PLUGIN_ARTIFACT_ERROR_CODE.ALREADY_EXISTS,
          currentRevision,
        };
      }
      if (isArtifact) {
        eventPayload.revision = payload?.operation === "replaced" ? currentRevision + 1 : 1;
      }
      const actualVersion = Math.max(0, Number(session.aggregateVersion) || 0);
      const occurredAt = this.now();
      const outboxSessionDir = await requireOutboxSessionDir(
        this,
        owner.userId,
        owner.sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      const persistedOutbox = await readAuthorityOutbox(outboxSessionDir);
      const outboxCheckpoint = await readAuthorityOutboxCheckpoint(outboxSessionDir);
      const sequence = nextSequence(
        persistedOutbox,
        session.sessionArtifactEvents,
        orderingDomain,
        orderingScopeId,
        outboxCheckpoint.sequenceFloors[
          authorityOutboxSequenceKey(orderingDomain, orderingScopeId)
        ],
      );
      const envelope = createEventEnvelope({
        family,
        schemaVersion,
        identity: {
          ...identity,
          eventId: text(identity?.eventId) || `evt_${randomUUID()}`,
          sessionId: owner.sessionId,
        },
        causality,
        ordering: {
          ...ordering,
          domain: orderingDomain,
          scopeId: orderingScopeId,
          sequence,
          ...(isArtifact ? { revision: eventPayload.revision } : {}),
          aggregateVersion: actualVersion + 1,
        },
        producer,
        occurredAt,
        payload: Object.freeze({ ...eventPayload }),
      });
      const validation = validateProtocolEvent(envelope);
      if (!validation.valid) {
        throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
      }
      const isSessionArtifactEvent = validation.descriptor?.sessionArtifact === true;
      if (isSessionArtifactEvent) {
        session.sessionArtifactEvents = [...(session.sessionArtifactEvents || []), envelope];
        session.updatedAt = occurredAt;
      }
      await withAuthorityOutboxMutation(outboxSessionDir, () =>
        appendAuthorityOutboxRecords(outboxSessionDir, [
          authorityOutboxCommitRecord({
            eventId: envelope.identity.eventId,
            envelope,
            committedAt: occurredAt,
          }),
        ]),
      );
      if (!isSessionArtifactEvent) {
        return { committed: true, envelope, aggregateVersion: actualVersion };
      }
      const saved = await this.sessionRepo.save(owner.userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      return {
        committed: true,
        envelope,
        aggregateVersion: saved?.aggregateVersion ?? actualVersion + 1,
      };
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function getPendingAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  limit = 100,
} = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session", events: [] };
  const sessionDir = await readOutboxSessionDir(
    this,
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!sessionDir) return { found: false, reason: "session_not_found", events: [] };
  const outbox = await readAuthorityOutbox(sessionDir);
  return {
    found: true,
    events: listPendingAuthorityEvents(outbox, { limit }),
  };
}

/**
 * Batch attempt recording: the journal is appended once for the whole drain
 * batch instead of once per event, so delivery cost stops scaling with the
 * number of pending events.
 */
export async function recordAuthorityEventAttempts({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  eventIds = [],
} = {}) {
  const requested = (Array.isArray(eventIds) ? eventIds : []).map(text).filter(Boolean);
  if (!userId || !sessionId || !requested.length) {
    return { recorded: false, reason: "missing_identity", events: [] };
  }
  const sessionDir = await readOutboxSessionDir(
    this,
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!sessionDir) return { recorded: false, reason: "session_not_found", events: [] };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const attemptedAt = this.now();
    let outbox = await readAuthorityOutbox(sessionDir);
    const records = [];
    for (const eventId of requested) {
      const result = recordAuthorityEventDeliveryAttempt(outbox, { eventId, attemptedAt });
      if (!result.found) return { recorded: false, reason: "event_not_found", events: [] };
      outbox = result.outbox;
      records.push({ op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT, eventId, attemptedAt });
    }
    await appendAuthorityOutboxRecords(sessionDir, records);
    const attempted = new Set(requested);
    return { recorded: true, events: outbox.filter((item) => attempted.has(item.eventId)) };
  });
}

/**
 * Batch acknowledgement: already-delivered events stay idempotent (they simply
 * contribute no journal record), so a partially delivered batch can be safely
 * re-acknowledged on the next drain.
 */
export async function acknowledgeAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  consumerId = "",
  acknowledgements = [],
} = {}) {
  const requested = Array.isArray(acknowledgements) ? acknowledgements : [];
  if (!userId || !sessionId || !consumerId || !requested.length) {
    return { acknowledged: false, reason: "missing_identity", delivered: 0, deduplicated: 0 };
  }
  const sessionDir = await readOutboxSessionDir(
    this,
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!sessionDir) {
    return { acknowledged: false, reason: "session_not_found", delivered: 0, deduplicated: 0 };
  }
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const deliveredAt = this.now();
    let outbox = await readAuthorityOutbox(sessionDir);
    const records = [];
    let delivered = 0;
    let deduplicated = 0;
    for (const entry of requested) {
      const eventId = text(entry?.eventId);
      const orderingDomain = text(entry?.orderingDomain);
      const orderingScopeId = text(entry?.orderingScopeId);
      const sequence = Number(entry?.sequence);
      if (!eventId || !orderingDomain || !orderingScopeId) {
        return { acknowledged: false, reason: "missing_identity", delivered, deduplicated };
      }
      const result = acknowledgeAuthorityEventDelivery(outbox, {
        eventId,
        consumerId,
        orderingDomain,
        orderingScopeId,
        sequence,
        deliveredAt,
      });
      if (result.reason) {
        return { acknowledged: false, reason: result.reason, delivered, deduplicated };
      }
      if (!result.found) {
        return { acknowledged: false, reason: "event_not_found", delivered, deduplicated };
      }
      delivered += 1;
      if (!result.changed) {
        deduplicated += 1;
        continue;
      }
      outbox = result.outbox;
      records.push({
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
        eventId,
        consumerId,
        orderingDomain,
        orderingScopeId,
        sequence,
        deliveredAt,
      });
    }
    if (records.length) await appendAuthorityOutboxRecords(sessionDir, records);
    return { acknowledged: true, delivered, deduplicated };
  });
}

export async function compactAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  deliveredThroughSequence,
  consumerId = "",
  orderingDomain = "",
  orderingScopeId = "",
  retainDeliveredAfter = "",
} = {}) {
  if (!userId || !sessionId || !consumerId || !orderingDomain || !orderingScopeId) {
    return { compacted: false, reason: "missing_compaction_identity" };
  }
  const sessionDir = await readOutboxSessionDir(
    this,
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!sessionDir) return { compacted: false, reason: "session_not_found" };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const outbox = await readAuthorityOutbox(sessionDir);
    const result = compactAuthorityEventOutbox(outbox, {
      deliveredThroughSequence,
      consumerId,
      orderingDomain,
      orderingScopeId,
      retainDeliveredAfter,
    });
    if (result.reason || !result.compacted) return result;
    const checkpoint = await readAuthorityOutboxCheckpoint(sessionDir);
    await writeAuthorityOutboxCheckpoint(sessionDir, {
      sequenceFloors: mergeAuthorityOutboxSequenceFloors(checkpoint.sequenceFloors, outbox),
    });
    await replaceAuthorityOutboxRecords(
      sessionDir,
      authorityOutboxRecordsFromOutbox(result.outbox),
    );
    return result;
  });
}
