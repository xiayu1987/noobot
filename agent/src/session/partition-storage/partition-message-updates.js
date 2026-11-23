/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { messageContentReadError } from "@noobot/session-protocol/message-read-budget";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  partitionMessageContentVersion,
  readPartitionMessagePositionVisibility,
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { applyMessageMetadataUpdate } from "@noobot/session-protocol/session-changes";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";
import { preparePartitionContentWrite } from "./partition-message-content.js";
import { rejectMessageInput } from "./partition-message-input.js";
import { checkMessage } from "./partition-message-reader.js";
import { partitionMessageMetadataEntity } from "./partition-message-record.js";

function updateMetadata(message, update) {
  try {
    const entity = partitionMessageMetadataEntity(applyMessageMetadataUpdate(message, update));
    const {
      message: { content: _deferred, ...metadata },
    } = normalizeMessageMetadataEntity(entity);
    return metadata;
  } catch (cause) {
    rejectMessageInput(cause);
  }
}

async function updateMessage({
  view,
  snapshot,
  generation,
  append,
  replacement,
  update,
  existing,
  record,
  mutations,
}) {
  const contentWrite = append ?? replacement;
  const request = contentWrite ?? update;
  const { messageUid, expectedContentReference } = request;
  if (record.contentVersion !== expectedContentReference)
    throw messageContentReadError("version", "Message content version conflict");
  const contentPlan = contentWrite
    ? await preparePartitionContentWrite(view, record, contentWrite.content, Boolean(replacement))
    : { fields: {}, mutations: [] };
  const next = { ...record, ...contentPlan.fields };
  if (update) next.message = updateMetadata(record.message, update);
  if (contentWrite) {
    next.contentVersion = partitionMessageContentVersion(
      snapshot.epoch,
      generation,
      mutations.length,
    );
  }
  const { owner = null } = existing;
  mutations.push({ collection: collections.messages, key: messageUid, value: next, owner });
  mutations.push(...contentPlan.mutations);
}

async function prepareMessageUpdatePage(
  view,
  read,
  state,
  { entities, appends, replacements, updates },
) {
  const { snapshot, scope } = state;
  const records = await view.getLatestByOwner({ collection: collections.messages, entities });
  const writes = entities.map(({ key }) => ({
    existing: records.get(key),
    append: appends.get(key),
    replacement: replacements.get(key),
    update: updates.get(key),
  }));
  const previous = writes.map(({ existing, append, replacement, update }) => {
    if (existing.mutation.remove)
      throw messageContentReadError("missing", "Content message does not exist");
    return checkMessage(existing.mutation.value, {
      ...(append ?? replacement ?? update),
      snapshot,
      scope,
      generation: view.generation,
    });
  });
  const count = await readPartitionSessionMessageCount(read);
  const visible = await readPartitionMessagePositionVisibility(read, scope.sessionId, count, {
    records: previous,
  });
  if (visible.includes(false))
    throw messageContentReadError("missing", "Content message does not exist");
  await requirePartitionVisibleMessageTurnOwnership(read, previous);
  for (const [index, write] of writes.entries())
    await updateMessage({ ...state, view, ...write, record: previous[index] });
}

export async function prepareMessageUpdates(
  view,
  read,
  state,
  { entities, appends, replacements, updates },
) {
  for (let offset = 0; offset < entities.length; offset += view.pageRecords) {
    await prepareMessageUpdatePage(view, read, state, {
      entities: entities.slice(offset, offset + view.pageRecords),
      appends,
      replacements,
      updates,
    });
  }
}
