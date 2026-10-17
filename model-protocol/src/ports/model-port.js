/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
export function requireModelPort(port) {
  if (!port || !isFunction(port.invoke)) throw new TypeError("model port.invoke is required");
  return port;
}
