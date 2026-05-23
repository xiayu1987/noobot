/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../event/index.js";
import {
  createStreamingCallbacks,
} from "./model/model-manager.js";
import { isAbortError as isSharedAbortError } from "../../utils/error-utils.js";
import {
  buildEngineErrorPayload,
  classifyEngineError,
  handleEngineError,
} from "./error/index.js";
import {
  TRANSIENT_LLM_MAX_ATTEMPTS,
  TRANSIENT_LLM_RETRY_BASE_DELAY_MS,
} from "./constants/index.js";

// ── Helpers ──

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLlmErrorStatus(error = {}) {
  const rawStatus =
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : 0;
}

function isAbortLikeError(error = {}) {
  if (isSharedAbortError(error) || isSharedAbortError(error?.cause)) return true;
  const name = String(error?.name || error?.cause?.name || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name.includes("abort") ||
    code === "abort_err" ||
    code === "aborted" ||
    message.includes("abort")
  );
}

function isTransientLlmError(error = {}) {
  if (isAbortLikeError(error)) return false;
  const status = getLlmErrorStatus(error);
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("internal server error") ||
    message.includes("server error") ||
    message.includes("temporarily unavailable") ||
    message.includes("timeout") ||
    message.includes("rate limit")
  );
}

function normalizeLlmError(error = {}, modelState = {}, { turn = 0, mode = "" } = {}) {
  const signalReason = modelState?.abortSignal?.reason;
  const normalizedAbortCode =
    signalReason && typeof signalReason === "object"
      ? Number(signalReason?.code || 0) || undefined
      : undefined;
  const normalizedAbortSource =
    signalReason && typeof signalReason === "object"
      ? String(signalReason?.type || "").trim() || undefined
      : undefined;
  const normalizedAbortReason =
    typeof signalReason === "string"
      ? signalReason.trim()
      : signalReason && typeof signalReason === "object"
        ? String(
            signalReason?.type ??
              signalReason?.reason ??
              signalReason?.message ??
              "",
          ).trim()
        : "";
  return {
    turn,
    mode,
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
    message: String(error?.message || error || "").trim(),
    name: String(error?.name || "").trim(),
    status: getLlmErrorStatus(error) || undefined,
    code: error?.code ?? error?.cause?.code ?? undefined,
    type: error?.type ?? error?.cause?.type ?? undefined,
    requestId:
      error?.request_id ??
      error?.requestId ??
      error?.headers?.["x-request-id"] ??
      error?.response?.headers?.["x-request-id"] ??
      undefined,
    abortSource: normalizedAbortSource,
    abortCode: normalizedAbortCode,
    abortReason: normalizedAbortReason || undefined,
  };
}

function createTrackedStreamingCallbacks(eventListener = null) {
  const callbacks = createStreamingCallbacks(eventListener);
  let tokenCount = 0;
  if (!Array.isArray(callbacks)) {
    return {
      callbacks,
      getTokenCount: () => tokenCount,
    };
  }
  return {
    callbacks: callbacks.map((callback) => {
      if (typeof callback?.handleLLMNewToken !== "function") return callback;
      return {
        ...callback,
        handleLLMNewToken: async (...args) => {
          tokenCount += 1;
          return callback.handleLLMNewToken(...args);
        },
      };
    }),
    getTokenCount: () => tokenCount,
  };
}

function resolveRuntimeErrorContext(modelState = {}) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = runtime?.systemRuntime || {};
  return {
    sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
    parentSessionId: String(systemRuntime?.parentSessionId || "").trim(),
    dialogProcessId: String(systemRuntime?.dialogProcessId || "").trim(),
  };
}

// ── Public API ──

/**
 * Invokes the LLM with transient retry logic.
 * Retries up to TRANSIENT_LLM_MAX_ATTEMPTS times for transient errors
 * when no tokens have been streamed yet.
 */
