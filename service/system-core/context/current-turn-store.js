/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createCurrentTurnMessagesStore(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  return {
    push(message = {}) {
      const normalizedMessage =
        message && typeof message === "object" ? { ...message } : {};
      items.push(normalizedMessage);
      return normalizedMessage;
    },
    updateLast(patch = {}, matcher = null) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index] || {};
        if (typeof matcher === "function" && !matcher(item)) continue;
        items[index] = { ...item, ...(patch || {}) };
        return items[index];
      }
      return null;
    },
    toArray() {
      return items.map((item) => ({ ...item }));
    },
  };
}

export function createCurrentTurnTasksStore(tasks = []) {
  const items = Array.isArray(tasks) ? tasks : [];
  return {
    push(task = {}) {
      const normalizedTask = task && typeof task === "object" ? { ...task } : {};
      items.push(normalizedTask);
      return normalizedTask;
    },
    updateLast(patch = {}, matcher = null) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index] || {};
        if (typeof matcher === "function" && !matcher(item)) continue;
        items[index] = { ...item, ...(patch || {}) };
        return items[index];
      }
      return null;
    },
    last() {
      if (!items.length) return null;
      return { ...(items[items.length - 1] || {}) };
    },
    toArray() {
      return items.map((item) => ({ ...item }));
    },
  };
}

export function resolveTurnMessagesStore(currentTurnMessages, fallbackMessages = []) {
  const isValidStore =
    currentTurnMessages &&
    typeof currentTurnMessages.push === "function" &&
    typeof currentTurnMessages.updateLast === "function" &&
    typeof currentTurnMessages.toArray === "function";
  if (isValidStore) return currentTurnMessages;
  return createCurrentTurnMessagesStore(fallbackMessages);
}

export function resolveTurnTasksStore(currentTurnTasks, fallbackTasks = []) {
  const isValidStore =
    currentTurnTasks &&
    typeof currentTurnTasks.push === "function" &&
    typeof currentTurnTasks.updateLast === "function" &&
    typeof currentTurnTasks.last === "function" &&
    typeof currentTurnTasks.toArray === "function";
  if (isValidStore) return currentTurnTasks;
  return createCurrentTurnTasksStore(fallbackTasks);
}

