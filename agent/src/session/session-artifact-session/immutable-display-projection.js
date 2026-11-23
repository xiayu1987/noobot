/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readImmutableSessionSource } from "./immutable-session-source.js";
import { buildSessionDisplayProjection } from "../session-summary-builders/session-display-summary.js";
import { requiresDisplayMessageContent } from "../session-summary-builders/message-summary-projection.js";
import { hasToolResultArtifacts } from "../session-summary-builders/turn-artifact-projection.js";
import { contributesDisplayThinkingDetails } from "../session-summary-builders/display-message-list.js";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";
import { normalizeSessionAggregateEntity } from "../entities/session-entity.js";
import { assertSessionMessageEntity } from "@noobot/session-protocol";
import { requireImmutableMessageDisplay } from "@noobot/session-protocol/immutable-storage-graph";
import { projectImmutableMessageRecord } from "./immutable-message-reader.js";
import {
  readImmutableMessageDisplaySourcePage,
  readImmutableSessionAutoTitle,
} from "./immutable-message-range.js";

async function materializeDisplaySources(records, store, budget) {
  const normalized = records.map((metadata) => {
    requireImmutableMessageDisplay(metadata.value.display);
    return { ...metadata, value: normalizeMessageMetadataEntity(metadata) };
  });
  const selected = normalized.filter(
    ({ value: { message } }) =>
      requiresDisplayMessageContent(message) || hasToolResultArtifacts(message),
  );
  const materialized = await store.objects.materializeValues(
    selected.map(({ value, parts }) => ({
      value,
      parts: parts.filter(({ path }) => path[1] === "content"),
    })),
    { budget },
  );
  for (const { message } of materialized) assertSessionMessageEntity(message);
  return normalized.map(({ value }) => value);
}

export function readImmutableDisplaySourcePage(options) {
  return readImmutableMessageDisplaySourcePage(options, ({ selected, lifecycles }, store, budget) =>
    materializeDisplaySources(
      selected.map((entry) => ({
        ...entry,
        value: projectImmutableMessageRecord(
          entry.value,
          lifecycles.get(entry.value.message.turnScopeId),
          entry,
        ),
      })),
      store,
      budget,
    ),
  );
}

export async function readImmutableDisplayProjection({ store, snapshot, includeThinkingTimeline }) {
  const ordinals = new Map();
  const thinkingTurns = new Set();
  const toolTimelines = new Map();
  const source = await readImmutableSessionSource({
    store,
    snapshot,
    materializeMessages: async (records) => {
      const sources = await materializeDisplaySources(records, store);
      for (const { message, ordinal, display } of sources) {
        ordinals.set(message.messageUid, ordinal);
        if (contributesDisplayThinkingDetails({ ...message, toolTimeline: display.toolTimeline }))
          thinkingTurns.add(message.turnScopeId);
        if (includeThinkingTimeline && display.toolTimeline.length)
          toolTimelines.set(message.messageUid, display.toolTimeline);
      }
      return sources;
    },
  });
  source.autoTitle = await readImmutableSessionAutoTitle(store, snapshot);
  return buildSessionDisplayProjection(normalizeSessionAggregateEntity(source), {
    includeThinkingTimeline,
    thinkingTurns,
    selectSourceOrdinal: (message) => ordinals.get(message.messageUid),
    selectToolTimeline: (message) => toolTimelines.get(message.messageUid) ?? [],
  });
}
