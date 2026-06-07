/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { CAPABILITY_DOMAIN, LOCALE, PROMPT_ENVELOPE } from "./constants.js";
import { ensureHarnessBucket } from "./bucket-utils.js";
import { translateI18nText } from "./i18n.js";
import { injectMessageWithPolicy } from "./message/injection-utils.js";
import { resolveDialogProcessIdFromContext } from "./runtime/dialog-process-id.js";
import {
  buildHarnessInjectedMessage,
  resolveCurrentTurnMessagesStore,
} from "./message/injected-message-utils.js";

const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTransferPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const transferResult = isPlainObject(source.transferResult) ? source.transferResult : null;
  const transferEnvelope = isPlainObject(source.transferEnvelope)
    ? source.transferEnvelope
    : isPlainObject(source.envelope)
      ? source.envelope
      : isPlainObject(transferResult?.envelope)
        ? transferResult.envelope
        : null;
  const transferEnvelopes = Array.isArray(source.transferEnvelopes)
    ? source.transferEnvelopes.filter(isPlainObject)
    : transferEnvelope
      ? [transferEnvelope]
      : [];
  return {
    transferResult,
    transferEnvelope,
    transferEnvelopes,
  };
}

export function decorateAttachmentMetasWithTransferPayload(attachmentMetas = [], payload = {}) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  const transferPayload = normalizeTransferPayload(payload);
  const descriptors = {};
  if (transferPayload.transferResult) {
    descriptors.transferResult = { value: transferPayload.transferResult, enumerable: false };
  }
  if (transferPayload.transferEnvelope) {
    descriptors.transferEnvelope = { value: transferPayload.transferEnvelope, enumerable: false };
  }
  if (transferPayload.transferEnvelopes.length) {
    descriptors.transferEnvelopes = { value: transferPayload.transferEnvelopes, enumerable: false };
  }
  if (Object.keys(descriptors).length) {
    Object.defineProperties(metas, descriptors);
  }
  return metas;
}

export function getTransferPayloadFromAttachmentMetas(attachmentMetas = []) {
  if (!Array.isArray(attachmentMetas)) {
    return normalizeTransferPayload();
  }
  return normalizeTransferPayload({
    transferResult: attachmentMetas.transferResult,
    transferEnvelope: attachmentMetas.transferEnvelope,
    transferEnvelopes: attachmentMetas.transferEnvelopes,
  });
}

export function applyTransferPayloadToMessage(message = {}, payload = {}) {
  if (!message || typeof message !== "object") return message;
  const transferPayload = normalizeTransferPayload(payload);
  if (transferPayload.transferResult) {
    message.transferResult = transferPayload.transferResult;
  }
  if (transferPayload.transferEnvelope) {
    message.transferEnvelope = transferPayload.transferEnvelope;
  }
  if (transferPayload.transferEnvelopes.length) {
    const existing = Array.isArray(message.transferEnvelopes) ? message.transferEnvelopes : [];
    const merged = [...existing];
    for (const envelope of transferPayload.transferEnvelopes) {
      if (!merged.includes(envelope)) merged.push(envelope);
    }
    message.transferEnvelopes = merged;
  }
  return message;
}

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

function isHarnessInjectedMessage(message = {}) {
  return (
    message?.injectedMessage === true &&
    String(message?.injectedBy || "").trim() === "harness-plugin" &&
    String(message?.role || "").trim() === "user"
  );
}

export function attachMetasToLatestInjectedMessage(ctx = {}, metas = []) {
  const transferPayload = getTransferPayloadFromAttachmentMetas(metas);
  const candidates = [{ list: Array.isArray(ctx?.messages) ? ctx.messages : [], isCtxMessages: true }];
  for (const candidate of candidates) {
    const messages = candidate.list;
    if (!messages.length) continue;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index] || {};
      if (!isHarnessInjectedMessage(item)) continue;
      messages[index] = applyTransferPayloadToMessage({
        ...item,
        attachmentMetas: mergeAttachmentMetas(item?.attachmentMetas, metas),
      }, transferPayload);
      if (candidate.isCtxMessages) {
        const turnStore = resolveCurrentTurnMessagesStore(ctx);
        if (turnStore && typeof turnStore.updateLast === "function") {
          turnStore.updateLast(
            applyTransferPayloadToMessage({
              attachmentMetas: mergeAttachmentMetas(item?.attachmentMetas, metas),
            }, transferPayload),
            (messageItem = {}) => isHarnessInjectedMessage(messageItem),
          );
        }
      }
      return true;
    }
  }
  return false;
}

