/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModelByName, resolveDefaultModelSpec } from "../model/index.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../config/index.js";
import { normalizeLocale } from "noobot-i18n/shared";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptI18n } from "noobot-i18n/agent/locales/zh-CN/system-prompt";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptI18n } from "noobot-i18n/agent/locales/en-US/system-prompt";
import { StorageManager } from "./storage/index.js";
import { ShortMemoryManager } from "./short-memory/index.js";
import { LongMemoryManager } from "./long-memory/index.js";
import { ExperienceManager } from "./experience/index.js";
import { normalizeModelContent } from "./utils/format.js";
import { trimPromptPayloadByCharLimit } from "./utils/payload-trimmer.js";
import { isAbortLikeError, throwIfAborted } from "./experience/abort-control.js";
import {
  MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
  MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
} from "./constants.js";

const MEMORY_PROMPT_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhSystemPromptI18n?.memoryPrompt || {}),
  "en-US": Object.freeze(enSystemPromptI18n?.memoryPrompt || {}),
});

function resolveMemoryPromptI18n(locale = "zh-CN") {
  const normalizedLocale = normalizeLocale(locale, "zh-CN");
  return normalizedLocale === "en-US"
    ? MEMORY_PROMPT_I18N["en-US"]
    : MEMORY_PROMPT_I18N["zh-CN"];
}

export class MemoryManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.storage = new StorageManager(globalConfig);
    this.shortMemory = new ShortMemoryManager(this.storage);
    this.longMemory = new LongMemoryManager(this.storage);
    this.experience = new ExperienceManager(this.storage);
  }

  async readLongMemory({ userId }) {
    const basePath = this.storage.resolveBasePath(userId);
    return this.longMemory.read(basePath);
  }

  async captureSessionToShortMemory({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
  }) {
    const basePath = this.storage.resolveBasePath(userId);
    return this.shortMemory.captureSessionToShortMemory({
      basePath,
      sessionId,
      parentSessionId,
      userConfig,
    });
  }

  async maybeSummarize({ userId, userConfig, abortSignal = null }) {
    throwIfAborted(abortSignal);
    const basePath = this.storage.resolveBasePath(userId);
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const promptI18n = resolveMemoryPromptI18n(
      effectiveConfig?.locale || this.globalConfig?.locale || "zh-CN",
    );

    const short = await this.shortMemory.read(basePath);
    throwIfAborted(abortSignal);
    const unextracted = this.shortMemory.sorted(short);
    const memoryMaxItems = BUILTIN_THRESHOLDS.memoryMaxItems;
    const shouldUpdateLongMemory = unextracted.length >= memoryMaxItems;
    const promptPayload = unextracted.map((item) => ({ records: item.records }));
    const longMemoryPromptPayload = trimPromptPayloadByCharLimit(promptPayload, {
      maxChars: MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
      shrinkRatio: MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
    });

    const existingLongMemoryText = await this.longMemory.read(basePath);
    throwIfAborted(abortSignal);
    const existingLongMemory = String(existingLongMemoryText || "").trim();

    const modelSpec = resolveDefaultModelSpec({
      globalConfig: this.globalConfig,
      userConfig,
    });
    const llm = createChatModelByName(modelSpec?.alias || modelSpec?.model, {
      globalConfig: this.globalConfig,
      userConfig,
    });

    let nextLongMemory = existingLongMemory;
    const summaryCreatedAt = new Date().toISOString();
    if (shouldUpdateLongMemory) {
      const longMemoryModel = await this.longMemory.readModel(basePath);
      const longMemoryMetadata = await this.longMemory.readMetadata(basePath);
      throwIfAborted(abortSignal);
      const prompt = String(
        promptI18n?.prompt?.({
          longMemoryModel,
          longMemoryMetadata,
          existingLongMemory,
          promptPayload: longMemoryPromptPayload,
        }) || "",
      ).trim();
      if (!prompt) return;
      try {
        const res = await llm.invoke(prompt, { signal: abortSignal });
        nextLongMemory = normalizeModelContent(res?.content);
      } catch (error) {
        if (isAbortLikeError(error) || abortSignal?.aborted) throw error;
        nextLongMemory = existingLongMemory;
      }
    }

    throwIfAborted(abortSignal);

    let hasUpdatedLongMemory = false;
    if (shouldUpdateLongMemory) {
      hasUpdatedLongMemory = await this.longMemory.update(basePath, nextLongMemory);
    }

    let hasAppendedExperienceLessons = false;
    if (shouldUpdateLongMemory && promptPayload.length) {
      hasAppendedExperienceLessons = await this.experience.runDaily({
        basePath,
        llm,
        promptI18n,
        promptPayload,
        createdAt: summaryCreatedAt,
        abortSignal,
      });
    }

    await this.experience.runWeeklySummaryIfNeeded({
      basePath,
      llm,
      promptI18n,
      abortSignal,
    });

    await this.experience.runMonthlySummaryIfNeeded({
      basePath,
      llm,
      promptI18n,
      abortSignal,
    });

    await this.experience.runYearlySummaryIfNeeded({
      basePath,
      llm,
      promptI18n,
      abortSignal,
    });

    if (!hasUpdatedLongMemory && !hasAppendedExperienceLessons) return;
    await this.shortMemory.clear(basePath);
  }
}
