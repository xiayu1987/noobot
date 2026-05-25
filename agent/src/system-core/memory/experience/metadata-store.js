/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "../utils/text.js";

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
  const lines = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim());
  const out = {
    domainNames: [],
    weeklyBatches: [],
    updatedAt: "",
  };
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const domainMatched = /^DOMAIN:\s*(.+)$/i.exec(line);
    if (domainMatched) {
      out.domainNames.push(domainMatched[1]);
      continue;
    }
    const updatedMatched = /^UPDATED_AT:\s*(.+)$/i.exec(line);
    if (updatedMatched) {
      out.updatedAt = updatedMatched[1];
      continue;
    }
    const weekMatched =
      /^WEEKLY:\s*week=([^\s]+)\s+dates=([^\s]*)\s+domains=(\d+)\s+created_at=(.+)$/i.exec(
        line,
      );
    if (weekMatched) {
      out.weeklyBatches.push({
        weekLabel: weekMatched[1],
        dates: String(weekMatched[2] || "")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean),
        domainCount: Number(weekMatched[3] || 0) || 0,
        createdAt: weekMatched[4],
      });
    }
  }
  return normalizeExperienceMetadata(out);
}

export function renderExperienceMetadataText(raw = null) {
  const normalized = normalizeExperienceMetadata(raw);
  const lines = ["# experience metadata (text protocol)"];
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
  return `${lines.join("\n").trim()}\n`;
}
