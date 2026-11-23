/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

function invalidBranchDialog(message) {
  return Object.assign(new TypeError(message), {
    code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID,
  });
}

function captureBranchDialogs(entries, roots) {
  const graph = { parentByDialog: new Map(), sessionByDialog: new Map(), roots };
  for (const entry of entries) {
    if (!isPlainObject(entry) || !isCanonicalText(entry.sessionId))
      throw invalidBranchDialog("Branch detail requires canonical session identities");
    if (!Array.isArray(entry.messages))
      throw invalidBranchDialog("Branch detail requires committed messages");
    for (const message of entry.messages) recordBranchDialog(graph, entry.sessionId, message);
  }
  return graph.parentByDialog;
}

function recordBranchDialog(
  { parentByDialog, sessionByDialog, roots },
  sessionId,
  { dialogProcessId, parentDialogProcessId },
) {
  if (isCanonicalText(dialogProcessId)) {
    const owner = sessionByDialog.get(dialogProcessId);
    if (roots.has(dialogProcessId) || (owner !== undefined && owner !== sessionId))
      throw invalidBranchDialog(`Conflicting session for dialog ${dialogProcessId}`);
    sessionByDialog.set(dialogProcessId, sessionId);
  }
  if (parentDialogProcessId === undefined || parentDialogProcessId === "") return;
  if (!isCanonicalText(dialogProcessId) || !isCanonicalText(parentDialogProcessId))
    throw invalidBranchDialog("Branch detail requires canonical parent dialog identities");
  const previous = parentByDialog.get(dialogProcessId);
  if (previous !== undefined && previous !== parentDialogProcessId)
    throw invalidBranchDialog(`Conflicting parent dialog for ${dialogProcessId}`);
  parentByDialog.set(dialogProcessId, parentDialogProcessId);
}

function resolveBranchDialog(start, roots, parentByDialog, resolved) {
  let current = start;
  const path = new Set();
  while (current !== undefined && !roots.has(current) && !resolved.has(current)) {
    if (path.has(current)) throw invalidBranchDialog(`Parent dialog cycle at ${current}`);
    path.add(current);
    current = parentByDialog.get(current);
  }
  const root = roots.has(current) ? current : resolved.get(current);
  for (const dialog of path) resolved.set(dialog, root);
  return root;
}

export function selectBranchDialogMessages({ sessionId, rootDialogProcessIds, sessions }) {
  const branches = sessions.filter((entry) => entry.sessionId !== sessionId);
  const roots = new Set(rootDialogProcessIds);
  const parentByDialog = captureBranchDialogs(branches, roots);
  const resolved = new Map();
  const result = new Map();
  for (const entry of branches) {
    for (const message of entry.messages) {
      const parent = message.parentDialogProcessId;
      if (parent === undefined || parent === "") continue;
      const root = resolveBranchDialog(parent, roots, parentByDialog, resolved);
      if (root === undefined) continue;
      const match = { sessionId: entry.sessionId, message };
      const messages = result.get(root);
      if (messages === undefined) result.set(root, [match]);
      else messages.push(match);
    }
  }
  return result;
}
