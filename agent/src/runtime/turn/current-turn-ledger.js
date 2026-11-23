/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, text } from "@noobot/shared/value";
import { canonicalAssistantPresentationIdentity } from "@noobot/session-protocol";
import {
  requireMessagePersistenceReceipt,
  sameMessageCreationOwner,
} from "@noobot/session-protocol/session-changes";
import { selectMessagePersistenceBatch } from "@noobot/session-protocol/message-persistence-batch";
import { createMessagePositionIndex } from "./message-position-index.js";
import { createTurnCompletionIndex } from "./turn-completion-index.js";
import {
  assertAgentTurnMessages,
  assertAgentTurnMessageAppend,
  captureAgentTurnMessageValue,
  patchAgentTurnMessageValue,
  appendAgentTurnMessageContent,
  captureAgentTurnMessages,
} from "@noobot/agent-transport-protocol/agent-turn-result";

function cloneMessages(messages) {
  return messages.map((message) => ({ ...message }));
}

function persistenceEntry(entry) {
  return {
    ...entry,
    message: { ...entry.message },
    persisted: entry.persistenceState.committed,
    contentAppend:
      entry.persistenceState.committed?.contentEpoch === entry.contentEpoch &&
      entry.message.content !== entry.persistenceState.committed.message.content
        ? entry.message.content.slice(entry.persistenceState.committed.message.content.length)
        : null,
  };
}

function* pendingThrough(pending, revision) {
  for (const entry of pending.values()) {
    if (entry.revision > revision) break;
    yield persistenceEntry(entry);
  }
}

