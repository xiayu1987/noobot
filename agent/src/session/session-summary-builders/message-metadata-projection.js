/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requirePluginMessagePayload } from "@noobot/plugin-protocol/plugin-message-payload";
import { isPlainObject } from "@noobot/shared/value";
import {
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

export function pickLightAttachments(message) {
  return dedupeSessionAttachmentRefs(message.attachments);
}

export function pickLightPluginMeta(message = {}) {
  if (!isPlainObject(message.pluginMeta)) return null;
  const { source, kind, phase, payload } = message.pluginMeta;
  return { source, kind, phase, payload: requirePluginMessagePayload(payload) };
}

export function pickLightTransferEnvelopes(message) {
  return compactTransferEnvelopes(message.transferEnvelopes);
}
