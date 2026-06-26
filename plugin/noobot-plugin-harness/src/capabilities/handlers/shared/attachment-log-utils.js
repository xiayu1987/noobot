/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { CAPABILITY_DOMAIN, LOCALE, PROMPT_ENVELOPE } from "./constants.js";
import { ensureHarnessBucket } from "./bucket-utils.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "./i18n.js";
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

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeAttachmentOwnerMeta(attachmentItem = {}) {
  const explicitOwner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : {};
  const type = normalizeString(explicitOwner?.type);
  const id = normalizeString(explicitOwner?.id);
  const owner = {
    ...explicitOwner,
    ...(type ? { type } : {}),
    ...(id ? { id } : {}),
  };
  return Object.keys(owner).length ? owner : null;
}

function resolveAttachmentOwnerType(attachmentItem = {}) {
  return normalizeString(
    normalizeAttachmentOwnerMeta(attachmentItem)?.type,
  );
}

function withCanonicalAttachmentOwner(attachmentItem = {}) {
  const source = isPlainObject(attachmentItem) ? { ...attachmentItem } : {};
  const owner = normalizeAttachmentOwnerMeta(source);
  return {
    ...source,
    ...(owner ? { owner } : {}),
  };
}

function buildTransferPayloadFromAttachments(attachments = []) {
  const items = (Array.isArray(attachments) ? attachments : []).filter(isPlainObject);
  if (!items.length) return normalizeTransferPayload();
  const files = items.map((attachment = {}, index) => ({
    filePath: normalizeString(attachment?.sandboxPath || attachment?.relativePath || attachment?.path || attachment?.name || ""),
    attachmentMeta: attachment,
    role: index === 0 ? "primary" : "secondary",
  }));
  const primaryEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: files[0]?.filePath || "",
    files,
  };
  return normalizeTransferPayload({
    transferEnvelopes: [primaryEnvelope],
  });
}

function extractAttachmentsFromTransferPayload(payload = {}) {
  const source = normalizeTransferPayload(payload || {});
  const envelopes = source.transferEnvelopes;
  const metas = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== "object") continue;
    const files = Array.isArray(envelope.files) ? envelope.files : [];
    if (files.length) {
      for (const file of files) {
        if (isPlainObject(file?.attachmentMeta)) metas.push(file.attachmentMeta);
      }
      continue;
    }
    if (isPlainObject(envelope.attachmentMeta)) metas.push(envelope.attachmentMeta);
  }
  return metas;
}

function normalizeTransferPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const transferEnvelopes = Array.isArray(source.transferEnvelopes)
    ? source.transferEnvelopes.filter(isPlainObject)
    : [];
  return {
    transferEnvelopes,
  };
}

export function getTransferPayloadFromAttachments(attachments = [], payload = null) {
  const payloadTransfer = normalizeTransferPayload(payload || {});
  if (payloadTransfer.transferEnvelopes.length) {
    return payloadTransfer;
  }
  return buildTransferPayloadFromAttachments(attachments);
}

export function applyTransferPayloadToMessage(message = {}, payload = {}) {
  if (!message || typeof message !== "object") return message;
  const transferPayload = normalizeTransferPayload(payload);
  if (transferPayload.transferEnvelopes) {
    message.transferEnvelopes = transferPayload.transferEnvelopes;
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

export function mergeAttachments(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;
  const keyOf = (item = {}) =>
    String(item?.attachmentId || "").trim() ||
    `${String(item?.name || "").trim()}|${String(item?.path || "").trim()}`;
  const merged = [...current];
  const indexByKey = new Map();
  current.forEach((item, index) => {
    const key = keyOf(item);
    if (key && !indexByKey.has(key)) indexByKey.set(key, index);
  });
  for (const item of next) {
    const key = keyOf(item);
    if (key && indexByKey.has(key)) {
      const existingIndex = indexByKey.get(key);
      const existingItem = merged[existingIndex] || {};
      const incomingOwnerType = resolveAttachmentOwnerType(item);
      const existingOwnerType = resolveAttachmentOwnerType(existingItem);
      if (incomingOwnerType === "plugin" && existingOwnerType !== "plugin") {
        merged[existingIndex] = withCanonicalAttachmentOwner({
          ...existingItem,
          ...item,
        });
      }
      continue;
    }
    merged.push(item);
    if (key) indexByKey.set(key, merged.length - 1);
  }
  return merged;
}

export function mapAttachmentRecordsToMetas(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record = {}) => {
    const owner = normalizeAttachmentOwnerMeta(record);
    return markHarnessPluginAttachmentMeta({
      attachmentId: normalizeString(record?.attachmentId),
      sessionId: normalizeString(record?.sessionId),
      attachmentSource: normalizeString(record?.attachmentSource || "model"),
      name: normalizeString(record?.name),
      mimeType: normalizeString(record?.mimeType || "application/octet-stream"),
      size: Number(record?.size) || 0,
      path: normalizeString(record?.path),
      relativePath: normalizeString(record?.relativePath),
      ...(owner ? { owner } : {}),
      generatedByModel: record?.generatedByModel === true,
      generationSource: normalizeString(record?.generationSource),
    });
  });
}

