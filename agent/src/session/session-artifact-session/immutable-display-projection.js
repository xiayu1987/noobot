/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readImmutableSessionSource } from "./immutable-session-source.js";
import { buildSessionDisplayProjection } from "../session-summary-builders/session-display-summary.js";
import { requiresDisplayMessageContent } from "../session-summary-builders/message-summary-projection.js";
import { hasToolResultArtifacts } from "../session-summary-builders/turn-artifact-projection.js";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";
import { normalizeSessionAggregateEntity } from "../entities/session-entity.js";
import { assertSessionMessageEntity } from "@noobot/session-protocol";
import { requireImmutableMessageDisplay } from "@noobot/session-protocol/immutable-storage-graph";

export async function readImmutableDisplayProjection({ store, snapshot }) {
  const toolTimelines = new Map();
  const source = await readImmutableSessionSource({
    store,
    snapshot,
    materializeMessages: async (records) => {
      for (const { value } of records)
        toolTimelines.set(
          value.message.messageUid,
          requireImmutableMessageDisplay(value.display).toolTimeline,
        );
      const normalized = records.map((metadata) => ({
        ...metadata,
        value: normalizeMessageMetadataEntity(metadata),
      }));
      const selected = normalized.filter(
        ({ value: { message } }) =>
          requiresDisplayMessageContent(message) || hasToolResultArtifacts(message),
      );
      const materialized = await store.objects.materializeValues(
        selected.map(({ value, parts }) => ({
          value,
          parts: parts.filter(({ path }) => path[1] === "content"),
        })),
      );
      for (const { message } of materialized) assertSessionMessageEntity(message);
      return normalized.map(({ value }) => value);
    },
  });
  return buildSessionDisplayProjection(normalizeSessionAggregateEntity(source), {
    selectToolTimeline: (message) => toolTimelines.get(message.messageUid),
  });
}
