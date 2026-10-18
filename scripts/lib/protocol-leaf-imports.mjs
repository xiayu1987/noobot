/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PROTOCOL_LEAF_IMPORT_PREFIXES = Object.freeze(["@noobot/shared/"]);

export function isProtocolLeafImport(specifier) {
  return PROTOCOL_LEAF_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix));
}
