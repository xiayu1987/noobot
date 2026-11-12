/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { getMessageAttachments } from "../../model/messageModel.js";
import { selectToolLinkSnapshots } from "../../runtime/engine/toolTimeline.js";
import { buildAttachmentRefIndex } from "./attachmentInlineRefPlugin.js";

const messageResources = new WeakMap();
const sessionResources = new WeakMap();
const attachmentIndexes = new WeakMap();

function indexAttachment(attachment, userId) {
  let users = attachmentIndexes.get(attachment);
  if (!users) {
    users = new Map();
    attachmentIndexes.set(attachment, users);
  }
  let index = users.get(userId);
  if (!index) {
    index = computed(() => buildAttachmentRefIndex([attachment], { userId }));
    users.set(userId, index);
  }
  return index.value;
}

function appendAttachments(index, attachments, userId) {
  for (const attachment of attachments) {
    for (const [key, value] of indexAttachment(attachment, userId)) index.set(key, value);
  }
}

function resourcesForMessage(message) {
  let resources = messageResources.get(message);
  if (!resources) {
    resources = {
      attachments: computed(() => getMessageAttachments(message)),
      links: computed(() => selectToolLinkSnapshots(message, 0)),
    };
    messageResources.set(message, resources);
  }
  return resources;
}

function identityKey(message) {
  return JSON.stringify([getMessageRole(message), getMessageTurnScopeId(message)]);
}

function createSessionResources(messages) {
  const positions = computed(() => {
    const objects = new Map();
    const identities = new Map();
    messages.forEach((message, index) => {
      if (!objects.has(message)) objects.set(message, index);
      const key = identityKey(message);
      if (getMessageRole(message) && getMessageTurnScopeId(message) && !identities.has(key))
        identities.set(key, index);
    });
    return { objects, identities };
  });
  function messageIndex(message) {
    const { objects, identities } = positions.value;
    const identityIndex = identities.get(identityKey(message));
    const objectIndex = objects.get(message);
    const index = Math.min(objectIndex ?? Infinity, identityIndex ?? Infinity);
    if (!Number.isFinite(index)) throw new Error("message_not_in_session_messages");
    return index;
  }
  const assistantsByTurn = computed(() => {
    const turns = new Map();
    for (const message of messages) {
      if (getMessageRole(message) !== "assistant") continue;
      const key = JSON.stringify([getMessageSessionId(message), getMessageTurnScopeId(message)]);
      if (!turns.has(key)) turns.set(key, []);
      turns.get(key).push(message);
    }
    return turns;
  });
  function siblingAssistants(message) {
    const key = JSON.stringify([getMessageSessionId(message), getMessageTurnScopeId(message)]);
    return (assistantsByTurn.value.get(key) || []).filter((candidate) => candidate !== message);
  }
  const precedingIndexes = new Map();
  function indexesForUser(userId) {
    let indexes = precedingIndexes.get(userId);
    if (!indexes) {
      indexes = computed(() => {
        let preceding = new Map();
        return messages.map((message) => {
          const visible = preceding;
          if (getMessageRole(message) === "assistant") {
            const attachments = resourcesForMessage(message).attachments.value;
            if (attachments.length) {
              preceding = new Map(preceding);
              appendAttachments(preceding, attachments, userId);
            }
          }
          return visible;
        });
      });
      precedingIndexes.set(userId, indexes);
    }
    return indexes.value;
  }
  const linkSnapshots = computed(() =>
    messages.flatMap((message, messageIndex) =>
      getMessageRole(message) === "assistant"
        ? resourcesForMessage(message).links.value.map((link) => ({ ...link, messageIndex }))
        : [],
    ),
  );
  function attachmentRefIndex(message, displayedAttachments, userId) {
    const index = new Map(indexesForUser(userId)[messageIndex(message)]);
    appendAttachments(index, displayedAttachments, userId);
    return index;
  }
  return { messageIndex, linkSnapshots, attachmentRefIndex, siblingAssistants };
}

export function useSessionMessageResources(messages) {
  let resources = sessionResources.get(messages);
  if (!resources) {
    resources = createSessionResources(messages);
    sessionResources.set(messages, resources);
  }
  return resources;
}
