/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ModelProtocolError } from "@noobot/model-protocol";

export function createModelResponseDecoder() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return (bytes, options) => {
    try {
      return decoder.decode(bytes, options);
    } catch (cause) {
      throw new ModelProtocolError("provider response requires valid UTF-8", { cause });
    }
  };
}

export function parseModelResponseJson(text) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ModelProtocolError("provider response requires valid JSON", { cause });
  }
}
