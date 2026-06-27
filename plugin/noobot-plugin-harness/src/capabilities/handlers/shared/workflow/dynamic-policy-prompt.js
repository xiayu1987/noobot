/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const DYNAMIC_POLICY_PROMPT_BLOCK = "HARNESS_DYNAMIC_POLICY_PROMPT";
const MAX_DYNAMIC_POLICY_PROMPT_CHARS =
  LENGTH_THRESHOLDS.contextPreview.harnessDynamicPolicyPromptChars;
const VALID_SCENARIOS = new Set(["general", "text", "programming"]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeScenario(value = "") {
  const text = normalizeText(value).toLowerCase();
  if (VALID_SCENARIOS.has(text)) return text;
  if (text.includes("program") || text.includes("coding") || text.includes("\u7f16\u7a0b")) return "programming";
  if (text.includes("text") || text.includes("\u6587\u672c")) return "text";
  return "general";
}

function clipPrompt(text = "") {
  const normalized = normalizeText(text);
  if (normalized.length <= MAX_DYNAMIC_POLICY_PROMPT_CHARS) return normalized;
  return normalized.slice(0, MAX_DYNAMIC_POLICY_PROMPT_CHARS).trim();
}

function extractProtocolBody(text = "") {
  const raw = String(text || "");
  const pattern = new RegExp(
    `\\[${DYNAMIC_POLICY_PROMPT_BLOCK}\\]([\\s\\S]*?)\\[\\/${DYNAMIC_POLICY_PROMPT_BLOCK}\\]`,
    "i",
  );
  const matched = raw.match(pattern);
  return normalizeText(matched?.[1] || "");
}

function readField(lines = [], field = "") {
  const key = String(field || "").trim().toLowerCase();
  if (!key) return "";
  for (const line of lines) {
    const text = String(line || "").trim();
    const matched = text.match(/^([a-zA-Z_][\w-]*)\s*[:=]\s*(.*)$/);
    if (!matched) continue;
    const name = String(matched[1] || "").trim().toLowerCase().replace(/-/g, "_");
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

export function parseDynamicPolicyPromptProtocol(text = "") {
  const body = extractProtocolBody(text);
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
  if (!record || typeof record !== "object") return "";
  return JSON.stringify({
    scenario: normalizeScenario(record.scenario),
    prompt: clipPrompt(record.prompt),
  });
}

export function applyDynamicPolicyPromptFromText(ctx = {}, text = "", meta = {}) {
  const parsed = parseDynamicPolicyPromptProtocol(text);
  if (!parsed) return null;
  const bucket = ctx?.agentContext?.payload?.harness && typeof ctx.agentContext.payload.harness === "object"
    ? ctx.agentContext.payload.harness
    : null;
  if (!bucket) return null;
  const previousSignature = buildDynamicPolicyPromptSignature(bucket.dynamicPolicyPrompt);
  const record = {
    ...parsed,
    source: normalizeText(meta?.source) || "unknown",
    stage: normalizeText(meta?.stage) || "unknown",
    updatedAt: new Date().toISOString(),
  };
  const nextSignature = buildDynamicPolicyPromptSignature(record);
  bucket.dynamicPolicyPrompt = record;
  if (nextSignature && nextSignature !== previousSignature) {
    bucket.policyPromptRefresh = {
      pending: true,
      reason: "dynamic_policy_prompt_changed",
      signature: nextSignature,
      previousSignature,
      updatedAt: record.updatedAt,
    };
  }
  return record;
}

export function resolveActiveDynamicPolicyPromptFromContext(ctx = {}) {
  const record = ctx?.agentContext?.payload?.harness?.dynamicPolicyPrompt;
  if (!record || typeof record !== "object") return null;
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