export function appendCapabilityLog(ctx = {}, { domain = "", event = "", detail = {} } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket } = holder;
  if (!domain || !bucket?.logs?.[domain] || !Array.isArray(bucket.logs[domain])) return false;
  const inputDetail = detail && typeof detail === "object" ? detail : {};
  const normalizedPurpose =
    String(inputDetail?.purpose || "").trim() ||
    String(ctx?.harnessCapabilityPurpose || "").trim() ||
    "unknown";
  const normalizedPromptVersion =
    String(inputDetail?.promptVersion || "").trim() ||
    String(ctx?.harnessPromptVersion || "").trim() ||
    PROMPT_ENVELOPE.VERSION;
  const normalizedEnvelopeType =
    String(inputDetail?.envelopeType || "").trim() ||
    String(ctx?.harnessEnvelopeType || "").trim() ||
    PROMPT_ENVELOPE.TYPE;
  const entry = {
    domain,
    event: String(event || "").trim() || "unknown",
    timestamp: new Date().toISOString(),
    point: String(ctx?.phase || "").trim() || undefined,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    detail: {
      ...inputDetail,
      purpose: normalizedPurpose,
      promptVersion: normalizedPromptVersion,
      envelopeType: normalizedEnvelopeType,
    },
  };
  bucket.logs[domain].push(entry);
  if (!Array.isArray(ctx.harnessCapabilityLogs)) {
    ctx.harnessCapabilityLogs = [];
  }
  ctx.harnessCapabilityLogs.push(entry);
  return true;
}

function sanitizeArtifactFileNamePart(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCapabilityArtifactName({ purpose = "" } = {}) {
  const normalizedPurpose = sanitizeArtifactFileNamePart(purpose) || "unknown";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `harness-${normalizedPurpose}-${stamp}.md`;
}

export async function saveCapabilityOutputAsAttachmentMetas(
  ctx = {},
  {
    purpose = "",
    content = "",
    generationSource = "",
    domain = CAPABILITY_DOMAIN.PLANNING,
  } = {},
) {
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const attachmentService = runtime?.attachmentService || null;
  if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
    return [];
  }
  const text = String(content || "").trim();
  if (!text) return [];
  const userId = String(
    ctx?.userId || runtime?.systemRuntime?.userId || runtime?.userId || "",
  ).trim();
  const sessionId = String(
    ctx?.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || "",
  ).trim();
  if (!userId || !sessionId) return [];
  try {
    const artifact = {
      name: buildCapabilityArtifactName({ purpose }),
      mimeType: "text/markdown",
      contentBase64: Buffer.from(text, "utf8").toString("base64"),
    };
    const semanticPersist = runtime?.sharedTools?.semanticTransfer?.persistTransferFile;
    if (typeof semanticPersist === "function") {
      const persisted = await semanticPersist({
        userId,
        sessionId,
        content: text,
        name: artifact.name,
        mimeType: artifact.mimeType,
        attachmentSource: "model",
        generationSource: String(generationSource || purpose || "harness_capability_output").trim(),
        source: "plugin",
        reason: String(purpose || "harness_capability_output").trim(),
      });
      return decorateAttachmentMetasWithTransferPayload(
        Array.isArray(persisted?.attachmentMetas) ? persisted.attachmentMetas : [],
        persisted,
      );
    }
    const records = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "model",
      generationSource: String(generationSource || purpose || "harness_capability_output").trim(),
      artifacts: [artifact],
    });
    return mapAttachmentRecordsToMetas(records);
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain,
      event: SHARED_EVENTS.capabilityOutputAttachmentSaveFailed,
      detail: {
        purpose: String(purpose || "").trim() || "unknown",
        error: String(error?.message || error || ""),
      },
    });
    return [];
  }
}

export function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  {
    locale = LOCALE.ZH_CN,
    purpose = "",
    content = "",
    dedupe = false,
    attachmentMetas = [],
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!text) return false;
  const prefix = translateI18nText(locale, "separateModelRelayPrefix", {
    purpose: String(purpose || "").trim() || "unknown",
  });
  const relayContent = `${prefix}\n${text}`;
  const relayAttachmentMetas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  const transferPayload = getTransferPayloadFromAttachmentMetas(relayAttachmentMetas);
  if (!messages) return false;
  const injection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: relayContent,
    attachmentMetas: relayAttachmentMetas,
    ...transferPayload,
    injectAt: "append",
    dedupe,
    avoidBreakToolCallContinuity: true,
    persistToCurrentTurn: true,
  });
  if (!injection.injected && injection.deduped === true) {
    if (relayAttachmentMetas.length) {
      attachMetasToLatestInjectedMessage(ctx, relayAttachmentMetas);
    }
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelaySkippedDuplicate,
    });
    return false;
  }
  if (!injection.injected && injection.blockedByTurnEnded === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelaySkippedTurnEnded,
      detail: { purpose: String(purpose || "").trim() || "unknown" },
    });
    return false;
  }
  if (injection.injected && injection.target === "agent_system") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelayInjectedAsSystemContext,
      detail: { purpose: String(purpose || "").trim() || "unknown" },
    });
  }
  return injection.injected === true;
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
    event: SHARED_EVENTS.capabilityModelTrace,
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
      dialogProcessId: resolveDialogProcessIdFromContext(ctx) || undefined,
      ...log,
    });
  }
  return true;
}
