/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertScopedSessionReadIdentity,
  createSessionReaderAccess,
} from "@noobot/session-protocol/session-reader";
import { readExecutionLogs } from "./session-artifact-execution-logs.js";
import {
  readSessionThinkingDetail,
  releaseSessionThinkingDetail,
} from "./session-thinking-detail.js";
import {
  readRetainedDisplayArtifactPage,
  readRetainedSessionDetailStart,
  readRetainedSessionDisplayPage,
  releaseRetainedDisplayArtifactPage,
  releaseRetainedSessionDisplayPage,
} from "./session-display-page.js";
import { readExecutionReportArtifact } from "./session-execution-artifacts.js";
import { requireStorageService } from "./storage-service.js";
import { isFunction } from "@noobot/shared/value";
import {
  requireMessageContentPage,
  scopedSessionPageIdentity,
} from "@noobot/session-protocol/message-read-budget";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { withStorageCleanup } from "../shared/storage/durable-file.js";
import { readRequiredMessageContentPage } from "./session-message-content-page.js";
import { assertStorageBatchSucceeded } from "./storage-batch-results.js";

async function openScopedReader({ access, assertAuthorityActive, sessionDir, identity }) {
  const { userId, authoritySessionId, sessionId } = identity;
  await assertAuthorityActive(userId, authoritySessionId);
  if (sessionId !== null) await assertAuthorityActive(userId, sessionId);
  const reader = await access.openArtifact({ sessionDir });
  try {
    const metadata = await reader.readMetadata();
    assertScopedSessionReadIdentity(metadata, identity);
    if (sessionId === null) await assertAuthorityActive(userId, metadata.sessionId);
    return reader;
  } catch (cause) {
    return withStorageCleanup(() => {
      throw cause;
    }, reader[Symbol.asyncDispose]);
  }
}

function createScopedReadAccess({
  access,
  pageSnapshots,
  assertAuthorityActive,
  withDeletionFence,
}) {
  return function scopedAccess({ userId, authoritySessionId, sessionDir }, sessionId) {
    return {
      pageSnapshots: pageSnapshots.withReadAuthority(async (reader) => {
        await assertAuthorityActive(userId, authoritySessionId);
        const ownedSessionId = sessionId ?? (await reader.readMetadata()).sessionId;
        await assertAuthorityActive(userId, ownedSessionId);
      }),
      identity: scopedSessionPageIdentity({ userId, authoritySessionId, sessionDir }, sessionId),
      open() {
        return withDeletionFence(userId, () =>
          openScopedReader({
            access,
            assertAuthorityActive,
            sessionDir,
            identity: { userId, authoritySessionId, sessionId },
          }),
        );
      },
    };
  };
}

export function createScopedSessionArtifactReader({
  storageService,
  sessionReaderAccess,
  pageSnapshots,
  assertAuthorityActive,
  withDeletionFence,
}) {
  const storage = requireStorageService(storageService, "createScopedSessionArtifactReader");
  const access = createSessionReaderAccess(sessionReaderAccess);
  if (!pageSnapshots || !isFunction(assertAuthorityActive) || !isFunction(withDeletionFence)) {
    throw new TypeError("Scoped session reads require snapshot and deletion authority");
  }
  const scopedAccess = createScopedReadAccess({
    access,
    pageSnapshots,
    assertAuthorityActive,
    withDeletionFence,
  });
  async function readOnce(selection, sessionId, read) {
    const { pageSnapshots: snapshots, ...scope } = scopedAccess(selection, sessionId);
    const { value } = await snapshots.read({
      ...scope,
      cursor: null,
      async read(reader) {
        return { value: await read(reader), nextCursor: null };
      },
    });
    return value;
  }
  return Object.freeze({
    readScopedSessionSnapshot(selection) {
      return readOnce(selection, null, async (reader) => {
        const results = await Promise.allSettled(
          [
            async () => reader.readDisplayProjection(),
            async () => reader.readScopedMetadata(),
            async () =>
              readExecutionLogs({ storageService: storage, sessionDir: selection.sessionDir }),
          ].map((read) => read()),
        );
        assertStorageBatchSucceeded(results);
        const [sessionSummary, meta, executionLogs] = results.map(({ value }) => value);
        return { sessionSummary, executionLogs, meta };
      });
    },
    readScopedDetailStart({ request, ...selection }) {
      return readRetainedSessionDetailStart({
        ...scopedAccess(selection, request.sessionId),
        request,
      });
    },
    readScopedDisplayPage({ request, ...selection }) {
      return readRetainedSessionDisplayPage({
        ...scopedAccess(selection, request.sessionId),
        request,
      });
    },
    releaseScopedDisplayPage({ request, ...selection }) {
      return releaseRetainedSessionDisplayPage({
        ...scopedAccess(selection, request.sessionId),
        request,
      });
    },
    readScopedDisplayArtifactPage({ request, ...selection }) {
      return readRetainedDisplayArtifactPage({
        ...scopedAccess(selection, request.sessionId),
        request,
      });
    },
    releaseScopedDisplayArtifactPage({ request, ...selection }) {
      return releaseRetainedDisplayArtifactPage({
        ...scopedAccess(selection, request.sessionId),
        request,
      });
    },
    async readScopedMessageContentPage({ sessionId, request, ...selection }) {
      const body = requireMessageContentPage(request);
      return readOnce(selection, sessionId, (reader) =>
        readRequiredMessageContentPage(reader, body),
      );
    },
    async readScopedThinkingDetail({
      sessionId,
      turnScopeId,
      dialogProcessId,
      cursor,
      limit,
      ...selection
    }) {
      return readSessionThinkingDetail({
        ...scopedAccess(selection, sessionId),
        sessionId,
        lookupKey: { turnScopeId, dialogProcessId },
        cursor,
        limit,
      });
    },
    async releaseScopedThinkingDetail({
      sessionId,
      turnScopeId,
      dialogProcessId,
      cursor,
      ...selection
    }) {
      return releaseSessionThinkingDetail({
        ...scopedAccess(selection, sessionId),
        sessionId,
        lookupKey: { turnScopeId, dialogProcessId },
        cursor,
      });
    },
    readScopedExecutionReport({ dialogProcessId, ...selection }) {
      return readOnce(selection, null, async (reader) => {
        const { sessionId } = await reader.readMetadata();
        const report = await readExecutionReportArtifact({
          storageService: storage,
          sessionDir: selection.sessionDir,
          dialogProcessId,
        });
        if (
          report !== null &&
          (report.sessionId !== sessionId || report.dialogProcessId !== dialogProcessId)
        )
          throw partitionJournalError(
            "SESSION_STORAGE_CORRUPT",
            "Execution report identity mismatch",
          );
        return report;
      });
    },
  });
}