export function markHarnessPluginAttachmentMeta(meta = {}) {
  const source = meta && typeof meta === "object" ? meta : {};
  const owner = {
    ...(normalizeAttachmentOwnerMeta(source) || {}),
    type: "plugin",
    id: "harness-plugin",
  };
  return {
    ...source,
    owner,
  };
}

export function markHarnessPluginAttachments(metas = []) {
  return (Array.isArray(metas) ? metas : []).map((item = {}) =>
    markHarnessPluginAttachmentMeta(item),
  );
}

function markHarnessPluginTransferEnvelope(envelope = null) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return envelope;
  const next = { ...envelope };
  if (Array.isArray(next.files)) {
    next.files = next.files.map((file = {}) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return file;
      return {
        ...file,
        attachmentMeta: markHarnessPluginAttachmentMeta(file?.attachmentMeta || {}),
      };
    });
  }
  if (next.attachmentMeta && typeof next.attachmentMeta === "object" && !Array.isArray(next.attachmentMeta)) {
    next.attachmentMeta = markHarnessPluginAttachmentMeta(next.attachmentMeta);
  }
  return next;
}

export function markHarnessPluginTransferPayload(payload = {}) {
  const source = normalizeTransferPayload(payload || {});
  const transferEnvelopes = source.transferEnvelopes
    .map((item) => markHarnessPluginTransferEnvelope(item))
    .filter(Boolean);
  return {
    transferEnvelopes,
  };
}

function isHarnessInjectedMessage(message = {}) {
  return (
    message?.injectedMessage === true &&
    String(message?.injectedBy || "").trim() === "harness-plugin" &&
    String(message?.role || "").trim() === "user"
  );
}

export function attachMetasToLatestInjectedMessage(ctx = {}, metas = [], transferPayload = null) {
  const normalizedTransferPayload = getTransferPayloadFromAttachments(metas, transferPayload);
  const candidates = [{ list: Array.isArray(ctx?.messages) ? ctx.messages : [], isCtxMessages: true }];
  for (const candidate of candidates) {
    const messages = candidate.list;
    if (!messages.length) continue;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index] || {};
      if (!isHarnessInjectedMessage(item)) continue;
      messages[index] = applyTransferPayloadToMessage({ ...item }, normalizedTransferPayload);
      if (candidate.isCtxMessages) {
        const turnStore = resolveCurrentTurnMessagesStore(ctx);
        if (turnStore && typeof turnStore.updateLast === "function") {
          turnStore.updateLast(
            applyTransferPayloadToMessage({}, normalizedTransferPayload),
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

export async function saveCapabilityOutputAsTransferArtifacts(
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
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
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
    if (typeof transferSemanticContent === "function") {
      const staged = await transferSemanticContent({
        scenario: "harness",
        strategy: "harness_stage_message",
        summary: "",
        detail: text,
        name: buildCapabilityArtifactName({ purpose }),
        mimeType: "text/markdown",
        attachmentSource: "model",
        generationSource: String(generationSource || purpose || "harness_capability_output").trim(),
        source: "plugin",
        reason: String(purpose || "harness_capability_output").trim(),
        meta: {
          purpose: String(purpose || "").trim(),
          userId,
          sessionId,
        },
      });
      return markHarnessPluginAttachments(extractAttachmentsFromTransferPayload(staged));
    }
    const artifact = {
      name: buildCapabilityArtifactName({ purpose }),
      mimeType: "text/markdown",
      contentBase64: Buffer.from(text, "utf8").toString("base64"),
    };
    if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
      return [];
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
    pluginFlow = undefined,
    chain = undefined,
    content = "",
    dedupe = false,
    attachments = [],
    transferPayload = null,
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!text) return false;
  const prefix = translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
    purpose: String(purpose || "").trim() || "unknown",
  });
  const normalizedPluginFlow = String(pluginFlow || "").trim() || undefined;
  const normalizedChain = String(chain || "").trim() || undefined;
  const relayAttachments = Array.isArray(attachments) ? attachments : [];
  const resolvedTransferPayload = getTransferPayloadFromAttachments(
    relayAttachments,
    transferPayload,
  );
  if (!messages) return false;
  const injection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: `${prefix}\n${text}`,
    injectedMessageType: `separate_model_relay:${String(purpose || "unknown").trim() || "unknown"}`,
    purpose: String(purpose || "").trim() || undefined,
    pluginFlow: normalizedPluginFlow,
    chain: normalizedChain,
    ...resolvedTransferPayload,
    injectAt: "append",
    dedupe,
    avoidBreakToolCallContinuity: true,
    persistToCurrentTurn: true,
  });
  if (!injection.injected && injection.deduped === true) {
    if (relayAttachments.length) {
      attachMetasToLatestInjectedMessage(ctx, relayAttachments, resolvedTransferPayload);
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
  { domain = "", purpose = "", pluginFlow = undefined, chain = undefined, response = null } = {},
) {
  const traces = Array.isArray(response?.traces) ? response.traces : [];
  if (!traces.length) return false;
  const detail = {
    purpose: String(purpose || response?.purpose || "").trim() || undefined,
    pluginFlow: String(pluginFlow || response?.pluginFlow || "").trim() || undefined,
    chain: String(chain || response?.chain || "").trim() || undefined,
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
