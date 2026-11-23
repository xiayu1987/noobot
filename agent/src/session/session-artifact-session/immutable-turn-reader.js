/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireScopedThinkingDetailPage } from "@noobot/session-protocol/message-read-budget";
import { readImmutableScopedTurnPage } from "./immutable-message-reader.js";
import { requiresThinkingDetailMessageContent } from "@noobot/event-protocol/thinking-detail-content";

function selectThinkingDetailPart(message, [, field]) {
  return (
    field === "toolTimeline" ||
    field === "activityTimeline" ||
    field === "thinkingContentTimeline" ||
    (field === "content" && requiresThinkingDetailMessageContent(message))
  );
}

export function readImmutableThinkingDetailPage(options) {
  return readImmutableScopedTurnPage(
    options,
    requireScopedThinkingDetailPage,
    selectThinkingDetailPart,
  );
}
