/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONTEXT_MESSAGE_NATIVE_FIELDS } from "../../src/message/codec.js";

const NATIVE_FIELDS = new Set(CONTEXT_MESSAGE_NATIVE_FIELDS);

export function contextMessage(fields = {}) {
  const message = {};
  const metadata = { ...(fields.additional_kwargs || {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "additional_kwargs") continue;
    if (NATIVE_FIELDS.has(key)) message[key] = value;
    else metadata[key] = value;
  }
  message.additional_kwargs = metadata;
  return message;
}
