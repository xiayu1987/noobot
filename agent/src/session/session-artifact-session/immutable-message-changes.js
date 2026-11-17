/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertCanonicalAssistantPresentation,
  assertTurnRecord,
  canonicalAssistantPresentationIdentity,
  isDialogAnchorMessageRecord,
  requireTurnPartitionIdentity,
  resolveSessionAutoTitle,
} from "@noobot/session-protocol";
import {
  normalizeMessageEntity,
  normalizeMessageMetadataEntity,
} from "../entities/message-entity.js";
import { isContextSourceMessageCandidate } from "@noobot/context-protocol/assembly/source";
import { updateImmutableContextSource } from "./immutable-context-source-index.js";
import { assertCommittedMessageIdentity } from "@noobot/session-protocol/message-identity";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { requireImmutableMessageContentPart } from "@noobot/session-protocol/immutable-storage-graph";
import { updateImmutableToolPairs } from "./immutable-tool-pairs.js";
import { indexImmutableMessageDisplay } from "./immutable-message-display.js";
import {
  requireImmutableTitleIndex,
  updateImmutableTitleCandidate,
} from "./immutable-title-index.js";
import {
  requireImmutableMessageTailIndex,
  registerImmutableDialogTail,
  appendImmutableMessageTail,
} from "./immutable-message-tail-index.js";

function identityConflict(message) {
  return Object.assign(new Error(message), { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" });
}

function nextOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + 1))
    throw immutableStorageError("Invalid immutable session sequence");
  return value + 1;
}

export class ImmutableSessionChanges {
  constructor(
    get,
    { getMany, getManyMetadata, getMetadata, readContent, readContentMetadata } = {},
  ) {
    this.read = get;
    this.readMany = getMany;
    this.readManyMetadata = getManyMetadata;
    this.readMetadata = getMetadata;
    this.readContent = readContent;
    this.readContentMetadata = readContentMetadata;
    this.pending = new Map();
  }

  async get(collection, key) {
    const change = this.pending.get(JSON.stringify([collection, key]));
    if (!change) return this.read(collection, key);
    if (change.remove === true) return null;
    if (!change.parts?.length) return change.value;
    const value = JSON.parse(JSON.stringify(change.value));
    for (const part of change.parts)
      value[part.path[0]][part.path[1]] = await this.readContent(part.reference);
    return value;
  }

  async getMany(collection, keys) {
    return this.readChangesMany(collection, keys, false);
  }

  async getManyMetadata(collection, keys) {
    return this.readChangesMany(collection, keys, true);
  }

  async readChangesMany(collection, keys, metadata) {
    const unique = [...new Set(keys)];
    const committed = unique.filter((key) => !this.pending.has(JSON.stringify([collection, key])));
    const read = metadata ? this.readManyMetadata : this.readMany;
    const values = committed.length ? await read(collection, committed) : new Map();
    const result = new Map();
    for (const key of unique) {
      if (!this.pending.has(JSON.stringify([collection, key]))) {
        result.set(key, values.get(key));
        continue;
      }
      const value = metadata
        ? await this.getMetadata(collection, key)
        : await this.get(collection, key);
      result.set(key, value);
    }
    return result;
  }

  async getMetadata(collection, key) {
    return this.resolveMetadata(collection, key, () => this.readMetadata(collection, key));
  }

  resolveMetadata(collection, key, readCommitted) {
    const change = this.pending.get(JSON.stringify([collection, key]));
    if (!change) return readCommitted();
    return change.remove === true ? null : { value: change.value, parts: change.parts ?? [] };
  }

  set(collection, key, value, parts = []) {
    this.pending.set(JSON.stringify([collection, key]), {
      collection,
      key,
      value,
      ...(parts.length ? { parts } : {}),
    });
  }

  remove(collection, key) {
    this.pending.set(JSON.stringify([collection, key]), { collection, key, remove: true });
  }

  changes() {
    return [...this.pending.values()].map((change) =>
      Object.hasOwn(change, "reference")
        ? { collection: change.collection, key: change.key, reference: change.reference }
        : change,
    );
  }

  async apply(change) {
    if (change.remove === true) return this.remove(change.collection, change.key);
    if (!Object.hasOwn(change, "reference"))
      return this.set(change.collection, change.key, change.value, change.parts);
    const { value, parts } = await this.readContentMetadata(change.reference);
    this.set(change.collection, change.key, value, parts);
    this.pending.get(JSON.stringify([change.collection, change.key])).reference = change.reference;
  }

  async encode(store, collection, key) {
    const change = this.pending.get(JSON.stringify([collection, key]));
    if (!change || change.remove) throw new TypeError("Cannot encode an absent change");
    if (!Object.hasOwn(change, "reference"))
      change.reference = await store.putCollectionValue(
        collection,
        key,
        change.value,
        change.parts,
      );
    return change.reference;
  }
}

