/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableSessionMessages } from "./immutable-message-reader.js";
import { readImmutableArtifactEvents } from "./immutable-artifact-event-index.js";

async function readValues(store, snapshot, collection) {
  const values = [];
  for await (const [, value] of store.entries(snapshot, collection)) values.push(value);
  return values;
}

export async function readImmutableSessionSource({ store, snapshot, materializeMessages }) {
  return store.objects.withSnapshot(snapshot, () =>
    readSessionSource({ store, snapshot, materializeMessages }),
  );
}

async function readSessionSource({ store, snapshot, materializeMessages }) {
  const records = await store.getMany(snapshot, "metadata", ["session", "facts", "lifecycle"]);
  const metadata = records.get("session");
  const facts = records.get("facts");
  const header = records.get("lifecycle");
  if (!metadata || !facts || !header)
    throw immutableStorageError("Immutable session is not initialized");
  const lifecycle = { ...header, turns: {}, replacedTurns: {}, commandReceipts: [] };
  for await (const [scope, turn] of store.entries(snapshot, "lifecycle"))
    Object.defineProperty(lifecycle.turns, scope, { value: turn, enumerable: true });
  for await (const [scope, turn] of store.entries(snapshot, "replacements"))
    Object.defineProperty(lifecycle.replacedTurns, scope, { value: turn, enumerable: true });
  for await (const [key, receipt] of store.entries(snapshot, "commands")) {
    if (JSON.parse(key)[0] === "lifecycle") lifecycle.commandReceipts.push(receipt);
  }
  lifecycle.commandReceipts.sort((left, right) => left.sequence - right.sequence);
  return {
    ...metadata,
    messages: await readImmutableSessionMessages({
      store,
      snapshot,
      facts,
      turns: lifecycle.turns,
      materializeMessages,
    }),
    dialogOrder: await readValues(store, snapshot, "dialogs"),
    turnTimings: await readValues(store, snapshot, "timings"),
    turnLifecycle: lifecycle,
    sessionArtifactEvents: await readImmutableArtifactEvents(store, snapshot),
  };
}
