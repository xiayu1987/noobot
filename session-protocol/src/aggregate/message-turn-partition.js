/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export function partitionMessagesByTurnIdentity(messages = []) {
  const partitions = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const turnScopeId = clean(message?.turnScopeId);
    const dialogProcessId = clean(message?.dialogProcessId);
    if (!turnScopeId || !dialogProcessId) throw new TypeError("message turn identity is incomplete");
    const existing = partitions.get(turnScopeId);
    if (existing && existing.dialogProcessId !== dialogProcessId) throw new TypeError("turn scope maps to multiple dialog processes");
    if (!existing) partitions.set(turnScopeId, { turnScopeId, dialogProcessId, messages: [] });
    partitions.get(turnScopeId).messages.push(message);
  }
  return [...partitions.values()];
}
