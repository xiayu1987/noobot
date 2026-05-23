/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./bucket-utils.js";
import { isHarnessAgentTurnEnded } from "./lifecycle-utils.js";

const THINK_BLOCK_RE = /<think>([\s\S]*?)<\/think>/gi;

function extractTextContent(content = "") {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item = {}) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") return item.text;
      return "";
    })
    .join("\n")
    .trim();
}

function stripThinkingBlocks(text = "") {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractThinkingTextFromContent(content = "") {
  const raw = extractTextContent(content);
  if (!raw) return "";
  const chunks = [];
  let match = null;
  const regex = new RegExp(THINK_BLOCK_RE);
  while ((match = regex.exec(raw))) {
    const text = String(match?.[1] || "").trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n").trim();
}

function extractResponseText(response = null) {
  const contentText = stripThinkingBlocks(extractTextContent(response?.content));
  if (contentText) return contentText;
  return stripThinkingBlocks(String(response?.text || response?.output || "").trim());
}

function extractReasoningText(response = null) {
  const candidates = [
    response?.reasoning_content,
    response?.reasoningContent,
    response?.additional_kwargs?.reasoning_content,
    response?.additional_kwargs?.reasoningContent,
    response?.response_metadata?.reasoning_content,
    response?.response_metadata?.reasoningContent,
    response?.raw?.choices?.[0]?.message?.reasoning_content,
    response?.raw?.choices?.[0]?.message?.reasoningContent,
  ];
  for (const item of candidates) {
    const text = extractTextContent(item);
    if (text) return text;
  }
  const thinkingFromContent = extractThinkingTextFromContent(response?.content);
  if (thinkingFromContent) return thinkingFromContent;
  const thinkingFromText = extractThinkingTextFromContent(response?.text || response?.output || "");
  if (thinkingFromText) return thinkingFromText;
  return "";
}

function appendReasoningToBucket(ctx = {}, { purpose = "", reasoning = "", attempt = 1 } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket } = holder;
  if (!Array.isArray(bucket.modelReasoningTraces)) {
    bucket.modelReasoningTraces = [];
  }
  bucket.modelReasoningTraces.push({
    capturedAt: new Date().toISOString(),
    purpose: String(purpose || "unknown").trim() || "unknown",
    attempt: Number(attempt) || 1,
    content: String(reasoning || ""),
  });
  if (bucket.modelReasoningTraces.length > 40) {
    bucket.modelReasoningTraces.splice(0, bucket.modelReasoningTraces.length - 40);
  }
  return true;
}

export async function invokeWithReasoningRetry({
  invoker = null,
  invokePayload = {},
  maxReasoningRetries = 1,
  purpose = "",
  domain = "",
  appendCapabilityLog = null,
  appendModelTrace = null,
  ctx = {},
  meta = {},
} = {}) {
  if (typeof invoker !== "function") return null;
  if (isHarnessAgentTurnEnded(ctx)) return null;
  const payload = invokePayload && typeof invokePayload === "object" ? { ...invokePayload } : {};
  const baseMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  let runtimeMessages = [...baseMessages];
  let response = null;

  for (let attempt = 0; attempt <= Math.max(0, Number(maxReasoningRetries) || 0); attempt += 1) {
    if (isHarnessAgentTurnEnded(ctx)) return response;
    response = await invoker({
      ...payload,
      messages: runtimeMessages,
    });
    if (typeof appendModelTrace === "function") {
      await appendModelTrace(response, { attempt });
    }
    const responseText = extractResponseText(response);
    if (responseText) return response;
    if (isHarnessAgentTurnEnded(ctx)) return response;
    const reasoningText = extractReasoningText(response);
    if (!reasoningText) return response;

    appendReasoningToBucket(ctx, {
      purpose,
      reasoning: reasoningText,
      attempt: attempt + 1,
    });
    if (typeof appendCapabilityLog === "function") {
      appendCapabilityLog(ctx, {
        domain,
        event: "capability_reasoning_captured",
        detail: {
          purpose,
          attempt: attempt + 1,
          reasoningChars: reasoningText.length,
        },
      });
    }
    if (attempt >= maxReasoningRetries) {
      if (typeof appendCapabilityLog === "function") {
        appendCapabilityLog(ctx, {
          domain,
          event: "capability_reasoning_retry_exhausted_error",
          detail: {
            purpose,
            attempt: attempt + 1,
            maxReasoningRetries: Math.max(0, Number(maxReasoningRetries) || 0),
          },
        });
      }
      const error = new Error(
        `reasoning-only response after retry exhausted: ${String(purpose || "unknown").trim() || "unknown"}`,
      );
      error.code = "CAPABILITY_REASONING_RETRY_EXHAUSTED";
      error.purpose = String(purpose || "").trim() || "unknown";
      error.domain = String(domain || "").trim() || "unknown";
      throw error;
    }
    const reasoningMessage = [
      "<!-- harness-capability-reasoning -->",
      "以下是上次模型返回的思考内容，仅供参考，不代表最终答案：",
      reasoningText,
    ].join("\n");
    runtimeMessages = [...runtimeMessages, { role: "system", content: reasoningMessage }];
    if (typeof appendCapabilityLog === "function") {
      appendCapabilityLog(ctx, {
        domain,
        event: "capability_reasoning_retry_scheduled",
        detail: {
          purpose,
          attempt: attempt + 1,
        },
      });
    }
  }
  void meta;
  return response;
}
