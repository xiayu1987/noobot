/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
export function requireCredentialPort(port) {
  if (!port || !isFunction(port.resolve))
    throw new TypeError("credential port.resolve is required");
  return port;
}
