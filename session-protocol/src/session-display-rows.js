/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { canonicalAssistantPresentationIdentity } from "./turn-presentation.js";

function requirePresentationTurn(existing, presentation) {
  if (text(existing.turnScopeId) !== presentation.turnScopeId)
    throw new TypeError(
      "active Turn presentation invariant failed: presentation_turn_scope_conflict",
    );
}

function placeLifecyclePresentations(messages, presentations, assistants, lastUserPositions) {
  const anchored = new Map();
  const unanchored = [];
  const presentationByTurn = new Map();
  const lifecycleOwners = new Map();
  for (const lifecycle of presentations) {
    const { row: presentation } = lifecycle;
    const id = presentation.presentationMessageId;
    const previous = presentationByTurn.get(presentation.turnScopeId);
    if (previous !== undefined && previous !== id)
      throw new TypeError(
        "active Turn presentation invariant failed: presentation_turn_identity_conflict",
      );
    const index = lastUserPositions.get(presentation.turnScopeId);
    const sources = assistants.get(id) ?? noAssistantSources;
    const entry = resolveSessionDisplayAssistant({
      ...sources,
      lifecycle,
      lastUser: index === undefined ? null : messages[index],
    });
    if (lifecycleOwners.has(id)) requirePresentationTurn(lifecycleOwners.get(id), presentation);
    lifecycleOwners.set(id, presentation);
    presentationByTurn.set(presentation.turnScopeId, id);
    if (previous !== undefined || sources.firstSource !== null) continue;
    if (index === undefined) unanchored.push(entry);
    else anchored.set(index, entry);
  }

  unanchored.sort(
    (left, right) => left.placement.lifecycleSequence - right.placement.lifecycleSequence,
  );
  if (
    unanchored.some(
      ({ placement }, index) =>
        index > 0 &&
        unanchored[index - 1].placement.lifecycleSequence === placement.lifecycleSequence,
    )
  )
    throw new TypeError("Display tail requires unique lifecycle sequences");
  return { anchored, unanchored };
}

export function isFinalDisplayAssistantSource(row) {
  return !text(row.sourceMessageType);
}

function requireUniqueCanonicalTurn(row, canonicalTurns) {
  const identity = canonicalAssistantPresentationIdentity(row);
  if (identity === null) return;
  if (canonicalTurns.has(identity.turnScopeId))
    throw new TypeError("session summary contains multiple canonical assistant presentations");
  canonicalTurns.add(identity.turnScopeId);
}

const noAssistantSources = Object.freeze({
  firstSource: null,
  latestSource: null,
  canonicalSource: null,
});

function collectAssistantSource(assistants, canonicalTurns, row, index) {
  const id = row.presentationMessageId;
  let sources = assistants.get(id);
  if (sources === undefined) {
    sources = { ...noAssistantSources, firstSource: row, index };
    assistants.set(id, sources);
  } else requirePresentationTurn(sources.firstSource, row);
  if (isFinalDisplayAssistantSource(row)) {
    requireUniqueCanonicalTurn(row, canonicalTurns);
    if (sources.canonicalSource !== null)
      throw new TypeError("session summary contains multiple canonical assistant presentations");
    sources.canonicalSource = row;
  }
  sources.latestSource = row;
}

export function resolveSessionDisplayAssistant({
  firstSource,
  latestSource,
  canonicalSource,
  lifecycle,
  lastUser,
}) {
  if (lifecycle !== null) {
    const { row, lifecycleSequence } = lifecycle;
    if (!Number.isSafeInteger(lifecycleSequence) || lifecycleSequence < 1)
      throw new TypeError("Display presentation requires a positive lifecycle sequence");
    if (firstSource !== null) requirePresentationTurn(firstSource, row);
    else
      return {
        row,
        placement:
          lastUser === null
            ? { kind: "lifecycle-tail", lifecycleSequence }
            : { kind: "after-user", anchor: lastUser },
      };
  }
  if (firstSource === null) return null;
  if (latestSource === null) throw new TypeError("Display assistant requires its latest source");
  return {
    row: canonicalSource ?? latestSource,
    placement: { kind: "source", anchor: firstSource },
  };
}

export function sessionDisplayRowOrderKey({ placement }, { sourceOrdinal }) {
  const tail = placement.kind === "lifecycle-tail";
  const afterUser = placement.kind === "after-user";
  if (!tail && !afterUser && placement.kind !== "source")
    throw new TypeError("Unknown display row placement");
  const ordinal = tail ? placement.lifecycleSequence : sourceOrdinal(placement.anchor);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new TypeError("Display row placement requires a positive ordinal");
  return [Number(tail), ordinal, Number(afterUser)];
}

export function planSessionDisplayRows(messages, presentations) {
  if (!Array.isArray(messages) || !Array.isArray(presentations))
    throw new TypeError("Display row ordering requires explicit messages and presentations");
  const assistants = new Map();
  const lastUserPositions = new Map();
  const canonicalTurns = new Set();
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") lastUserPositions.set(text(message.turnScopeId), index);
    if (message.role === "assistant")
      collectAssistantSource(assistants, canonicalTurns, message, index);
  }
  const { anchored, unanchored } = placeLifecyclePresentations(
    messages,
    presentations,
    assistants,
    lastUserPositions,
  );
  const ordered = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant") {
      ordered.push({ row: message, placement: { kind: "source", anchor: message } });
    } else if (assistants.get(message.presentationMessageId).index === index) {
      const sources = assistants.get(message.presentationMessageId);
      ordered.push(resolveSessionDisplayAssistant({ ...sources, lifecycle: null, lastUser: null }));
    }
    const inserted = anchored.get(index);
    if (inserted !== undefined) ordered.push(inserted);
  }
  return ordered.concat(unanchored);
}
