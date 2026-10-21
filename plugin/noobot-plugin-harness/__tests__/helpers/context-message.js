/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CONTEXT_MESSAGE_NATIVE_FIELDS,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";

const NATIVE_FIELDS = new Set(CONTEXT_MESSAGE_NATIVE_FIELDS);

export function contextMessage(fields = {}) {
  const message = {};
  const metadata = { ...(fields.additional_kwargs || {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "additional_kwargs") continue;
    if (NATIVE_FIELDS.has(key)) message[key] = value;
    else metadata[key] = value;
  }
  message.additional_kwargs = metadata;
  return message;
}

export function canonicalizeTestContextMessage(message = {}) {
  if (!message || typeof message !== "object") return message;
  const metadata = { ...(message.additional_kwargs || {}) };
  for (const key of Object.keys(message)) {
    if (key === "additional_kwargs" || NATIVE_FIELDS.has(key)) continue;
    metadata[key] = message[key];
    delete message[key];
  }
  message.additional_kwargs = {};
  return writeContextMessageMetadata(message, {
    ...metadata,
    messageUid: metadata.messageUid || createMessageUid(),
  });
}

export function canonicalizeTestMessageBlocks(blocks = {}) {
  for (const name of ["system", "history", "incremental"]) {
    for (const message of Array.isArray(blocks?.[name]) ? blocks[name] : []) {
      canonicalizeTestContextMessage(message);
    }
  }
  return blocks;
}
