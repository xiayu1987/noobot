/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requirePluginMessagePayload } from "@noobot/plugin-protocol/plugin-message-payload";
import { isPlainObject } from "@noobot/shared/value";
import {
  compactSessionAttachmentRef,
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

export function pickLightAttachments(message = {}) {
  const metas = Array.isArray(message?.attachments) ? message.attachments : [];
  return dedupeSessionAttachmentRefs(metas.map(compactSessionAttachmentRef).filter(Boolean));
}

function pickTransferEnvelope(envelope = {}) {
  return compactTransferEnvelopes([envelope])[0] || null;
}

export function pickLightPluginMeta(message = {}) {
  if (!isPlainObject(message.pluginMeta)) return null;
  const { source, kind, phase, payload } = message.pluginMeta;
  return { source, kind, phase, payload: requirePluginMessagePayload(payload) };
}

export function pickLightTransferEnvelopes(message = {}) {
  const seen = new Set();
  return (Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : [])
    .filter((item) => isPlainObject(item))
    .map((envelope) => pickTransferEnvelope(envelope))
    .filter(Boolean)
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
