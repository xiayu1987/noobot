/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MODEL_FAMILY_ID } from "./model-family.js";

export const MODEL_ADAPTER_ID = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
  ANTHROPIC_MESSAGES: "anthropic-messages",
});

export const MODEL_FAMILY_ADAPTER_FACTS = Object.freeze({
  [MODEL_FAMILY_ID.CLAUDE]: MODEL_ADAPTER_ID.ANTHROPIC_MESSAGES,
  [MODEL_FAMILY_ID.GPT]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.GEMINI]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.GROK]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.QWEN]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.GLM]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.DEEPSEEK]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.KIMI]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  [MODEL_FAMILY_ID.GENERIC]: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
});

export function resolveModelAdapterId({ modelFamily = "" } = {}) {
  const family =
    String(modelFamily || "")
      .trim()
      .toLowerCase() || MODEL_FAMILY_ID.GENERIC;
  if (!Object.prototype.hasOwnProperty.call(MODEL_FAMILY_ADAPTER_FACTS, family)) {
    throw new TypeError(`unsupported model family for adapter resolution: ${family}`);
  }
  return MODEL_FAMILY_ADAPTER_FACTS[family];
}
