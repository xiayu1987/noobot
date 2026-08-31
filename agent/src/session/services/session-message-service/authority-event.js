/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  createEventEnvelope,
  getEventFamily,
  pluginArtifactKey,
  projectPluginArtifacts,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
import {
  PLUGIN_ARTIFACT_ERROR_CODE,
  PLUGIN_ARTIFACT_FAMILY,
} from "@noobot/event-protocol/plugin-artifact-event";

const text = (value) => String(value || "").trim();

function nextSequence(outbox = [], artifactEvents = [], domain = "", scopeId = "") {
  const envelopes = [
    ...normalizeAuthorityEventOutbox(outbox).map((item) => item.envelope),
    ...(Array.isArray(artifactEvents) ? artifactEvents : []),
  ];
  return (
    envelopes.reduce((maximum, envelope) => {
      const ordering = envelope?.ordering;
      if (ordering?.domain !== domain || ordering?.scopeId !== scopeId) return maximum;
      return Math.max(maximum, Number(ordering.sequence) || 0);
    }, 0) + 1
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
      const sequence = nextSequence(
        session.authorityEventOutbox,
        session.sessionArtifactEvents,
        orderingDomain,
        orderingScopeId,
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
      session.authorityEventOutbox = [
        ...normalizeAuthorityEventOutbox(session.authorityEventOutbox),
        {
          eventId: envelope.identity.eventId,
          envelope,
          committedAt: occurredAt,
          delivery: { status: "pending", attempts: 0, lastAttemptAt: "", deliveredAt: "" },
        },
      ];
      if (validation.descriptor?.sessionArtifact === true) {
        session.sessionArtifactEvents = [...(session.sessionArtifactEvents || []), envelope];
      }
      session.updatedAt = occurredAt;
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
