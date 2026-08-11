/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireCredentialPort(port) {
  if (!port || typeof port.resolve !== "function")
    throw new TypeError("credential port.resolve is required");
  return port;
}
