/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { randomUUID } from "node:crypto";
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
import { resolveModelMessages } from "../../../core/message-store.js";
import { mergeTransferEnvelopes, normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

export function normalizeTransferPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const transferEnvelopes = normalizeTransferEnvelopes(source.transferEnvelopes || []);
  return {
    transferEnvelopes,
  };
}

export function applyTransferPayloadToMessage(message = {}, payload = {}) {
  if (!message || typeof message !== "object") return message;
  const transferPayload = normalizeTransferPayload(payload);
  if (transferPayload.transferEnvelopes.length) {
    message.transferEnvelopes = mergeTransferEnvelopes(
      message.transferEnvelopes || [],
      transferPayload.transferEnvelopes,
    );
  }
  return message;
}

import { isHarnessInjectedMessage as isHarnessInjectedMessageBase } from "./message/utils.js";

function isHarnessInjectedMessage(message = {}) {
  return isHarnessInjectedMessageBase(message, { role: "user" });
}

export function attachTransferPayloadToLatestInjectedMessage(ctx = {}, transferPayload = {}) {
  const normalizedTransferPayload = normalizeTransferPayload(transferPayload);
  if (!normalizedTransferPayload.transferEnvelopes.length) return false;
  const messages = resolveModelMessages(ctx);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] || {};
    if (!isHarnessInjectedMessage(item)) continue;
    Object.assign(item, applyTransferPayloadToMessage({ ...item }, normalizedTransferPayload));
    const turnStore = resolveCurrentTurnMessagesStore(ctx);
    if (turnStore && typeof turnStore.updateLast === "function") {
      turnStore.updateLast(
        applyTransferPayloadToMessage({}, normalizedTransferPayload),
        (messageItem = {}) => isHarnessInjectedMessage(messageItem),
      );
    }
    return true;
  }
  return false;
}

export function appendCapabilityLog(
  ctx = {},
  { domain = "", event = "", traceId = "", detail = {} } = {},
) {
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
    ...(String(traceId || "").trim() ? { traceId: String(traceId).trim() } : {}),
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

export function deferCapabilityLogs(ctx = {}, entries = []) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return 0;
  const logs = Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry === "object")
    : [];
  if (!logs.length) return 0;
  if (!Array.isArray(holder.bucket.capabilityLogOutbox)) {
    holder.bucket.capabilityLogOutbox = [];
  }
  holder.bucket.capabilityLogOutbox.push(...logs);
  return logs.length;
}

export function consumeDeferredCapabilityLogs(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !Array.isArray(holder.bucket.capabilityLogOutbox)) return 0;
  const logs = holder.bucket.capabilityLogOutbox.splice(0);
  if (!logs.length) return 0;
  if (!Array.isArray(ctx.harnessCapabilityLogs)) ctx.harnessCapabilityLogs = [];
  ctx.harnessCapabilityLogs.push(...logs);
  return logs.length;
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
    name = "",
    mimeType = "text/markdown",
    generationSource = "",
    domain = CAPABILITY_DOMAIN.PLANNING,
  } = {},
) {
  const runtime = ctx?.agentContext?.bindings?.runtime || null;
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  const text = String(content || "").trim();
  if (!text) return [];
  const producerId = String(purpose || "").trim();
  if (!producerId) throw new Error("harness_semantic_transfer_producer_required");
  const transferOperationId = randomUUID();
  try {
    const strategy =
      domain === CAPABILITY_DOMAIN.ACCEPTANCE
        ? "harness_acceptance"
        : domain === CAPABILITY_DOMAIN.PLANNING
          ? "harness_planning"
          : purpose === "summary"
            ? "harness_summary"
            : "";
    const category =
      domain === CAPABILITY_DOMAIN.ACCEPTANCE
        ? "acceptance"
        : domain === CAPABILITY_DOMAIN.PLANNING
          ? "planning"
          : "summary";
    if (!strategy) return { transferEnvelopes: [] };
    if (typeof transferSemanticContent === "function") {
      const staged = await transferSemanticContent({
        scenario: "harness",
        strategy,
        category,
        businessPoint: purpose,
        summary: "",
        detail: text,
        name: normalizeString(name) || buildCapabilityArtifactName({ purpose }),
        mimeType: normalizeString(mimeType) || "text/markdown",
        attachmentSource: "model",
        generationSource: String(generationSource || purpose || "harness_capability_output").trim(),
        source: "plugin",
        reason: String(purpose || "harness_capability_output").trim(),
        producer: { type: "plugin", id: `harness:${producerId}` },
        transferKey: transferOperationId,
        direction: "output",
        meta: {
          purpose: String(purpose || "").trim(),
        },
      });
      return normalizeTransferPayload(staged);
    }
    throw new Error("semantic transfer runtime is required for harness output");
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain,
      event: SHARED_EVENTS.capabilityOutputAttachmentSaveFailed,
      detail: {
        purpose: String(purpose || "").trim() || "unknown",
        error: String(error?.message || error || ""),
      },
    });
    throw error;
  }
}

export async function appendCapabilityModelTraceLog(
  ctx = {},
  { domain = "", purpose = "", pluginFlow = undefined, chain = undefined, response = null } = {},
) {
  const modelAttempts = Array.isArray(response?.execution?.attempts)
    ? response.execution.attempts
    : [];
  if (!modelAttempts.length) return false;
  const detail = {
    purpose: String(purpose || "").trim() || undefined,
    pluginFlow: String(pluginFlow || "").trim() || undefined,
    chain: String(chain || "").trim() || undefined,
    modelAttempts,
  };
  const log = {
    traceId: randomUUID(),
    domain,
    event: SHARED_EVENTS.capabilityModelTrace,
    detail,
  };
  appendCapabilityLog(ctx, log);
  return true;
}
