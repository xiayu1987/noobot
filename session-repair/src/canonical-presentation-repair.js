/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export function repairCanonicalAssistantPresentations(document) {
  const next = structuredClone(document);
  const { messages } = next;
  const canonicalIndexes = new Map();
  messages.forEach((message, index) => {
    if (
      text(message.role) !== "assistant" ||
      message.chatPresentation !== true ||
      !text(message.turnScopeId)
    )
      return;
    const turnScopeId = text(message.turnScopeId);
    const indexes = canonicalIndexes.get(turnScopeId) || [];
    indexes.push(index);
    canonicalIndexes.set(turnScopeId, indexes);
  });
  const repaired = [];
  for (const [turnScopeId, indexes] of canonicalIndexes) {
    if (indexes.length < 2) continue;
    const authoritativePresentationMessageId = text(
      next.turnLifecycle.turns[turnScopeId]?.presentationMessageId,
    );
    const authoritativeIndex = indexes.find(
      (index) => text(messages[index].presentationMessageId) === authoritativePresentationMessageId,
    );
    if (!authoritativePresentationMessageId || authoritativeIndex === undefined) {
      throw Object.assign(
        new Error(`canonical assistant presentation repair is ambiguous for Turn ${turnScopeId}`),
        {
          code: SESSION_REPAIR_ERROR_CODE.CANONICAL_PRESENTATION_REPAIR_AMBIGUOUS,
        },
      );
    }
    indexes
      .filter((index) => index !== authoritativeIndex)
      .forEach((index) => {
        messages[index] = { ...messages[index], chatPresentation: false };
      });
    repaired.push(turnScopeId);
  }
  return { document: next, changed: repaired.length > 0, repaired };
}
