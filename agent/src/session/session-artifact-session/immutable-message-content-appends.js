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
import { resolveSessionAutoTitle, SESSION_AUTO_TITLE_MAX_LENGTH } from "@noobot/session-protocol";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { requireImmutableMessageContentPart } from "@noobot/session-protocol/immutable-storage-graph";
import { publishMessageIndexes, demotePreviousPresentation } from "./immutable-message-changes.js";
import { updateImmutableTitleCandidate } from "./immutable-title-index.js";
import {
  appendImmutableStringContent,
  readImmutableStringPrefix,
} from "./immutable-string-content.js";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";

function requireStoredMessageContent(store, stored, request) {
  store.requireReference(request.expectedContentReference);
  if (!stored)
    throw Object.assign(new Error("Content append message does not exist"), {
      code: "SESSION_MESSAGE_NOT_FOUND",
    });
  const { value, parts } = stored;
  const { message } = value;
  if (
    message.messageUid !== request.messageUid ||
    message.sessionId !== store.sessionId ||
    message.dialogProcessId !== request.dialogProcessId ||
    message.turnScopeId !== request.turnScopeId
  )
    throw Object.assign(new Error("Content append message ownership mismatch"), {
      code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
    });
  const content = requireImmutableMessageContentPart(parts);
  if (content.reference !== request.expectedContentReference)
    throw Object.assign(new Error("Message content version conflict"), {
      code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
    });
  return stored;
}

async function updateMessageMetadata(plan, value, parts, update) {
  const { message } = value;
  const next = normalizeMessageMetadataEntity({
    value: { ...value, message: applyMessageMetadataUpdate(message, update) },
    parts,
  });
  const turn = await plan.get("turns", message.turnScopeId);
  if (!turn) throw immutableStorageError("Message metadata references a missing turn");
  await demotePreviousPresentation(plan, turn, next.message);
  plan.set("turns", message.turnScopeId, turn);
  return next;
}

async function updateAppendedTitle(store, plan, metadata, { append, value, next, reference }) {
  const { message } = value;
  const appendedTitle = append && resolveSessionAutoTitle({ ...message, content: append.content });
  if (appendedTitle) {
    await updateImmutableTitleCandidate(store, plan, value, {
      ...next,
      message: { ...next.message, content: append.content },
    });
    if (!metadata.autoTitle)
      metadata.autoTitle = await readImmutableStringPrefix(
        store.objects,
        reference,
        SESSION_AUTO_TITLE_MAX_LENGTH,
      );
  }
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
    const next = update ? await updateMessageMetadata(plan, value, preserved, update) : value;
    plan.set(
      "messages",
      request.messageUid,
      next,
      preserved.map((part) => (part === content ? { path: part.path, reference } : part)),
    );
    await updateAppendedTitle(store, plan, metadata, { append, value, next, reference });
    identities.push(request.messageUid);
  }
  await publishMessageIndexes(store, plan);
  plan.set("metadata", "session", { ...metadata, updatedAt: committedAt });
  return { messages: identities };
}