export async function invokeLlmWithTransientRetry({
  modelState,
  turn,
  mode = "",
  invoke,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= TRANSIENT_LLM_MAX_ATTEMPTS; attempt += 1) {
    const { callbacks, getTokenCount } = createTrackedStreamingCallbacks(
      modelState?.eventListener,
    );
    try {
      return await invoke({ callbacks });
    } catch (error) {
      lastError = error;
      const errorData = normalizeLlmError(error, modelState, { turn, mode });
      const runtimeContext = resolveRuntimeErrorContext(modelState);
      const abortLike = isAbortLikeError(error);
      if (abortLike) {
        handleEngineError({
          error,
          eventListener: modelState?.eventListener,
          event: "llm_call_aborted",
          metadata: {
            ...errorData,
            ...runtimeContext,
            source: "llm-invoker",
            attempt,
            maxAttempts: TRANSIENT_LLM_MAX_ATTEMPTS,
            streamedTokens: getTokenCount(),
          },
        });
        throw error;
      }
      const errorClassification = classifyEngineError(error);
      const canRetry =
        attempt < TRANSIENT_LLM_MAX_ATTEMPTS &&
        isTransientLlmError(error) &&
        getTokenCount() === 0 &&
        errorClassification === "retryable";
      if (!canRetry) {
        handleEngineError({
          error,
          eventListener: modelState?.eventListener,
          event: "llm_call_error",
          metadata: {
            ...errorData,
            ...runtimeContext,
            source: "llm-invoker",
            attempt,
            maxAttempts: TRANSIENT_LLM_MAX_ATTEMPTS,
            transient: isTransientLlmError(error),
            streamedTokens: getTokenCount(),
          },
        });
        throw error;
      }
      const delayMs = TRANSIENT_LLM_RETRY_BASE_DELAY_MS * attempt;
      const retryPayload = buildEngineErrorPayload({
        error,
        classification: errorClassification,
        metadata: {
          ...errorData,
          ...runtimeContext,
          source: "llm-invoker",
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: TRANSIENT_LLM_MAX_ATTEMPTS,
          delayMs,
        },
      });
      emitEvent(modelState?.eventListener, "llm_call_retry", retryPayload);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Normalizes AI model response content to plain text.
 * Handles string content, array of content parts, and edge cases.
 */
function normalizeReasoningContent(reasoningContent = null) {
  if (typeof reasoningContent === "string") return String(reasoningContent || "");
  if (Array.isArray(reasoningContent)) {
    return reasoningContent
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (reasoningContent && typeof reasoningContent === "object") {
    if (typeof reasoningContent?.text === "string") return reasoningContent.text;
    if (typeof reasoningContent?.content === "string") return reasoningContent.content;
  }
  return "";
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const THINK_BLOCK_CAPTURE_RE = /<think>([\s\S]*?)<\/think>/gi;

export function stripThinkingBlocks(text = "") {
  return String(text || "").replace(THINK_BLOCK_RE, "").trim();
}

function extractThinkingBlocks(text = "") {
  const raw = String(text || "");
  if (!raw) return "";
  const out = [];
  let match = null;
  const regex = new RegExp(THINK_BLOCK_CAPTURE_RE);
  while ((match = regex.exec(raw))) {
    const content = String(match?.[1] || "").trim();
    if (content) out.push(content);
  }
  return out.join("\n").trim();
}

export function extractAiReasoningText(ai = null) {
  if (!ai || typeof ai !== "object") return "";
  const additionalKwargs =
    ai?.additional_kwargs && typeof ai.additional_kwargs === "object"
      ? ai.additional_kwargs
      : {};
  const candidates = [
    additionalKwargs?.reasoning_content,
    additionalKwargs?.reasoningContent,
    ai?.reasoning_content,
    ai?.reasoningContent,
    ai?.response_metadata?.reasoning_content,
    ai?.response_metadata?.reasoningContent,
  ];
  for (const item of candidates) {
    const text = normalizeReasoningContent(item);
    if (text) return text;
  }
  const contentText = normalizeReasoningContent(ai?.content);
  const thinkingText = extractThinkingBlocks(contentText);
  if (thinkingText) return thinkingText;
  return "";
}

export function normalizeAiTextContent(aiContent, options = {}) {
  const { additionalKwargs = null, allowReasoningFallback = false } =
    options && typeof options === "object" ? options : {};
  if (typeof aiContent === "string") return stripThinkingBlocks(String(aiContent || ""));
  const normalizedRaw = !Array.isArray(aiContent)
    ? stripThinkingBlocks(String(aiContent || ""))
    : aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (normalizedRaw) return stripThinkingBlocks(normalizedRaw);
  if (!allowReasoningFallback) return normalizedRaw;
  return normalizeReasoningContent(additionalKwargs?.reasoning_content);
}
