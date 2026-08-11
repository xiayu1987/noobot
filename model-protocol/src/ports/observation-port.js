/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireObservationPort(port) {
  if (!port || typeof port.emit !== "function")
    throw new TypeError("observation port.emit is required");
  return port;
}
export const NOOP_OBSERVATION_PORT = Object.freeze({ emit() {} });
