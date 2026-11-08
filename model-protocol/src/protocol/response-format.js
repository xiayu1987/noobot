/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const RESPONSE_FORMAT_ENDPOINTS = Object.freeze([
  ["/messages", "anthropic"],
  ["/responses", "responses"],
  ["/chat/completions", "chat"],
]);

export function resolveModelResponseFormat(input) {
  const url = typeof input === "string" || input instanceof URL ? input : input.url;
  const path = new URL(url).pathname;
  for (const [suffix, format] of RESPONSE_FORMAT_ENDPOINTS)
    if (path.endsWith(suffix)) return format;
  return null;
}
