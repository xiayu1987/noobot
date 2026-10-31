/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "@noobot/shared/secure-identity";
import { text } from "@noobot/shared/value";

export function parseContentDisposition(contentDisposition = "") {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(String(utf8Match[1]).trim());
  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return text(basicMatch?.[1]);
}

export function createFileAccessTraceId(prefix = "preview") {
  return createSecureId(prefix, "-");
}
