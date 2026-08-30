/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function applyPatch(item = {}, patch = {}) {
  const nextItem = { ...item };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) delete nextItem[key];
    else nextItem[key] = value;
  }
  return nextItem;
}

function cloneItems(values = []) {
  return (Array.isArray(values) ? values : []).map((item) => ({ ...(item || {}) }));
}

function createCurrentTurnStore(values = []) {
  const items = cloneItems(values);
  return {
    items,
    push(value = {}) {
      const normalizedValue = value && typeof value === "object" ? { ...value } : {};
      items.push(normalizedValue);
      return normalizedValue;
    },
    updateLast(patch = {}, matcher = null) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (typeof matcher === "function" && !matcher(items[index] || {})) continue;
        items[index] = applyPatch(items[index], patch);
        return items[index];
      }
      return null;
    },
    toArray() {
      return cloneItems(items);
    },
  };
}

export function createCurrentTurnMessagesStore(messages = []) {
  const store = createCurrentTurnStore(messages);
  const { items } = store;
  return {
    push: store.push,
    updateLast: store.updateLast,
    removeLast(matcher = null) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (typeof matcher === "function" && !matcher(items[index] || {})) continue;
        const [removed] = items.splice(index, 1);
        return removed ? { ...removed } : null;
      }
      return null;
    },
    updateWhere(patch = {}, matcher = null) {
      let updatedCount = 0;
      for (let index = 0; index < items.length; index += 1) {
        if (typeof matcher === "function" && !matcher(items[index] || {}, index)) continue;
        items[index] = applyPatch(items[index], patch);
        updatedCount += 1;
      }
      return updatedCount;
    },
    replaceAll(messagesToKeep = []) {
      const nextItems = cloneItems(messagesToKeep);
      items.splice(0, items.length, ...nextItems);
      return items.length;
    },
    toArray: store.toArray,
  };
}

export function createCurrentTurnTasksStore(tasks = []) {
  const store = createCurrentTurnStore(tasks);
  const { items } = store;
  return {
    push: store.push,
    updateLast: store.updateLast,
    last() {
      return items.length ? { ...(items[items.length - 1] || {}) } : null;
    },
    toArray: store.toArray,
  };
}

export function requireCurrentTurnMessagesStore(currentTurnMessages) {
  if (
    currentTurnMessages &&
    typeof currentTurnMessages.push === "function" &&
    typeof currentTurnMessages.updateLast === "function" &&
    typeof currentTurnMessages.removeLast === "function" &&
    typeof currentTurnMessages.updateWhere === "function" &&
    typeof currentTurnMessages.toArray === "function"
  )
    return currentTurnMessages;
  throw new Error("turn execution requires the canonical currentTurnMessages store");
}

export function requireCurrentTurnTasksStore(currentTurnTasks) {
  if (
    currentTurnTasks &&
    typeof currentTurnTasks.push === "function" &&
    typeof currentTurnTasks.updateLast === "function" &&
    typeof currentTurnTasks.last === "function" &&
    typeof currentTurnTasks.toArray === "function"
  )
    return currentTurnTasks;
  throw new Error("turn execution requires the canonical currentTurnTasks store");
}
