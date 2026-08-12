/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireModelPort(port) {
  if (!port || typeof port.invoke !== "function")
    throw new TypeError("model port.invoke is required");
  return port;
}
