/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { text, isObjectLike } from "@noobot/shared/value";
import { readHarnessBucket } from "../bucket-utils.js";

export const DYNAMIC_POLICY_PROMPT_BLOCK = "HARNESS_DYNAMIC_POLICY_PROMPT";
const MAX_DYNAMIC_POLICY_PROMPT_CHARS =
  LENGTH_THRESHOLDS.contextPreview.harnessDynamicPolicyPromptChars;
const VALID_SCENARIOS = new Set(["general", "text", "programming"]);

function normalizeText(value = "") {
  return text(value);
}

function normalizeScenario(value = "") {
  const scenario = normalizeText(value).toLowerCase();
  return VALID_SCENARIOS.has(scenario) ? scenario : "general";
}

function clipPrompt(inputText = "") {
  const normalized = normalizeText(inputText);
  if (normalized.length <= MAX_DYNAMIC_POLICY_PROMPT_CHARS) return normalized;
  return normalized.slice(0, MAX_DYNAMIC_POLICY_PROMPT_CHARS).trim();
}

function extractProtocolBody(inputText = "") {
  const raw = String(inputText || "");
  const pattern = new RegExp(
    `\\[${DYNAMIC_POLICY_PROMPT_BLOCK}\\]([\\s\\S]*?)\\[\\/${DYNAMIC_POLICY_PROMPT_BLOCK}\\]`,
    "i",
  );
  const matched = raw.match(pattern);
  return normalizeText(matched?.[1] || "");
}

function readField(lines = [], field = "") {
  const key = text(field).toLowerCase();
  if (!key) return "";
  for (const line of lines) {
    const normalizedText = text(line);
    const matched = normalizedText.match(/^([a-zA-Z_][\w-]*)\s*[:=]\s*(.*)$/);
    if (!matched) continue;
    const name = text(matched[1]).toLowerCase().replace(/-/g, "_");
    if (name === key) return normalizeText(matched[2] || "");
  }
  return "";
}

function extractPromptFromBody(body = "") {
  const promptBlock = body.match(/\[PROMPT\]([\s\S]*?)\[\/PROMPT\]/i);
  if (promptBlock) return clipPrompt(promptBlock[1] || "");
  const marker = body.match(/(?:^|\n)\s*prompt\s*[:=]\s*/i);
  if (!marker) return "";
  const start = Number(marker.index || 0) + String(marker[0] || "").length;
  return clipPrompt(body.slice(start));
}

function parseDynamicPolicyPromptProtocol(inputText = "") {
  const body = extractProtocolBody(inputText);
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const prompt = extractPromptFromBody(body);
  if (!prompt) return null;
  return {
    scenario: normalizeScenario(readField(lines, "scenario")),
    reason: readField(lines, "reason"),
    prompt,
  };
}

export function buildDynamicPolicyPromptSignature(record = null) {
  if (!isObjectLike(record)) return "";
  return JSON.stringify({
    scenario: normalizeScenario(record.scenario),
    prompt: clipPrompt(record.prompt),
  });
}

export function applyDynamicPolicyPromptFromText(bucket, inputText = "", meta = {}) {
  const parsed = parseDynamicPolicyPromptProtocol(inputText);
  if (!parsed) return null;
  const record = {
    ...parsed,
    source: normalizeText(meta?.source) || "unknown",
    stage: normalizeText(meta?.stage) || "unknown",
    updatedAt: new Date().toISOString(),
  };
  bucket.dynamicPolicyPrompt = record;
  return record;
}

export function resolveActiveDynamicPolicyPromptFromContext(ctx = {}) {
  const record = readHarnessBucket(ctx)?.dynamicPolicyPrompt;
  if (!isObjectLike(record)) return null;
  const prompt = clipPrompt(record.prompt);
  if (!prompt) return null;
  return {
    scenario: normalizeScenario(record.scenario),
    reason: normalizeText(record.reason),
    source: normalizeText(record.source),
    stage: normalizeText(record.stage),
    updatedAt: normalizeText(record.updatedAt),
    prompt,
  };
}

export function buildDynamicPolicyPromptProtocolInstruction(locale = "zh-CN") {
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.DYNAMIC_POLICY_PROMPT_PROTOCOL_INSTRUCTION,
    { block: DYNAMIC_POLICY_PROMPT_BLOCK },
  );
}
