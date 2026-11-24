/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope, createEventId, validateProtocolEvent } from "@noobot/event-protocol";
import { decideAggregateConcurrency } from "@noobot/session-protocol";
import {
  PLUGIN_ARTIFACT_FAMILY,
  decidePluginArtifactCommit,
  createPluginArtifactCommitRejection,
} from "@noobot/event-protocol/plugin-artifact-event";
import { prepareOutboxChanges } from "./authority-outbox.js";

export async function planAuthorityEventCommit(service, reader, request, descriptor) {
  const { sessionId, family, identity, causality, ordering, producer, payload } = request;
  const eventPayload = { ...payload };
  const isArtifact = descriptor.sessionArtifact === true && family === PLUGIN_ARTIFACT_FAMILY;
  if (isArtifact) {
    const decision = decidePluginArtifactCommit(await reader.readPluginArtifact(payload), payload);
    if (!decision.allowed) return () => createPluginArtifactCommitRejection(decision);
    eventPayload.revision = decision.revision;
  }
  const concurrency =
    descriptor.sessionArtifact === true
      ? decideAggregateConcurrency({
          expectedAggregateVersion: null,
          aggregateVersion: (await reader.readMetadata()).aggregateVersion,
        })
      : null;
  if (concurrency && !concurrency.allowed)
    throw new TypeError(`authority event commit rejected: ${concurrency.reason}`);
  const floor = (await reader.readEventSequence(ordering.domain, ordering.scopeId)) ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0 || !Number.isSafeInteger(floor + 1))
    throw new TypeError("Invalid authority event sequence floor");
  const occurredAt = service.now();
  const envelope = createEventEnvelope({
    family,
    schemaVersion: descriptor.schemaVersion,
    identity: { ...identity, eventId: createEventId(), sessionId },
    causality,
    ordering: {
      ...ordering,
      sequence: floor + 1,
      ...(isArtifact ? { revision: eventPayload.revision } : {}),
      ...(concurrency ? { aggregateVersion: concurrency.nextAggregateVersion } : {}),
    },
    producer,
    occurredAt,
    payload: eventPayload,
  });
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid)
    throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
  const prepared = await prepareOutboxChanges(service, reader, {
    artifactEvents: [
      { eventId: envelope.identity.eventId, envelope, committedAt: occurredAt, deliveries: {} },
    ],
  });
  return async (commit) => {
    await commit(prepared);
    return {
      committed: true,
      envelope,
      ...(concurrency ? { aggregateVersion: concurrency.nextAggregateVersion } : {}),
    };
  };
}
