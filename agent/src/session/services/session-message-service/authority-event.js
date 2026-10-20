/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  createEventEnvelope,
  createEventId,
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
import { locateOutboxSessionDir } from "./outbox-scope.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";
import { SESSION_NOT_FOUND_REASON, decideAggregateConcurrency } from "@noobot/session-protocol";

function nextSequence(outbox = [], artifactEvents = [], domain = "", scopeId = "", floor = 0) {
  const envelopes = [
    ...normalizeAuthorityEventOutbox(outbox).map((item) => item.envelope),
    ...(Array.isArray(artifactEvents) ? artifactEvents : []),
  ];
  return (
    envelopes.reduce(
      (maximum, envelope) => {
        const ordering = envelope?.ordering;
        if (ordering?.domain !== domain || ordering?.scopeId !== scopeId) return maximum;
        return Math.max(maximum, Number(ordering.sequence) || 0);
      },
      Math.max(0, Number(floor) || 0),
    ) + 1
  );
}

function decidePluginArtifactRevision(session, payload) {
  const artifactKey = pluginArtifactKey(payload);
  const currentArtifact =
    projectPluginArtifacts(session.sessionArtifactEvents || [])[artifactKey] || null;
  const currentRevision = currentArtifact ? Number(currentArtifact.revision) : 0;
  const expectedRevision = payload?.baseRevision == null ? null : Number(payload.baseRevision);
  if (payload?.operation === "replaced" && !currentArtifact) {
    return {
      committed: false,
      reason: "artifact_not_found",
      code: PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND,
      currentRevision: 0,
    };
  }
  if (payload?.operation === "replaced" && expectedRevision !== currentRevision) {
    return {
      committed: false,
      reason: "revision_conflict",
      code: PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT,
      currentRevision,
    };
  }
  if (payload?.operation === "created" && currentArtifact) {
    return {
      committed: false,
      reason: "artifact_exists",
      code: PLUGIN_ARTIFACT_ERROR_CODE.ALREADY_EXISTS,
      currentRevision,
    };
  }
  return { revision: payload?.operation === "replaced" ? currentRevision + 1 : 1 };
}

export async function commitAuthorityEvent({
  userId,
  sessionId,
  family,
  schemaVersion = 1,
  identity = {},
  causality = {},
  ordering = {},
  producer = {},
  payload = {},
  persistenceContext,
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
  const mutation = this.sessionRepo.withSessionMutation(
    owner.userId,
    owner.sessionId,
    async (scope) => {
      const session = await this.sessionRepo.findById(owner.userId, owner.sessionId, {
        persistenceContext,
      });
      if (!session) return { committed: false, reason: SESSION_NOT_FOUND_REASON };
      const eventPayload = { ...payload };
      const descriptor = getEventFamily(family);
      const isArtifact = descriptor?.sessionArtifact === true && family === PLUGIN_ARTIFACT_FAMILY;
      if (isArtifact) {
        const artifactDecision = decidePluginArtifactRevision(session, payload);
        if (artifactDecision.committed === false) return artifactDecision;
        eventPayload.revision = artifactDecision.revision;
      }
      const isSessionArtifactEvent = descriptor?.sessionArtifact === true;
      const concurrency = isSessionArtifactEvent
        ? decideAggregateConcurrency({
            expectedAggregateVersion: null,
            aggregateVersion: session.aggregateVersion,
          })
        : null;
      if (concurrency && !concurrency.allowed) {
        throw new TypeError(`authority event commit rejected: ${concurrency.reason}`);
      }
      const baseAggregateVersion = session.aggregateVersion;
      const occurredAt = this.now();
      const outboxSessionDir = scope.sessionDir;
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
          eventId: createEventId(),
          sessionId: owner.sessionId,
        },
        causality,
        ordering: {
          ...ordering,
          domain: orderingDomain,
          scopeId: orderingScopeId,
          sequence,
          ...(isArtifact ? { revision: eventPayload.revision } : {}),
          ...(concurrency ? { aggregateVersion: concurrency.nextAggregateVersion } : {}),
        },
        producer,
        occurredAt,
        payload: Object.freeze({ ...eventPayload }),
      });
      const validation = validateProtocolEvent(envelope);
      if (!validation.valid) {
        throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
      }
      if (isSessionArtifactEvent) {
        session.aggregateVersion = concurrency.nextAggregateVersion;
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
        return { committed: true, envelope };
      }
      await this.sessionRepo.save(owner.userId, session, {
        expectedAggregateVersion: baseAggregateVersion,
        persistenceContext,
      });
      return {
        committed: true,
        envelope,
        aggregateVersion: concurrency.nextAggregateVersion,
      };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { committed: false });
}

export async function getPendingAuthorityEvents({
  userId,
  sessionId,
  persistenceContext,
  consumerId,
}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session", events: [] };
  if (!text(consumerId)) return { found: false, reason: "missing_consumer", events: [] };
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { found: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  const outbox = await readAuthorityOutbox(sessionDir);
  return {
    found: true,
    events: listPendingAuthorityEvents(outbox, { consumerId }),
  };
}

export async function recordAuthorityEventAttempts({
  userId,
  sessionId,
  persistenceContext,
  consumerId,
  eventIds,
}) {
  const requested = eventIds.map(text).filter(Boolean);
  const normalizedConsumerId = text(consumerId);
  if (!userId || !sessionId || !normalizedConsumerId || !requested.length) {
    return { recorded: false, reason: "missing_identity", events: [] };
  }
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { recorded: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const attemptedAt = this.now();
    let outbox = await readAuthorityOutbox(sessionDir);
    const records = [];
    for (const eventId of requested) {
      const result = recordAuthorityEventDeliveryAttempt(outbox, {
        eventId,
        consumerId: normalizedConsumerId,
        attemptedAt,
      });
      if (!result.found) return { recorded: false, reason: "event_not_found", events: [] };
      outbox = result.outbox;
      records.push({
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
        eventId,
        consumerId: normalizedConsumerId,
        attemptedAt,
      });
    }
    await appendAuthorityOutboxRecords(sessionDir, records);
    const attempted = new Set(requested);
    return { recorded: true, events: outbox.filter((item) => attempted.has(item.eventId)) };
  });
}

export async function acknowledgeAuthorityEvents({
  userId,
  sessionId,
  persistenceContext,
  consumerId,
  acknowledgements,
}) {
  const requested = acknowledgements;
  if (!userId || !sessionId || !text(consumerId) || !requested.length) {
    return { acknowledged: false, reason: "missing_identity", delivered: 0, deduplicated: 0 };
  }
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) {
    return { acknowledged: false, reason: SESSION_NOT_FOUND_REASON, delivered: 0, deduplicated: 0 };
  }
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const deliveredAt = this.now();
    let outbox = await readAuthorityOutbox(sessionDir);
    const records = [];
    let delivered = 0;
    let deduplicated = 0;
    for (const entry of requested) {
      const eventId = text(entry.eventId);
      const orderingDomain = text(entry.orderingDomain);
      const orderingScopeId = text(entry.orderingScopeId);
      const sequence = Number(entry.sequence);
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
  persistenceContext,
  retainDeliveredAfter,
}) {
  if (!userId || !sessionId) {
    return { compacted: false, reason: "missing_compaction_identity" };
  }
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { compacted: false, reason: SESSION_NOT_FOUND_REASON };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const outbox = await readAuthorityOutbox(sessionDir);
    const result = compactAuthorityEventOutbox(outbox, { retainDeliveredAfter });
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
