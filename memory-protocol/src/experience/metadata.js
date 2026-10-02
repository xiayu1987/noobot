/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "../text.js";
import { MEMORY_DOCUMENT_KIND, readMemoryDocumentBody, renderMemoryDocument } from "../document.js";

export const EXPERIENCE_METADATA_ERROR_CODE = "EXPERIENCE_METADATA_DOCUMENT_INVALID";

const DOMAIN_LINE_RE = /^DOMAIN:\s*(\S.*)$/;
const UPDATED_LINE_RE = /^UPDATED_AT:\s*(\S+)$/;
const WEEKLY_LINE_RE = /^WEEKLY:\s*week=(\S+)\s+dates=(\S*)\s+domains=(\d+)\s+created_at=(\S+)$/;

function metadataError(message) {
  const error = new Error(message);
  error.code = EXPERIENCE_METADATA_ERROR_CODE;
  return error;
}

function normalizeWeeklyBatches(batches = []) {
  return (Array.isArray(batches) ? batches : [])
    .map((item = {}) => ({
      weekLabel: String(item.weekLabel || "").trim(),
      dates: dedupeTextList(item.dates || []),
      domainCount: Number(item.domainCount || 0) || 0,
      createdAt: String(item.createdAt || "").trim(),
    }))
    .filter((item) => item.weekLabel);
}

export function normalizeExperienceMetadata(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    domainNames: dedupeTextList(source?.domainNames || []),
    weeklyBatches: normalizeWeeklyBatches(source?.weeklyBatches),
    updatedAt: String(source?.updatedAt || "").trim(),
  };
}

export function parseExperienceMetadataText(raw = "") {
  const lines = readMemoryDocumentBody(MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA, raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const out = { domainNames: [], weeklyBatches: [], updatedAt: "" };
  for (const line of lines) {
    const domainMatched = DOMAIN_LINE_RE.exec(line);
    if (domainMatched) {
      out.domainNames.push(domainMatched[1]);
      continue;
    }
    const updatedMatched = UPDATED_LINE_RE.exec(line);
    if (updatedMatched) {
      if (out.updatedAt) throw metadataError(`UPDATED_AT repeated: ${line}`);
      out.updatedAt = updatedMatched[1];
      continue;
    }
    const weekMatched = WEEKLY_LINE_RE.exec(line);
    if (!weekMatched) throw metadataError(`unknown experience metadata line: ${line}`);
    out.weeklyBatches.push({
      weekLabel: weekMatched[1],
      dates: weekMatched[2].split("|").filter(Boolean),
      domainCount: Number(weekMatched[3]),
      createdAt: weekMatched[4],
    });
  }
  return normalizeExperienceMetadata(out);
}

export function renderExperienceMetadataText(raw = null) {
  const normalized = normalizeExperienceMetadata(raw);
  const lines = [];
  for (const domain of normalized.domainNames) {
    lines.push(`DOMAIN: ${domain}`);
  }
  for (const batch of normalized.weeklyBatches) {
    lines.push(
      `WEEKLY: week=${batch.weekLabel} dates=${batch.dates.join("|")} domains=${batch.domainCount} created_at=${batch.createdAt}`,
    );
  }
  if (normalized.updatedAt) {
    lines.push(`UPDATED_AT: ${normalized.updatedAt}`);
  }
  return renderMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA, lines.join("\n"));
}
