/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

function isPluginInjectedMessage(messageItem = {}) {
  return messageItem?.injectedMessage === true && Boolean(text(messageItem?.injectedBy));
}

function findVisibleLastMessage(messages = []) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (!isPluginInjectedMessage(messageItem)) return messageItem || null;
  }
  return null;
}

export { findVisibleLastMessage, isPluginInjectedMessage };
