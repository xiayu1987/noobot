/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function rotatedPluginLogName({ name, extension, timestamp, suffix }) {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `${name}.${stamp}.${suffix}${extension}`;
}

export function isRotatedPluginLogName(entryName, { name, extension }) {
  return (
    entryName !== `${name}${extension}` &&
    entryName.startsWith(`${name}.`) &&
    entryName.endsWith(extension)
  );
}
