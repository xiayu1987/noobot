/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "@noobot/memory-protocol/text";

export function renderSectionLines(item = {}, sections = []) {
  const lines = [];
  for (const { heading, field } of sections) {
    const values = dedupeTextList(item?.[field]);
    lines.push(heading, ...(values.length ? values.map((value) => `- ${value}`) : ["- （无）"]));
  }
  return lines;
}

export function formatDomainBlock({ createdAt = "", item = {}, sections = [] } = {}) {
  return [
    `[${createdAt || new Date().toISOString()}]`,
    ...renderSectionLines(item, sections),
    "",
  ].join("\n");
}
