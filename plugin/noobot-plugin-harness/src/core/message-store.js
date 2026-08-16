/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  appendContextMessage,
  replaceContextMessages,
  replaceContextProjection,
  writeContextBlocks,
} from "@noobot/context-protocol/mutation/context";
import { resolveContextMessageId } from "@noobot/context-protocol/message/codec";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "@noobot/context-protocol/agent-context/schema";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/assembly/hook-context";

function resolveHolder(ctx = {}) {
  const modelContext = resolveAuthoritativeModelContext(ctx);
  if (!modelContext) {
    throw new TypeError(
      `Harness model-message operations require modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`,
    );
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
    throw new TypeError("Harness modelContext requires canonical messageBlocks");
  }
  return modelContext.messageBlocks;
}

export { resolveContextMessageId as getMessageId };

export const appendMessage = (ctx, ...args) => appendContextMessage(resolveHolder(ctx), ...args);
export const replaceMessages = (ctx, ...args) =>
  replaceContextMessages(resolveHolder(ctx), ...args);
export const replaceMessageProjection = (ctx, ...args) =>
  replaceContextProjection(resolveHolder(ctx), ...args);
export const writeMessageBlocks = (ctx, ...args) => writeContextBlocks(resolveHolder(ctx), ...args);
export const resolveMessagesByIds = (ctx, ids = []) => {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()));
  const modelContext = resolveHolder(ctx);
  const candidates = [
    ...resolveModelMessages(ctx),
    ...Object.values(modelContext.messageBlocks).flatMap((messages) =>
      Array.isArray(messages) ? messages : [],
    ),
  ];
  const seen = new Set();
  return candidates.filter((message) => {
    const id = resolveContextMessageId(message);
    if (!wanted.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
