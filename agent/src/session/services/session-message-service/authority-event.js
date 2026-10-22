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
  advanceAuthorityOutboxCheckpoint,
  allocateAuthorityEventSequence,
} from "@noobot/event-protocol/outbox";
import {
  createPluginArtifactCommitRejection,
  decidePluginArtifactCommit,
  PLUGIN_ARTIFACT_FAMILY,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  appendAuthorityOutboxRecords,
  authorityOutboxCommitRecord,
  readAuthorityOutbox,
  readAuthorityOutboxCheckpoint,
  authorityOutboxRecordsFromOutbox,
  replaceAuthorityOutboxRecords,
  withAuthorityOutboxMutation,
  writeAuthorityOutboxCheckpoint,
} from "../../authority-outbox-store/outbox-journal.js";
import { locateOutboxSessionDir } from "./outbox-scope.js";
import { text } from "@noobot/shared/value";
import {
  SESSION_NOT_FOUND_REASON,
  createSessionNotFoundError,
  decideAggregateConcurrency,
} from "@noobot/session-protocol";

function decidePluginArtifactRevision(session, payload) {
  const currentArtifact =
    projectPluginArtifacts(session.sessionArtifactEvents)[pluginArtifactKey(payload)] || null;
  return decidePluginArtifactCommit(currentArtifact, payload);
}

export async function commitAuthorityEvent({
  userId,
  sessionId,
  family,
  identity,
  causality,
  ordering,
  producer,
  payload,
  persistenceContext,
}) {
  const owner = {
    userId: text(userId),
    sessionId: text(sessionId),
  };
  const descriptor = getEventFamily(family);
  if (!owner.userId || !owner.sessionId || !descriptor) {
    throw new TypeError("authority event commit requires user, session and family");
  }
  const orderingDomain = text(ordering.domain);
  const orderingScopeId = text(ordering.scopeId);
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
      if (!session) throw createSessionNotFoundError(owner);
      const eventPayload = { ...payload };
      const isArtifact = descriptor.sessionArtifact === true && family === PLUGIN_ARTIFACT_FAMILY;
      if (isArtifact) {
        const artifactDecision = decidePluginArtifactRevision(session, payload);
        if (!artifactDecision.allowed) return createPluginArtifactCommitRejection(artifactDecision);
        eventPayload.revision = artifactDecision.revision;
      }
      const isSessionArtifactEvent = descriptor.sessionArtifact === true;
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
      const sequence = allocateAuthorityEventSequence({
        checkpoint: outboxCheckpoint,
        envelopes: [
          ...persistedOutbox.map((item) => item.envelope),
          ...session.sessionArtifactEvents,
        ],
        orderingDomain,
        orderingScopeId,
      });
      const envelope = createEventEnvelope({
        family,
        schemaVersion: descriptor.schemaVersion,
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
        session.sessionArtifactEvents = [...session.sessionArtifactEvents, envelope];
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
  return mutation;
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
    await writeAuthorityOutboxCheckpoint(
      sessionDir,
      advanceAuthorityOutboxCheckpoint(
        checkpoint,
        outbox.map((item) => item.envelope),
      ),
    );
    await replaceAuthorityOutboxRecords(
      sessionDir,
      authorityOutboxRecordsFromOutbox(result.outbox),
    );
    return result;
  });
}
