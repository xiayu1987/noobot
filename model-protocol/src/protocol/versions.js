/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_PROTOCOL_VERSION } from "./constants.js";
export function requireModelProtocolVersion(value) {
  const version = Number(value);
  if (version !== MODEL_PROTOCOL_VERSION)
    throw new TypeError(`unsupported model protocol version: ${String(value)}`);
  return version;
}
