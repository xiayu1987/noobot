/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildContentDisposition(type, fileName) {
  const name = String(fileName);
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const fallback = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code > 126 || [34, 37, 92].includes(code) ? "_" : char;
  }).join("");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
