/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { assertAgentTurnMessages } from "@noobot/agent-transport-protocol/agent-turn-result";

function applyPatch(item, patch) {
  if (!isPlainObject(patch))
    throw new TypeError("current turn message patch must be a plain object");
  const nextItem = { ...item };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete nextItem[key];
    else nextItem[key] = value;
  }
  return nextItem;
}

function cloneMessages(messages) {
  return assertAgentTurnMessages(messages).map((message) => ({ ...message }));
}

export function createCurrentTurnMessagesStore(messages = []) {
  const items = cloneMessages(messages);
  function replace(messagesToKeep) {
    const nextItems = cloneMessages(messagesToKeep);
    items.splice(0, items.length, ...nextItems);
    return items.length;
  }
  return {
    push(message) {
      const nextItems = cloneMessages([...items, message]);
      const next = nextItems[nextItems.length - 1];
      items.push(next);
      return next;
    },
    updateLast(patch = {}, matcher = null) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (typeof matcher === "function" && !matcher(items[index])) continue;
        const nextItems = [...items];
        nextItems[index] = applyPatch(items[index], patch);
        assertAgentTurnMessages(nextItems);
        items[index] = nextItems[index];
        return items[index];
      }
      return null;
    },
    updateWhere(patch = {}, matcher = null) {
      let updatedCount = 0;
      const nextItems = items.map((item, index) => {
        if (typeof matcher === "function" && !matcher(item, index)) return item;
        updatedCount += 1;
        return applyPatch(item, patch);
      });
      assertAgentTurnMessages(nextItems);
      items.splice(0, items.length, ...nextItems);
      return updatedCount;
    },
    replaceAll: replace,
    toArray() {
      return cloneMessages(items);
    },
  };
}

export function requireCurrentTurnMessagesStore(currentTurnMessages) {
  if (
    currentTurnMessages &&
    typeof currentTurnMessages.push === "function" &&
    typeof currentTurnMessages.updateLast === "function" &&
    typeof currentTurnMessages.updateWhere === "function" &&
    typeof currentTurnMessages.toArray === "function"
  )
    return currentTurnMessages;
  throw new Error("turn execution requires the canonical currentTurnMessages store");
}
