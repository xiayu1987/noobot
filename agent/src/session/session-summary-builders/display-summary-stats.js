/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applySessionDisplayRowDelta,
  applySessionDisplaySourceDelta,
  createSessionDisplayStats,
  emptySessionDisplayRowCounts,
  emptySessionDisplaySourceCounts,
  sessionDisplayMessageContribution,
  sessionDisplayRowContribution,
} from "@noobot/session-protocol/session-reader";
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

export function countDisplayRowAttachments(message) {
  const sessionAttachments = dedupeSessionAttachmentRefs(message.attachments);
  const transferAttachments = collectAttachmentRefsFromTransferEnvelopes(message.transferEnvelopes);
  return sessionAttachments.length + transferAttachments.length;
}

export function countSessionDisplaySources(messages) {
  const counts = messages.reduce(
    (counts, message) =>
      applySessionDisplaySourceDelta(counts, sessionDisplayMessageContribution(message)),
    emptySessionDisplaySourceCounts(),
  );
  return { messageCount: messages.length, ...counts };
}

export function buildSessionDisplayStats({
  sourceCounts,
  displayMessages,
  assignedToolArtifactCount,
  unassignedToolArtifactCount,
  conflictedToolArtifactCount,
}) {
  const rowCounts = displayMessages.reduce(
    (counts, row) =>
      applySessionDisplayRowDelta(
        counts,
        sessionDisplayRowContribution(row, countDisplayRowAttachments(row)),
      ),
    emptySessionDisplayRowCounts(),
  );
  return createSessionDisplayStats({
    ...sourceCounts,
    ...rowCounts,
    displayToolLogCount: assignedToolArtifactCount,
    unassignedToolArtifactCount,
    conflictedToolArtifactCount,
  });
}
