/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CAPABILITY_DOMAIN, LOCALE } from "./constants.js";
import { ensureHarnessBucket } from "./bucket-utils.js";
import { translateI18nText } from "./i18n.js";

export function mergeAttachmentMetas(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;
  const keyOf = (item = {}) =>
    String(item?.attachmentId || "").trim() ||
    `${String(item?.name || "").trim()}|${String(item?.path || "").trim()}`;
  const seen = new Set(current.map((item) => keyOf(item)).filter(Boolean));
  const merged = [...current];
  for (const item of next) {
    const key = keyOf(item);
    if (key && seen.has(key)) continue;
    merged.push(item);
    if (key) seen.add(key);
  }
  return merged;
}

export function mapAttachmentRecordsToMetas(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record = {}) => ({
    attachmentId: String(record?.attachmentId || "").trim(),
    sessionId: String(record?.sessionId || "").trim(),
    attachmentSource: String(record?.attachmentSource || "model").trim(),
    name: String(record?.name || "").trim(),
    mimeType: String(record?.mimeType || "application/octet-stream").trim(),
    size: Number(record?.size) || 0,
    path: String(record?.path || "").trim(),
    relativePath: String(record?.relativePath || "").trim(),
    generatedByModel: record?.generatedByModel === true,
    generationSource: String(record?.generationSource || "").trim(),
  }));
}

export function attachArtifactsToAssistantResult(ctx = {}, attachmentMetas = []) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  if (!metas.length) return false;
  const result = ctx?.result && typeof ctx.result === "object" ? ctx.result : null;
  if (!result || !Array.isArray(result.turnMessages)) return false;
  const assistantIndexes = [];
  for (let messageIndex = 0; messageIndex < result.turnMessages.length; messageIndex += 1) {
    if (String(result.turnMessages[messageIndex]?.role || "").trim() === "assistant") {
      assistantIndexes.push(messageIndex);
    }
  }
  if (!assistantIndexes.length) return false;
  const latestDialogProcessId = String(
    result.turnMessages[assistantIndexes[assistantIndexes.length - 1]]?.dialogProcessId || "",
  ).trim();
  let changed = false;
  for (const index of assistantIndexes) {
    const message = result.turnMessages[index] || {};
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    if (latestDialogProcessId && dialogProcessId !== latestDialogProcessId) continue;
    result.turnMessages[index] = {
      ...message,
      attachmentMetas: mergeAttachmentMetas(message?.attachmentMetas, metas),
    };
    changed = true;
  }
  return changed;
}

export function appendCapabilityLog(ctx = {}, { domain = "", event = "", detail = {} } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket } = holder;
  if (!domain || !bucket?.logs?.[domain] || !Array.isArray(bucket.logs[domain])) return false;
  const entry = {
    domain,
    event: String(event || "").trim() || "unknown",
    timestamp: new Date().toISOString(),
    point: String(ctx?.phase || "").trim() || undefined,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    detail: detail && typeof detail === "object" ? detail : {},
  };
  bucket.logs[domain].push(entry);
  if (!Array.isArray(ctx.harnessCapabilityLogs)) {
    ctx.harnessCapabilityLogs = [];
  }
  ctx.harnessCapabilityLogs.push(entry);
  return true;
}

export function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  { locale = LOCALE.ZH_CN, purpose = "", content = "", dedupe = false } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!messages || !text) return false;
  const prefix = translateI18nText(locale, "separateModelRelayPrefix", {
    purpose: String(purpose || "").trim() || "unknown",
  });
  const relayContent = `${prefix}\n${text}`;
  if (dedupe === true) {
    const exists = messages.some(
      (message = {}) =>
        String(message?.role || "").trim() === "user" &&
        String(message?.content || "").trim() === relayContent,
    );
    if (exists) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_separate_model_relay_skipped_duplicate",
      });
      return false;
    }
  }
  messages.push({
    role: "user",
    content: relayContent,
  });
  return true;
}

export async function appendCapabilityModelTraceLog(
  ctx = {},
  meta = {},
  { domain = "", purpose = "", response = null } = {},
) {
  const traces = Array.isArray(response?.traces) ? response.traces : [];
  if (!traces.length) return false;
  const detail = {
    purpose: String(purpose || response?.purpose || "").trim() || undefined,
    finishedReason: response?.finishedReason || undefined,
    turn: response?.turn || undefined,
    toolTurnLimitReached: response?.toolTurnLimitReached === true,
    traces,
  };
  const log = {
    domain,
    event: "capability_model_trace",
    detail,
  };
  appendCapabilityLog(ctx, log);
  const sink = typeof meta?.harness?.runTraceSink === "function" ? meta.harness.runTraceSink : null;
  if (sink) {
    await sink({
      point: ctx?.point || "before_llm_call",
      timestamp: new Date().toISOString(),
      userId: ctx?.userId || undefined,
      sessionId: ctx?.sessionId || undefined,
      dialogProcessId: ctx?.dialogProcessId || undefined,
      ...log,
    });
  }
  return true;
}
