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
import { requireAuthoritativeModelContext as resolveHolder } from "@noobot/context-protocol/assembly/hook-context";

export function resolveModelMessages(ctx) {
  const modelContext = resolveHolder(ctx);
  return modelContext.messages;
}

export function resolveModelMessageBlocks(ctx) {
  const modelContext = resolveHolder(ctx);
  return modelContext.messageBlocks;
}

export const appendMessage = (ctx, ...args) => appendContextMessage(resolveHolder(ctx), ...args);
export const replaceMessages = (ctx, ...args) =>
  replaceContextMessages(resolveHolder(ctx), ...args);
export const replaceMessageProjection = (ctx, ...args) =>
  replaceContextProjection(resolveHolder(ctx), ...args);
export const writeMessageBlocks = (ctx, ...args) => writeContextBlocks(resolveHolder(ctx), ...args);
