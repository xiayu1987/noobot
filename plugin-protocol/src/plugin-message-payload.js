/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTransferEnvelopeField } from "@noobot/semantic-transfer-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE = Object.freeze({
  INVALID: "PLUGIN_MESSAGE_PAYLOAD_INVALID",
  TOO_LARGE: "PLUGIN_MESSAGE_PAYLOAD_TOO_LARGE",
});

function isJsonObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function payloadError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function assertJsonValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw payloadError(PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID, `non-finite number at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) {
    throw payloadError(PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID, `non-JSON value at ${path}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (isTransferEnvelopeField(key)) {
      throw payloadError(
        PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID,
        `transfer envelopes belong to the message, not the plugin payload: ${path}.${key}`,
      );
    }
    assertJsonValue(child, `${path}.${key}`);
  }
}

export function requirePluginMessagePayload(payload) {
  if (!isJsonObject(payload)) {
    throw payloadError(
      PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID,
      "plugin payload must be an object",
    );
  }
  assertJsonValue(payload, "payload");
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (bytes > LENGTH_THRESHOLDS.pluginMessage.payloadBytes) {
    throw payloadError(
      PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.TOO_LARGE,
      `plugin payload is ${bytes} bytes; limit is ${LENGTH_THRESHOLDS.pluginMessage.payloadBytes}`,
    );
  }
  return payload;
}
