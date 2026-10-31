/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { decodeToolResultText } from "@noobot/event-protocol/tool-result";

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (isPlainObject(item)) return Object.keys(item).length > 0;
      return item !== undefined && item !== null && item !== "";
    }),
  );
}

export function compactToolResultTextForModel(toolResultText) {
  const payload = decodeToolResultText(toolResultText);
  return JSON.stringify(
    compactObject({
      ...payload,
      transferEnvelopes: normalizeTransferEnvelopes(payload.transferEnvelopes),
    }),
  );
}
