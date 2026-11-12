/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  compactAuthorityEventOutbox,
  createEventEnvelope,
  createEventId,
  getEventFamily,
  pluginArtifactKey,
  projectPluginArtifacts,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  applyAuthorityOutboxJournalRecords,
  assertAuthorityOutboxRequest,
  advanceAuthorityOutboxCheckpoint,
  allocateAuthorityEventSequence,
  forkAuthorityOutboxProjection,
  listPendingAuthorityOutboxProjection,
} from "@noobot/event-protocol/outbox";
import {
  createPluginArtifactCommitRejection,
  decidePluginArtifactCommit,
  PLUGIN_ARTIFACT_FAMILY,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  appendAuthorityOutboxRecords,
  authorityOutboxCommitRecord,
  authorityOutboxPrepareRecord,
  readAuthorityOutbox,
  readAuthorityOutboxCheckpoint,
  readAuthorityOutboxProjection,
  compactAuthorityOutboxRecords,
  withAuthorityOutboxMutation,
  writeAuthorityOutboxCheckpoint,
} from "../../authority-outbox-store/outbox-journal.js";
import { locateOutboxSessionDir } from "./outbox-scope.js";
import { isCanonicalText, isObjectLike } from "@noobot/shared/value";
import { SESSION_NOT_FOUND_REASON, decideAggregateConcurrency } from "@noobot/session-protocol";

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
  if (!isCanonicalText(userId) || !isCanonicalText(sessionId)) {
    throw new TypeError("authority event commit requires canonical user and session");
  }
  const descriptor = getEventFamily(family);
  if (!descriptor) throw new TypeError(`authority event family not registered: ${family}`);
  if (
    !isObjectLike(ordering) ||
    !isCanonicalText(ordering.domain) ||
    !isCanonicalText(ordering.scopeId)
  ) {
    throw new TypeError("authority event commit requires canonical ordering domain and scope");
  }
  const owner = { userId, sessionId };
  const orderingDomain = ordering.domain;
  const orderingScopeId = ordering.scopeId;
  const mutation = this.sessionRepo.withSessionMutation(
    owner.userId,
    owner.sessionId,
    (scope) =>
      withAuthorityOutboxMutation(scope.sessionDir, async () => {
        const isSessionArtifactEvent = descriptor.sessionArtifact === true;
        const session = await this.sessionRepo.readSessionEventManifest(scope, owner.sessionId);
        const eventPayload = { ...payload };
        const isArtifact = descriptor.sessionArtifact === true && family === PLUGIN_ARTIFACT_FAMILY;
        if (isArtifact) {
          const artifactDecision = decidePluginArtifactRevision(session, payload);
          if (!artifactDecision.allowed)
            return createPluginArtifactCommitRejection(artifactDecision);
          eventPayload.revision = artifactDecision.revision;
        }
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
        await appendAuthorityOutboxRecords(outboxSessionDir, [
          authorityOutboxPrepareRecord({
            eventId: envelope.identity.eventId,
            envelope,
            committedAt: occurredAt,
          }),
        ]);
        if (isSessionArtifactEvent) {
          session.aggregateVersion = concurrency.nextAggregateVersion;
          session.sessionArtifactEvents = [...session.sessionArtifactEvents, envelope];
          session.updatedAt = occurredAt;
        }
        if (!isSessionArtifactEvent) {
          await appendAuthorityOutboxRecords(outboxSessionDir, [
            authorityOutboxCommitRecord({ eventId: envelope.identity.eventId }),
          ]);
          return { committed: true, envelope };
        }
        await this.sessionRepo.saveSessionArtifactEvents(owner.userId, session, {
          expectedAggregateVersion: baseAggregateVersion,
          persistenceContext,
        });
        await appendAuthorityOutboxRecords(outboxSessionDir, [
          authorityOutboxCommitRecord({ eventId: envelope.identity.eventId }),
        ]);
        return {
          committed: true,
          envelope,
          aggregateVersion: concurrency.nextAggregateVersion,
        };
      }),
    { persistenceContext },
  );
  return mutation;
}

export async function getPendingAuthorityEvents(request) {
  const { userId, sessionId, persistenceContext, consumerId } = assertAuthorityOutboxRequest(
    request,
    "pending",
  );
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { found: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  return {
    found: true,
    events: listPendingAuthorityOutboxProjection(await readAuthorityOutboxProjection(sessionDir), {
      consumerId,
    }),
  };
}

export async function recordAuthorityEventAttempts(request) {
  const {
    userId,
    sessionId,
    persistenceContext,
    consumerId,
    eventIds: requested,
  } = assertAuthorityOutboxRequest(request, "attempt");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { recorded: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const attemptedAt = this.now();
    const committed = await readAuthorityOutboxProjection(sessionDir);
    if (requested.some((eventId) => !committed.entries.has(eventId))) {
      return { recorded: false, reason: "event_not_found", events: [] };
    }
    await appendAuthorityOutboxRecords(
      sessionDir,
      requested.map((eventId) => ({
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
        eventId,
        consumerId,
        attemptedAt,
      })),
    );
    const attempted = new Set(requested);
    return {
      recorded: true,
      events: (await readAuthorityOutbox(sessionDir)).filter((item) => attempted.has(item.eventId)),
    };
  });
}

export async function acknowledgeAuthorityEvents(request) {
  const {
    userId,
    sessionId,
    persistenceContext,
    consumerId,
    acknowledgements: requested,
  } = assertAuthorityOutboxRequest(request, "ack");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) {
    return { acknowledged: false, reason: SESSION_NOT_FOUND_REASON, delivered: 0, deduplicated: 0 };
  }
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const deliveredAt = this.now();
    const working = forkAuthorityOutboxProjection(await readAuthorityOutboxProjection(sessionDir));
    const records = [];
    let delivered = 0;
    let deduplicated = 0;
    for (const { eventId, orderingDomain, orderingScopeId, sequence } of requested) {
      const before = working.entries.get(eventId);
      if (!before) {
        return { acknowledged: false, reason: "event_not_found", delivered, deduplicated };
      }
      const record = {
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
        eventId,
        consumerId,
        orderingDomain,
        orderingScopeId,
        sequence,
        deliveredAt,
      };
      applyAuthorityOutboxJournalRecords(working, [record]);
      delivered += 1;
      if (working.entries.get(eventId) === before) deduplicated += 1;
      else records.push(record);
    }
    if (records.length) await appendAuthorityOutboxRecords(sessionDir, records);
    return { acknowledged: true, delivered, deduplicated };
  });
}

export async function compactAuthorityEvents(request) {
  const { userId, sessionId, persistenceContext, retainDeliveredAfter } =
    assertAuthorityOutboxRequest(request, "compact");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { compacted: false, reason: SESSION_NOT_FOUND_REASON };
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const outbox = await readAuthorityOutbox(sessionDir);
    const result = compactAuthorityEventOutbox(outbox, { retainDeliveredAfter });
    if (!result.compacted) return result;
    const checkpoint = await readAuthorityOutboxCheckpoint(sessionDir);
    await writeAuthorityOutboxCheckpoint(
      sessionDir,
      advanceAuthorityOutboxCheckpoint(
        checkpoint,
        outbox.map((item) => item.envelope),
      ),
    );
    await compactAuthorityOutboxRecords(sessionDir, result.outbox);
    return result;
  });
}
