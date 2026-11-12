/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function resolveErrorHeaderValue(headers = null, name = "") {
  if (!headers || !name) return undefined;
  const normalizedName = text(name).toLowerCase();
  if (!normalizedName) return undefined;
  if (typeof headers?.get === "function") {
    return headers.get(normalizedName) ?? undefined;
  }
  if (Object.hasOwn(headers, normalizedName)) return headers[normalizedName] ?? undefined;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedName) return headers[key] ?? undefined;
  }
  return undefined;
}
