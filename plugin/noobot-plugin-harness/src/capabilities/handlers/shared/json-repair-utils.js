/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const TRAILING_COMMA_RE = /,\s*([}\]])/g;
const THINK_BLOCK_RE = /<think>([\s\S]*?)<\/think>/gi;

export function hasJsonFeature(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return raw.includes("{") || raw.includes("[") || /```(?:json)?/i.test(raw);
}

export function extractJsonObjectFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const candidates = [raw.match(/\{[\s\S]*\}/), raw.match(/\[[\s\S]*\]/)];
  for (const matched of candidates) {
    const segment = matched?.[0];
    if (!segment) continue;
    try {
      return JSON.parse(segment);
    } catch {}
  }
  return null;
}

export function sanitizeJsonCandidate(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fencedBlocks = Array.from(raw.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/gi));
  const preferredBlock = fencedBlocks
    .map((item) => String(item?.[1] || "").trim())
    .find((block) => block.includes("{") || block.includes("["));
  const fallbackBlock = String(fencedBlocks?.[0]?.[1] || "").trim();
  const source = preferredBlock || fallbackBlock || raw;
  return source
    .replace(/^\s*json\s*/i, "")
    .replace(TRAILING_COMMA_RE, "$1")
    .trim();
}

function extractResponseText(response = null) {
  const content = response?.content;
  if (typeof content === "string") return stripThinkingBlocks(content);
  if (Array.isArray(content)) {
    return stripThinkingBlocks(content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") return item.text;
        return "";
      })
      .join("\n")
      .trim());
  }
  return stripThinkingBlocks(String(response?.text || response?.output || "").trim());
}

function stripThinkingBlocks(text = "") {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractThinkingText(text = "") {
  const raw = String(text || "");
  if (!raw) return "";
  const out = [];
  let match = null;
  const regex = new RegExp(THINK_BLOCK_RE);
  while ((match = regex.exec(raw))) {
    const content = String(match?.[1] || "").trim();
    if (content) out.push(content);
  }
  return out.join("\n").trim();
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
    const text = extractResponseText({ content: item });
    if (text) return text;
  }
  const contentText = (() => {
    const content = response?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && typeof item.text === "string") return item.text;
          return "";
        })
        .join("\n");
    }
    return String(response?.text || response?.output || "");
  })();
  const thinkingText = extractThinkingText(contentText);
  if (thinkingText) return thinkingText;
  return "";
}

export async function repairJsonTextByModel({
  invoker = null,
  invokePayload = null,
  appendModelTrace = null,
  onError = null,
} = {}) {
  if (typeof invoker !== "function" || !invokePayload || typeof invokePayload !== "object") return "";
  const baseMessages = Array.isArray(invokePayload?.messages) ? invokePayload.messages : [];
  let runtimeMessages = [...baseMessages];

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let response = null;
    try {
      response = await invoker({
        ...invokePayload,
        messages: runtimeMessages,
      });
    } catch (error) {
      if (typeof onError === "function") onError(error);
      return "";
    }
    if (typeof appendModelTrace === "function") {
      await appendModelTrace(response);
    }
    const responseText = extractResponseText(response);
    if (responseText) return responseText;
    const reasoningText = extractReasoningText(response);
    if (!reasoningText || attempt >= 1) return responseText;
    runtimeMessages = [
      ...runtimeMessages,
      {
        role: "system",
        content: [
          "<!-- harness-capability-reasoning -->",
          "以下是上次模型返回的思考内容，仅供参考，不代表最终答案：",
          reasoningText,
        ].join("\n"),
      },
    ];
  }
  return "";
}
