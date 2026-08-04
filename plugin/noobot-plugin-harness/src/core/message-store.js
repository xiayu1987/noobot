/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  appendMessage as protocolAppendMessage,
  canonicalizeMessageStore as protocolCanonicalizeMessageStore,
  getMessageId,
  replaceMessageProjection as protocolReplaceMessageProjection,
  replaceMessages as protocolReplaceMessages,
  resolveMessagesByIds as protocolResolveMessagesByIds,
  writeMessageBlocks as protocolWriteMessageBlocks,
} from "@noobot/context-protocol/message-store";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/hook-context";

function resolveHolder(ctx = {}) {
  const modelContext = resolveAuthoritativeModelContext(ctx);
  if (!modelContext) {
    throw new TypeError("Harness model-message operations require contextProtocolVersion=1 modelContext");
  }
  return modelContext;
}

export function resolveModelContext(ctx = {}) {
  return resolveHolder(ctx);
}

export function resolveModelMessages(ctx = {}) {
  const modelContext = resolveHolder(ctx);
  return Array.isArray(modelContext.messages) ? modelContext.messages : [];
}

export function resolveModelMessageBlocks(ctx = {}) {
  const modelContext = resolveHolder(ctx);
  if (!modelContext.messageBlocks || typeof modelContext.messageBlocks !== "object") {
    modelContext.messageBlocks = { system: [], history: [], incremental: [] };
  }
  return modelContext.messageBlocks;
}

export {
  getMessageId,
};

export const appendMessage = (ctx, ...args) => protocolAppendMessage(resolveHolder(ctx), ...args);
export const canonicalizeMessageStore = (ctx, ...args) => protocolCanonicalizeMessageStore(resolveHolder(ctx), ...args);
export const replaceMessages = (ctx, ...args) => protocolReplaceMessages(resolveHolder(ctx), ...args);
export const replaceMessageProjection = (ctx, ...args) => protocolReplaceMessageProjection(resolveHolder(ctx), ...args);
export const resolveMessagesByIds = (ctx, ...args) => protocolResolveMessagesByIds(resolveHolder(ctx), ...args);
export const writeMessageBlocks = (ctx, ...args) => protocolWriteMessageBlocks(resolveHolder(ctx), ...args);
