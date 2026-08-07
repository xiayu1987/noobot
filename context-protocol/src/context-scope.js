/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) { return String(value ?? "").trim(); }

export function createContextScope({
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
} = {}) {
  return Object.freeze({
    sessionId: text(sessionId),
    parentSessionId: text(parentSessionId),
    dialogProcessId: text(dialogProcessId),
    turnScopeId: text(turnScopeId),
  });
}

export function messageBelongsToContextScope(message = {}, scope = {}) {
  const dialogProcessId = text(message?.dialogProcessId);
  const turnScopeId = text(message?.turnScopeId);
  const expectedDialog = text(scope?.dialogProcessId);
  const expectedTurn = text(scope?.turnScopeId);
  if (expectedTurn && turnScopeId === expectedTurn) return true;
  if (expectedDialog && dialogProcessId === expectedDialog) return true;
  return false;
}

export function excludeActiveContextScopeItems(items = [], scope = {}) {
  const source = Array.isArray(items) ? items : [];
  return source.filter((item) => !messageBelongsToContextScope(item, scope));
}

