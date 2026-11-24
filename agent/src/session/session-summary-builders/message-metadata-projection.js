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
  const { pluginMeta } = message;
  const metadata = { payload: requirePluginMessagePayload(pluginMeta.payload) };
  for (const field of ["source", "kind", "phase"]) {
    if (Object.hasOwn(pluginMeta, field)) metadata[field] = pluginMeta[field];
  }
  return metadata;
}

export function pickLightTransferEnvelopes(message) {
  return compactTransferEnvelopes(message.transferEnvelopes);
}
