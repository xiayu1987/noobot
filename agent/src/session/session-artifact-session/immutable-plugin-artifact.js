/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isCommittedArtifactRetired,
  pluginArtifactKey,
  requirePluginArtifactProjection,
  requirePluginArtifactAuthority,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  assertAuthorityEventScope,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import { immutableStorageError } from "./immutable-object-store.js";
import { readOutboxTail } from "./immutable-outbox.js";

export async function readImmutablePluginArtifact(get, identity) {
  const current = await get("pluginArtifacts", pluginArtifactKey(identity));
  try {
    requirePluginArtifactProjection(current, identity);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable plugin artifact projection", cause);
  }
  if (current === null) return null;
  const [event, scope] = await Promise.all([
    get("events", current.eventId),
    get("metadata", "session"),
  ]);
  try {
    normalizeAuthorityEventOutbox([event]);
    if (
      !scope ||
      !event ||
      event.artifact !== true ||
      event.eventId !== current.eventId ||
      !Number.isSafeInteger(event.ordinal) ||
      event.ordinal < 1
    )
      throw new TypeError("Plugin artifact has no authoritative event");
    assertAuthorityEventScope(event, scope);
    requirePluginArtifactAuthority(current, event.envelope, identity);
    const retired = await isCommittedArtifactRetired(
      (key) => get("metadata", key),
      event,
      await readOutboxTail(get),
    );
    return retired ? null : current;
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw immutableStorageError("Invalid immutable plugin artifact authority", cause);
  }
}