async function registerDialog(plan, facts, message) {
  const key = message.dialogProcessId;
  let dialog = await plan.get("dialogs", key);
  const anchorUid = isDialogAnchorMessageRecord(message) ? message.messageUid : "";
  if (!dialog) {
    facts.dialogSequence = nextOrdinal(facts.dialogSequence);
    await registerImmutableDialogTail(plan, facts, key);
    dialog = {
      dialogProcessId: key,
      dialogOrdinal: facts.dialogSequence,
      turnScopeId: message.turnScopeId,
      userMessageUid: anchorUid,
    };
    plan.set("dialogs", key, dialog);
    plan.set("dialogOrder", immutableOrderKey(dialog.dialogOrdinal), key);
  } else if (anchorUid && !dialog.userMessageUid) {
    dialog = { ...dialog, userMessageUid: anchorUid };
    plan.set("dialogs", key, dialog);
  }
  return dialog;
}

function assertPartitionOwner(owner, identity) {
  if (
    owner &&
    (owner.turnScopeId !== identity.turnScopeId ||
      owner.dialogProcessId !== identity.dialogProcessId ||
      (owner.presentationMessageId &&
        identity.presentationMessageId &&
        owner.presentationMessageId !== identity.presentationMessageId))
  )
    throw Object.assign(new Error("Turn partition identity conflict"), {
      code: "SESSION_TURN_IDENTITY_CONFLICT",
    });
}

async function registerTurn({ plan, facts, message, dialog, dialogAdditions }) {
  let turn = await plan.get("turns", message.turnScopeId);
  const identity = requireTurnPartitionIdentity([message]);
  const lifecycle = await plan.get("lifecycle", message.turnScopeId);
  if (lifecycle !== null) assertTurnRecord(lifecycle);
  assertPartitionOwner(lifecycle, identity);
  assertPartitionOwner(turn, identity);
  if (turn) {
    return {
      ...turn,
      ...(identity.presentationMessageId
        ? { presentationMessageId: identity.presentationMessageId }
        : {}),
    };
  }
  facts.turnSequence = nextOrdinal(facts.turnSequence);
  turn = {
    turnScopeId: message.turnScopeId,
    dialogProcessId: message.dialogProcessId,
    presentationMessageId: identity.presentationMessageId,
    turnOrdinal: facts.turnSequence,
    dialogOrdinal: dialog.dialogOrdinal,
    messageCount: 0,
    messageSequence: 0,
    messagesRoot: null,
    messageOrderRoot: null,
    canonicalAssistantUid: "",
  };
  plan.set("turnOrder", immutableOrderKey(turn.turnOrdinal), message.turnScopeId);
  plan.set("contextSources", message.turnScopeId, { count: 0, root: null });
  if (!dialogAdditions.has(message.dialogProcessId))
    dialogAdditions.set(message.dialogProcessId, []);
  dialogAdditions.get(message.dialogProcessId).push(message.turnScopeId);
  return turn;
}

async function publishDialogTurnIndexes(store, plan, additions) {
  for (const [dialogProcessId, scopes] of additions) {
    const previous = await plan.get("dialogTurns", dialogProcessId);
    let count = previous?.count ?? 0;
    const entries = [];
    for (const scope of scopes) {
      count = nextOrdinal(count);
      entries.push([immutableOrderKey(count), await store.objects.putValue(scope)]);
    }
    const root = await store.index.setMany(previous?.root ?? null, entries);
    plan.set("dialogTurns", dialogProcessId, { count, root });
  }
}

export async function demotePreviousPresentation(plan, turn, message) {
  if (!canonicalAssistantPresentationIdentity(message)) {
    if (turn.canonicalAssistantUid === message.messageUid) turn.canonicalAssistantUid = "";
    return;
  }
  assertCanonicalAssistantPresentation(message);
  if (turn.canonicalAssistantUid && turn.canonicalAssistantUid !== message.messageUid) {
    const stored = await plan.getMetadata("messages", turn.canonicalAssistantUid);
    if (!stored) throw immutableStorageError("Canonical presentation references a missing message");
    const { value: previous, parts } = stored;
    const demoted = { ...previous.message, chatPresentation: false };
    delete demoted.workspaceRootDirectory;
    plan.set("messages", demoted.messageUid, { ...previous, message: demoted }, parts);
  }
  turn.canonicalAssistantUid = message.messageUid;
}

function mergeStoredMessage(previous, message, parts) {
  if (!previous) return message;
  assertCommittedMessageIdentity(previous.message, message);
  const merged = { ...previous.message, ...message, ts: previous.message.ts };
  if (merged.chatPresentation === false) delete merged.workspaceRootDirectory;
  return normalizeMessageMetadataEntity({ value: { message: merged }, parts }).message;
}

