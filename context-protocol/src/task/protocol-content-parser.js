/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const SECTION_NAMES = Object.freeze(["STATE", "ABSTRACT", "DETAILS", "NEXT_ACTION"]);
const SECTION_MARKERS = new Set(SECTION_NAMES.map((name) => `[${name}]`));

function normalizeProtocolText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function parseTaskProtocolContent(
  value,
  { protocolHeader, protocolError, validStates = [] } = {},
) {
  const content = normalizeProtocolText(value);
  if (!content) throw protocolError("content is empty");
  const lines = content.split("\n");
  if (lines[0] !== protocolHeader) {
    throw protocolError(`first line must be ${protocolHeader}`);
  }

  const sections = {};
  let lineIndex = 1;
  for (const sectionName of SECTION_NAMES) {
    const marker = `[${sectionName}]`;
    if (lines[lineIndex] !== marker) {
      throw protocolError(`${marker} is missing or out of order`);
    }
    lineIndex += 1;
    const body = [];
    while (lineIndex < lines.length && !SECTION_MARKERS.has(lines[lineIndex])) {
      if (/^\[[A-Z][A-Z0-9_]*\]$/.test(lines[lineIndex])) {
        throw protocolError(`unknown section ${lines[lineIndex]}`);
      }
      body.push(lines[lineIndex]);
      lineIndex += 1;
    }
    const text = body.join("\n").trim();
    if (!text) throw protocolError(`${marker} must not be empty`);
    sections[sectionName] = text;
  }
  if (lineIndex !== lines.length) {
    throw protocolError(`duplicate or unexpected section ${lines[lineIndex]}`);
  }

  if (!validStates.includes(sections.STATE)) {
    throw protocolError(`[STATE] must be one of ${validStates.join(", ")}`);
  }
  return { content, sections };
}