export function createCurrentTurnMessagesStore(messages = []) {
  const initial = captureAgentTurnMessages(messages);
  const items = new Map(initial.map((item, index) => [index, item]));
  let nextPosition = items.size;
  const order = new Map();
  let lastPosition;
  function appendPosition(index) {
    order.set(index, { previous: lastPosition, next: undefined });
    if (lastPosition !== undefined) order.get(lastPosition).next = index;
    lastPosition = index;
  }
  function removePosition(index) {
    const { previous, next } = order.get(index);
    if (previous !== undefined) order.get(previous).next = next;
    if (next !== undefined) order.get(next).previous = previous;
    else lastPosition = previous;
    order.delete(index);
  }
  const messageUids = new Set(initial.map((item) => item.messageUid));
  const positions = new Map(initial.map((item, index) => [item.messageUid, index]));
  const assistantPositions = new Map();
  const modelPositions = new Map();
  const presentationPositions = new Map();
  const artifactPositions = new Set();
  const finalAssistantPositions = createMessagePositionIndex();
  const completionIndex = createTurnCompletionIndex();
  function indexArtifacts(message, index, remove) {
    if (remove) completionIndex.remove(index);
    else completionIndex.set(index, message);
    finalAssistantPositions.set(
      index,
      !remove && message.role === "assistant" && String(message.type || "message") !== "tool_call",
    );
    if (
      !remove &&
      ((Array.isArray(message.attachments) && message.attachments.length) ||
        (Array.isArray(message.transferEnvelopes) && message.transferEnvelopes.length))
    )
      artifactPositions.add(index);
    else artifactPositions.delete(index);
  }
  function indexModelMessage(message, index, remove) {
    const key = text(message.modelMessageId);
    if (!key) return;
    const matches = modelPositions.get(key) ?? new Set();
    if (remove) matches.delete(index);
    else matches.add(index);
    if (matches.size) modelPositions.set(key, matches);
    else modelPositions.delete(key);
  }
  function indexPresentation(message, index, remove = false) {
    const identity = canonicalAssistantPresentationIdentity(message);
    if (!identity) return;
    const key = identity.turnScopeId;
    const matches = presentationPositions.get(key) ?? new Set();
    if (remove) matches.delete(index);
    else matches.add(index);
    if (matches.size) presentationPositions.set(key, matches);
    else presentationPositions.delete(key);
  }
  function indexAssistant(message, index, remove = false) {
    indexArtifacts(message, index, remove);
    indexModelMessage(message, index, remove);
    indexPresentation(message, index, remove);
    if (message.role !== "assistant" || !text(message.modelMessageId)) return;
    const key = text(message.modelMessageId);
    const matches = assistantPositions.get(key) ?? new Set();
    if (remove) matches.delete(index);
    else matches.add(index);
    if (matches.size) assistantPositions.set(key, matches);
    else assistantPositions.delete(key);
  }
  const pending = new Map();
  const messageRevisions = new Map();
  const persistenceStates = new Map();
  let revision = 0;
  const counts = { messageCount: items.size, assistantCount: 0, toolCount: 0 };
  function count(message, delta) {
    if (message.role === "assistant") counts.assistantCount += delta;
    if (message.role === "tool") counts.toolCount += delta;
  }
  function changed(messageUid, message, append = false) {
    const nextRevision = ++revision;
    messageRevisions.set(messageUid, nextRevision);
    if (!persistenceStates.has(messageUid))
      persistenceStates.set(messageUid, {
        committed: null,
        contentEpoch: {},
        content: message.content,
      });
    const state = persistenceStates.get(messageUid);
    if (!append && state.content !== message.content) state.contentEpoch = {};
    state.content = message.content;
    pending.delete(messageUid);
    pending.set(messageUid, {
      messageUid,
      revision: nextRevision,
      message,
      persistenceState: state,
      contentEpoch: state.contentEpoch,
    });
  }
  function forgetMessage(messageUid) {
    pending.delete(messageUid);
    messageRevisions.delete(messageUid);
    persistenceStates.delete(messageUid);
  }
  for (const [index, item] of items.entries()) {
    appendPosition(index);
    count(item, 1);
    changed(item.messageUid, item);
    indexAssistant(item, index);
  }
  function rebuildMessageUids() {
    messageUids.clear();
    positions.clear();
    assistantPositions.clear();
    modelPositions.clear();
    presentationPositions.clear();
    artifactPositions.clear();
    finalAssistantPositions.clear();
    completionIndex.clear();
    order.clear();
    lastPosition = undefined;
    for (const [index, item] of items.entries()) {
      appendPosition(index);
      messageUids.add(item.messageUid);
      positions.set(item.messageUid, index);
      indexAssistant(item, index);
    }
  }
  function updateAt(index, patch, append = false) {
    const previous = items.get(index);
    const next = append
      ? appendAgentTurnMessageContent(previous, patch.content)
      : patchAgentTurnMessageValue(previous, patch);
    if (next === previous) return { ...previous };
    assertAgentTurnMessageAppend(next, {
      has: (uid) => uid !== previous.messageUid && messageUids.has(uid),
    });
    items.set(index, next);
    indexAssistant(previous, index, true);
    indexAssistant(next, index);
    messageUids.delete(previous.messageUid);
    positions.delete(previous.messageUid);
    messageUids.add(next.messageUid);
    positions.set(next.messageUid, index);
    count(previous, -1);
    count(next, 1);
    if (previous.messageUid !== next.messageUid) forgetMessage(previous.messageUid);
    changed(next.messageUid, next, append);
    return { ...next };
  }
  function replace(messagesToKeep) {
    const nextItems = captureAgentTurnMessages(messagesToKeep);
    const nextUids = new Set(nextItems.map((item) => item.messageUid));
    for (const item of items.values()) {
      count(item, -1);
      if (!nextUids.has(item.messageUid)) forgetMessage(item.messageUid);
    }
    for (const item of nextItems) {
      count(item, 1);
      const previous = items.get(positions.get(item.messageUid));
      if (!previous || JSON.stringify(previous) !== JSON.stringify(item))
        changed(item.messageUid, item);
    }
    counts.messageCount = nextItems.length;
    items.clear();
    nextItems.forEach((item, index) => items.set(index, item));
    nextPosition = items.size;
    rebuildMessageUids();
    return items.size;
  }
  return {
    push(message) {
      const next = captureAgentTurnMessageValue(message);
      assertAgentTurnMessageAppend(next, messageUids);
      const index = nextPosition++;
      items.set(index, next);
      appendPosition(index);
      messageUids.add(next.messageUid);
      positions.set(next.messageUid, index);
      indexAssistant(next, index);
      counts.messageCount += 1;
      count(next, 1);
      changed(next.messageUid, next);
      return { ...next };
    },
    updateLast(patch = {}, matcher = null) {
      if (!isFunction(matcher)) {
        const index = lastPosition;
        return index === undefined ? null : updateAt(index, patch);
      }
      for (let index = lastPosition; index !== undefined; index = order.get(index).previous) {
        if (!matcher(items.get(index))) continue;
        return updateAt(index, patch);
      }
      return null;
    },
    appendContentByUid(messageUid, content) {
      if (typeof content !== "string" || content.length === 0)
        throw new TypeError("Message content append requires a non-empty string");
      const index = positions.get(messageUid);
      if (index === undefined) throw new TypeError("Cannot append content to a missing message");
      const previous = items.get(index);
      if (typeof previous.content !== "string")
        throw new TypeError("Message content must be a string");
      return updateAt(index, { content }, true);
    },
    updateByUid(messageUid, patch = {}) {
      const index = positions.get(messageUid);
      return index === undefined ? null : updateAt(index, patch);
    },
    demoteAssistantPresentation(turnScopeId) {
      const matches = presentationPositions.get(text(turnScopeId));
      if (!matches) return 0;
      const selected = [...matches];
      for (const index of selected)
        updateAt(index, { chatPresentation: false, workspaceRootDirectory: undefined });
      return selected.length;
    },
    readArtifactProjectionSources() {
      const last = finalAssistantPositions.last();
      if (last === undefined) return [];
      const selected = new Set(artifactPositions);
      selected.add(last);
      return [...selected]
        .sort((left, right) => left - right)
        .map((index) => ({ ...items.get(index) }));
    },
    readResultMessages() {
      const selected = new Set();
      for (const { messageUid } of pending.values()) selected.add(positions.get(messageUid));
      const last = finalAssistantPositions.last();
      if (last !== undefined) selected.add(last);
      return [...selected]
        .sort((left, right) => left - right)
        .map((index) => ({ ...items.get(index) }));
    },
    readFinalAssistant() {
      const last = finalAssistantPositions.last();
      return last === undefined ? null : { ...items.get(last) };
    },
    readMessagesByModelMessageId(modelMessageId) {
      const matches = modelPositions.get(text(modelMessageId));
      return matches
        ? [...matches].sort((left, right) => left - right).map((index) => ({ ...items.get(index) }))
        : [];
    },
    readAssistantByModelMessageId(modelMessageId) {
      const matches = assistantPositions.get(text(modelMessageId));
      if (!matches) return null;
      let first = Infinity;
      for (const index of matches) if (index < first) first = index;
      return { ...items.get(first) };
    },
    readByUid(messageUid) {
      const index = positions.get(messageUid);
      return index === undefined ? null : { ...items.get(index) };
    },
    readMessageRevisions(uids) {
      return [...new Set(uids)].map((messageUid) => ({
        messageUid,
        revision: messageRevisions.get(messageUid),
      }));
    },
    readUnchangedMessageUids(entries) {
      return entries
        .filter((entry) => messageRevisions.get(entry.messageUid) === entry.revision)
        .map((entry) => entry.messageUid);
    },
    readCompletionSelection() {
      return completionIndex.read();
    },
    readCheckpointEvidenceUids() {
      return completionIndex.readCheckpointEvidenceUids();
    },

    evictCommittedByUids(uids) {
      const selected = [...new Set(uids)]
        .map((uid) => positions.get(uid))
        .filter((index) => index !== undefined)
        .sort((left, right) => left - right);
      const evicted = selected.map((index) => ({ ...items.get(index) }));
      for (const index of selected) {
        const previous = items.get(index);
        indexAssistant(previous, index, true);
        removePosition(index);
        items.delete(index);
        positions.delete(previous.messageUid);
        messageUids.delete(previous.messageUid);
        forgetMessage(previous.messageUid);
        counts.messageCount -= 1;
        count(previous, -1);
      }
      return evicted;
    },
    updateWhere(patch = {}, matcher = null) {
      let updatedCount = 0;
      const previousItems = [...items.values()];
      const nextItems = previousItems.map((item, index) => {
        if (isFunction(matcher) && !matcher(item, index)) return item;
        updatedCount += 1;
        return patchAgentTurnMessageValue(item, patch);
      });
      assertAgentTurnMessages(nextItems);
      const nextUids = new Set(nextItems.map((item) => item.messageUid));
      for (let index = 0; index < previousItems.length; index += 1) {
        const previous = previousItems[index];
        const next = nextItems[index];
        if (previous === next) continue;
        count(previous, -1);
        count(next, 1);
        if (!nextUids.has(previous.messageUid)) forgetMessage(previous.messageUid);
        changed(next.messageUid, next);
      }
      items.clear();
      nextItems.forEach((item, index) => items.set(index, item));
      nextPosition = items.size;
      rebuildMessageUids();
      return updatedCount;
    },
    replaceAll: replace,
    readCounts() {
      return { ...counts };
    },
    readPersistenceBoundary() {
      return revision;
    },
    readPendingChangeBatch({ throughRevision, ownership, maxBytes, maxRecords }) {
      if (
        !Number.isSafeInteger(throughRevision) ||
        throughRevision < 0 ||
        throughRevision > revision
      )
        throw new TypeError("Persistence requires a valid revision boundary");
      const batch = selectMessagePersistenceBatch({
        entries: pendingThrough(pending, throughRevision),
        ownership,
        maxBytes,
        maxRecords,
      });
      return { ...batch, counts: { ...counts } };
    },
    readPendingChanges() {
      return {
        entries: [...pendingThrough(pending, revision)],
        counts: { ...counts },
      };
    },
    confirmPersistence(entries, receipts) {
      const byUid = new Map();
      const submitted = new Set(entries.map((entry) => entry.messageUid));
      for (const receipt of receipts) {
        requireMessagePersistenceReceipt(receipt);
        if (!submitted.has(receipt.messageUid) || byUid.has(receipt.messageUid))
          throw new TypeError("Persistence receipts must match the submitted message set");
        byUid.set(receipt.messageUid, receipt);
      }
      const confirmations = [];
      for (const entry of entries) {
        const state = persistenceStates.get(entry.messageUid);
        if (state !== entry.persistenceState) continue;
        const receipt = byUid.get(entry.messageUid);
        if (!receipt) throw new TypeError("Submitted message has no persistence receipt");
        if (
          ["sessionId", "dialogProcessId", "turnScopeId"].some(
            (field) =>
              entry.message[field] !== undefined && entry.message[field] !== receipt[field],
          )
        )
          throw new TypeError("Persistence receipt ownership mismatch");
        if (
          state.committed &&
          !sameMessageCreationOwner(state.committed.receipt.owner, receipt.owner)
        )
          throw new TypeError("Persistence receipt changed the message creation owner");
        if (
          state.committed &&
          (receipt.generation < state.committed.receipt.generation ||
            entry.revision < state.committed.revision)
        )
          throw new TypeError("Persistence confirmation cannot move backwards");
        confirmations.push([
          state,
          {
            message: entry.message,
            receipt: Object.freeze({
              ...receipt,
              owner:
                typeof receipt.owner === "number"
                  ? receipt.owner
                  : Object.freeze({ ...receipt.owner }),
              activityEventIds: Object.freeze([...receipt.activityEventIds]),
            }),
            contentEpoch: entry.contentEpoch,
            revision: entry.revision,
          },
        ]);
      }
      for (const [state, committed] of confirmations) state.committed = committed;
    },
    acknowledgeChanges(entries) {
      for (const entry of entries) {
        if (pending.get(entry.messageUid)?.revision === entry.revision)
          pending.delete(entry.messageUid);
      }
    },
    readSnapshot() {
      return Object.freeze(cloneMessages([...items.values()]));
    },
    toArray() {
      return cloneMessages([...items.values()]);
    },
  };
}

export function requireCurrentTurnMessagesStore(currentTurnMessages) {
  if (
    currentTurnMessages &&
    isFunction(currentTurnMessages.push) &&
    isFunction(currentTurnMessages.updateLast) &&
    isFunction(currentTurnMessages.updateWhere) &&
    isFunction(currentTurnMessages.readSnapshot) &&
    isFunction(currentTurnMessages.readPendingChanges) &&
    isFunction(currentTurnMessages.readResultMessages) &&
    isFunction(currentTurnMessages.acknowledgeChanges) &&
    isFunction(currentTurnMessages.toArray)
  )
    return currentTurnMessages;
  throw new Error("turn execution requires the canonical currentTurnMessages store");
}
