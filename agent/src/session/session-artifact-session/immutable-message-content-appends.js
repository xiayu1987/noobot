/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireMessageContentAppend,
  requireMessageMetadataUpdate,
  applyMessageMetadataUpdate,
} from "@noobot/session-protocol/session-changes";
import {
  resolveSessionAutoTitle,
  SESSION_AUTO_TITLE_MAX_CODE_UNITS,
  SESSION_AUTO_TITLE_MAX_LENGTH,
} from "@noobot/session-protocol";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { messageContentReadError } from "@noobot/session-protocol/message-read-budget";
import {
  requireImmutableMessageContentPart,
  requireImmutableValueBytePage,
} from "@noobot/session-protocol/immutable-storage-graph";
import { publishMessageIndexes, demotePreviousPresentation } from "./immutable-message-changes.js";
import { indexImmutableMessageDisplay } from "./immutable-message-display.js";
import { updateImmutableTitleCandidate } from "./immutable-title-index.js";
import {
  appendImmutableStringContent,
  readImmutableStringPrefix,
} from "./immutable-string-content.js";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";

function requireStoredMessageContent(store, stored, request) {
  if (!stored)
    throw Object.assign(new Error("Content append message does not exist"), {
      code: "SESSION_MESSAGE_NOT_FOUND",
    });
  const { value, parts } = stored;
  const { message } = value;
  if (
    message.messageUid !== request.messageUid ||
    message.sessionId !== store.sessionId ||
    value.ordinal !== request.owner ||
    message.dialogProcessId !== request.dialogProcessId ||
    message.turnScopeId !== request.turnScopeId
  )
    throw Object.assign(new Error("Content append message ownership mismatch"), {
      code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
    });
  const content = requireImmutableMessageContentPart(parts);
  if (content.reference !== request.expectedContentReference)
    throw messageContentReadError("version", "Message content version conflict");
  return stored;
}

async function updateMessageMetadata(store, plan, { value, parts, update }) {
  const { message } = value;
  const next = normalizeMessageMetadataEntity({
    value: { ...value, message: applyMessageMetadataUpdate(message, update) },
    parts,
  });
  const turn = await plan.get("turns", message.turnScopeId);
  if (!turn) throw immutableStorageError("Message metadata references a missing turn");
  await demotePreviousPresentation(plan, turn, next.message);
  plan.set("turns", message.turnScopeId, turn);
  return Object.hasOwn(update.metadata, "toolTimeline") ||
    update.metadataRemovals.includes("toolTimeline")
    ? indexImmutableMessageDisplay(store.objects, next, parts)
    : next;
}

async function updateAppendedTitle(store, plan, { append, value, next, before, after }) {
  const { message } = value;
  const appendedTitle = append && resolveSessionAutoTitle({ ...message, content: append.content });
  if (!appendedTitle) return;
  const { bytes } = requireImmutableValueBytePage(await store.objects.readPage(before));

  if (bytes >= 6 * (SESSION_AUTO_TITLE_MAX_LENGTH - 1) + 3) return;
  const content = await readImmutableStringPrefix(
    store.objects,
    after,
    SESSION_AUTO_TITLE_MAX_CODE_UNITS,
  );
  const candidate = { ...next, message: { ...next.message, content } };
  await updateImmutableTitleCandidate(store, plan, value, candidate);
}

export async function prepareImmutableMessageUpdates({
  store,
  plan,
  appends,
  metadataUpdates,
  committedAt,
}) {
  const metadata = await plan.get("metadata", "session");
  const contentByUid = new Map(
    appends.map((request) => [request.messageUid, requireMessageContentAppend(request)]),
  );
  const metadataByUid = new Map(
    metadataUpdates.map((request) => [request.messageUid, requireMessageMetadataUpdate(request)]),
  );
  const identities = [];
  const uids = [...new Set([...contentByUid.keys(), ...metadataByUid.keys()])];
  const storedMessages = await plan.getManyMetadata("messages", uids);
  for (const uid of uids) {
    const append = contentByUid.get(uid);
    const update = metadataByUid.get(uid);
    const request = append ?? update;
    const stored = plan.resolveMetadata("messages", uid, () => storedMessages.get(uid));
    const { value, parts } = requireStoredMessageContent(store, stored, request);
    const content = requireImmutableMessageContentPart(parts);
    const reference = append
      ? await appendImmutableStringContent(store.objects, content.reference, append.content)
      : content.reference;
    const preserved = parts.filter(
      ({ path }) =>
        !update ||
        (!Object.hasOwn(update.metadata, path[1]) && !update.metadataRemovals.includes(path[1])),
    );
    const next = update
      ? await updateMessageMetadata(store, plan, { value, parts: preserved, update })
      : value;
    plan.set(
      "messages",
      request.messageUid,
      next,
      preserved.map((part) => (part === content ? { path: part.path, reference } : part)),
    );
    await updateAppendedTitle(store, plan, {
      append,
      value,
      next,
      before: content.reference,
      after: reference,
    });
    identities.push(request.messageUid);
  }
  await publishMessageIndexes(store, plan);
  plan.set("metadata", "session", { ...metadata, updatedAt: committedAt });
  return { messages: identities };
}