export async function publishMessageIndexes(store, plan, additions = new Map()) {
  const groups = new Map();
  for (const change of plan.changes()) {
    if (change.collection !== "messages" || change.remove) continue;
    const { value, parts } = await plan.getMetadata("messages", change.key);
    plan.set(
      "messages",
      change.key,
      await indexImmutableMessageDisplay(store.objects, value, parts),
      parts,
    );
    const scope = value.message.turnScopeId;
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push([change.key, await plan.encode(store, "messages", change.key)]);
  }
  for (const [scope, entries] of groups) {
    const turn = await plan.get("turns", scope);
    const order = [];
    for (const [key, uid] of additions.get(scope) ?? [])
      order.push([key, await store.objects.putValue(uid)]);
    const candidates = [];
    for (const [key, reference] of entries) {
      const { value } = await plan.getMetadata("messages", key);
      candidates.push([key, isContextSourceMessageCandidate(value.message) ? reference : null]);
    }
    await updateImmutableContextSource(store, plan, scope, candidates);
    plan.set("turns", scope, {
      ...turn,
      messagesRoot: await store.index.setMany(turn.messagesRoot, entries),
      messageOrderRoot: await store.index.setMany(turn.messageOrderRoot, order),
    });
  }
}

async function storePreparedMessage({ store, plan, record, parts, preserved }) {
  const { message } = record;
  if (!parts.length) {
    plan.set("messages", message.messageUid, record);
    return;
  }
  const reference = await store.objects.putValueBytes(
    Buffer.from(JSON.stringify(message.content)),
    {
      previousReference: requireImmutableMessageContentPart(parts).reference,
    },
  );
  plan.set("messages", message.messageUid, { ...record, message: { ...message, content: null } }, [
    { path: requireImmutableMessageContentPart(parts).path, reference },
    ...preserved,
  ]);
}

async function allocateMessageOrdinals({ plan, facts, turn, message, additions, previous }) {
  if (previous) return { ordinal: previous.ordinal, turnOrdinal: previous.turnOrdinal };
  facts.messageSequence = nextOrdinal(facts.messageSequence);
  await appendImmutableMessageTail(plan, message);
  facts.messageCount = nextOrdinal(facts.messageCount);
  turn.messageCount = nextOrdinal(turn.messageCount);
  turn.messageSequence = nextOrdinal(turn.messageSequence);
  const ordinal = facts.messageSequence;
  const turnOrdinal = turn.messageSequence;
  plan.set("messageOrder", immutableOrderKey(ordinal), message.messageUid);
  if (!additions.has(message.turnScopeId)) additions.set(message.turnScopeId, []);
  additions.get(message.turnScopeId).push([immutableOrderKey(turnOrdinal), message.messageUid]);
  return { ordinal, turnOrdinal };
}

export async function prepareImmutableMessages({ store, get, getMetadata, messages, updatedAt }) {
  if (messages.length === 0) return { changes: [], result: { turns: [] } };
  const plan = new ImmutableSessionChanges(get, {
    getMetadata,
    readContent: (reference) => store.objects.readValue(reference),
  });
  const metadata = await plan.get("metadata", "session");
  const storedFacts = await plan.get("metadata", "facts");
  if (!metadata || !storedFacts)
    throw immutableStorageError("Immutable session is not initialized");
  const facts = { ...storedFacts };
  await requireImmutableMessageTailIndex(plan);
  await requireImmutableTitleIndex(plan, store.requireReference);
  const persisted = [];
  const additions = new Map();
  const dialogAdditions = new Map();
  for (const input of messages) {
    let message = normalizeMessageEntity(input);
    if (
      message.sessionId !== store.sessionId ||
      message.parentSessionId !== metadata.parentSessionId
    )
      throw identityConflict("Message session ownership mismatch");
    const stored = await plan.getMetadata("messages", message.messageUid);
    const previous = stored?.value ?? null;
    const preserved = (stored?.parts ?? []).filter(
      ({ path }) => path[1] !== "content" && !Object.hasOwn(message, path[1]),
    );
    message = mergeStoredMessage(previous, message, preserved);
    const dialog = await registerDialog(plan, facts, message);
    const turn = await registerTurn({ plan, facts, message, dialog, dialogAdditions });
    const { ordinal, turnOrdinal } = await allocateMessageOrdinals({
      plan,
      facts,
      turn,
      message,
      additions,
      previous,
    });
    await demotePreviousPresentation(plan, turn, message);
    await updateImmutableToolPairs(store, plan, previous?.message, message);
    await updateImmutableTitleCandidate(store, plan, previous, { ordinal, turnOrdinal, message });
    await storePreparedMessage({
      store,
      plan,
      record: { ordinal, turnOrdinal, message },
      parts: stored?.parts ?? [],
      preserved,
    });
    plan.set("turns", message.turnScopeId, turn);
    if (
      dialog.dialogOrdinal > facts.lastDialogOrdinal ||
      (dialog.dialogOrdinal === facts.lastDialogOrdinal && ordinal >= facts.lastMessageOrdinal)
    ) {
      facts.lastDialogOrdinal = dialog.dialogOrdinal;
      facts.lastMessageOrdinal = ordinal;
      facts.lastMessageUid = message.messageUid;
    }
    persisted.push(message.messageUid);
    if (!metadata.autoTitle) metadata.autoTitle = resolveSessionAutoTitle(message) || "";
  }
  await publishDialogTurnIndexes(store, plan, dialogAdditions);
  await publishMessageIndexes(store, plan, additions);
  plan.set("metadata", "facts", facts);
  plan.set("metadata", "session", { ...metadata, updatedAt });
  return { changes: plan.changes(), result: { turns: persisted } };
}
