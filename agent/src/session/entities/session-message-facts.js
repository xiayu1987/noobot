/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveSessionAutoTitle } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";
import { registerDialogOrderMessage } from "./dialog-order-entity.js";

export function registerSessionMessageFacts(session, message) {
  session.dialogOrder = registerDialogOrderMessage(session.dialogOrder, message);
  if (session.autoTitle) return;
  const autoTitle = resolveSessionAutoTitle(message);
  if (autoTitle) session.autoTitle = autoTitle;
}

export function resolveSessionTitle(session) {
  return session.customTitle || text(session.autoTitle) || session.sessionId.slice(0, 8);
}
