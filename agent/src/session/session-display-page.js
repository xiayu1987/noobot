/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireRetainedSessionDisplayPageRequest,
  requireRetainedSessionDisplayPageResponse,
  requireSessionDisplayPageRelease,
} from "@noobot/session-protocol/session-reader";
import {
  requireRetainedDisplayArtifactPageRelease,
  requireRetainedDisplayArtifactPageRequest,
  requireRetainedDisplayArtifactPageResponse,
  requireSessionPageReleaseResult,
} from "@noobot/session-protocol/message-read-budget";
import {
  requireSessionDetailStartRequest,
  requireSessionDetailStartResponse,
} from "@noobot/session-protocol/session-detail";
import { TURN_RECOVERY_ACTION } from "@noobot/session-protocol/turn-lifecycle";
import { resolveSessionTitle } from "./entities/session-message-facts.js";
import { createSessionTurnLifecycleSnapshot } from "./session-turn-read-model.js";

function snapshotIdentity(identity, sessionId) {
  return [...identity, "display", sessionId];
}

export async function readRetainedSessionDisplayPage({ pageSnapshots, identity, open, request }) {
  const { sessionId, direction, cursor, limit, maxBytes } =
    requireRetainedSessionDisplayPageRequest(request);
  return pageSnapshots.read({
    identity: snapshotIdentity(identity, sessionId),
    cursor,
    open,
    read: (reader, storageCursor) =>
      reader.readDisplayPage({ direction, cursor: storageCursor, limit, maxBytes }),
    validate: (page) => requireRetainedSessionDisplayPageResponse(page, request),
  });
}

export function readRetainedSessionDetailStart({ pageSnapshots, identity, open, request }) {
  const { page: selection, lifecycle } = requireSessionDetailStartRequest(request);
  return pageSnapshots.read({
    identity: snapshotIdentity(identity, selection.sessionId),
    cursor: null,
    open,
    async read(reader) {
      const page = await reader.readDisplayPage({
        cursor: null,
        direction: selection.direction,
        limit: selection.limit,
        maxBytes: selection.maxBytes,
      });
      const metadata = await reader.readMetadata({ includeAutoTitle: true });
      const source = await reader.readLifecycleSource(lifecycle);
      if (
        metadata.sessionId !== page.sessionId ||
        metadata.parentSessionId !== page.parentSessionId ||
        source.sessionId !== page.sessionId ||
        metadata.aggregateVersion !== page.aggregateVersion ||
        source.aggregateVersion !== page.aggregateVersion ||
        source.generation !== page.generation ||
        reader.generation !== page.generation
      )
        throw new TypeError("Detail sources do not belong to the retained display snapshot");
      return {
        ...page,
        caller: metadata.caller,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        title: resolveSessionTitle(metadata),
        turnTimings: source.turnTimings,
        turnLifecycleSnapshot: createSessionTurnLifecycleSnapshot({
          session: source,
          messageTurnScopeIds: source.messageTurnScopeIds,
          commandId: `session-summary:${page.sessionId}:${source.turnLifecycle.sequence}`,
          knownSequence: 0,
          terminalLimit: lifecycle.terminalLimit,
          recovery: TURN_RECOVERY_ACTION.NONE,
          generatedAt: metadata.updatedAt,
        }),
      };
    },
    validate: (page) => requireSessionDetailStartResponse(page, request),
  });
}

export function releaseRetainedSessionDisplayPage({ pageSnapshots, identity, request }) {
  const { sessionId, cursor } = requireSessionDisplayPageRelease(request);
  return pageSnapshots.releaseCursor({ identity: snapshotIdentity(identity, sessionId), cursor });
}

function artifactSnapshotIdentity(identity, { sessionId, dialogProcessId, turnScopeId }) {
  return [...identity, "display-artifacts", sessionId, dialogProcessId, turnScopeId];
}

export async function readRetainedDisplayArtifactPage({ pageSnapshots, identity, open, request }) {
  const { dialogProcessId, turnScopeId, cursor, limit, maxBytes } =
    requireRetainedDisplayArtifactPageRequest(request);
  return pageSnapshots.read({
    identity: artifactSnapshotIdentity(identity, request),
    cursor,
    open,
    async read(reader, storageCursor) {
      const page = await reader.readDisplayArtifactPage({
        lookupKey: { dialogProcessId, turnScopeId },
        cursor: storageCursor,
        limit,
        maxBytes,
      });
      if (page !== null && page.generation !== reader.generation)
        throw new TypeError("Display artifact page does not belong to the retained snapshot");
      return page;
    },
    validate: (page) => requireRetainedDisplayArtifactPageResponse(page, request),
  });
}

export async function releaseRetainedDisplayArtifactPage({ pageSnapshots, identity, request }) {
  const { cursor } = requireRetainedDisplayArtifactPageRelease(request);
  return requireSessionPageReleaseResult(
    await pageSnapshots.releaseCursor({
      identity: artifactSnapshotIdentity(identity, request),
      cursor,
    }),
  );
}
