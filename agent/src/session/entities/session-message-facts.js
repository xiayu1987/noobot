/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { deriveSessionAutoTitle, resolveSessionAutoTitle } from "@noobot/session-protocol";
import { pruneDialogOrder, registerDialogOrderMessage } from "./dialog-order-entity.js";

export function registerSessionMessageFacts(session, message) {
  session.dialogOrder = registerDialogOrderMessage(session.dialogOrder, message);
  if (session.autoTitle) return;
  const autoTitle = resolveSessionAutoTitle(message);
  if (autoTitle) session.autoTitle = autoTitle;
}

export function pruneSessionMessageFacts(session) {
  session.dialogOrder = pruneDialogOrder(session.dialogOrder, session.messages);
  const autoTitle = deriveSessionAutoTitle(session.messages);
  if (autoTitle) session.autoTitle = autoTitle;
  else delete session.autoTitle;
}

export function resolveSessionTitle(session) {
  return session.customTitle || session.autoTitle || session.sessionId.slice(0, 8);
}
