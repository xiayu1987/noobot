/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../models/index.js";
import { createAgentAuxiliaryModelPort } from "../runtime/model-port-host.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../config/index.js";
import { normalizeLocale } from "noobot-i18n/shared";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptI18n } from "noobot-i18n/agent/locales/zh-CN/system-prompt";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptI18n } from "noobot-i18n/agent/locales/en-US/system-prompt";
import { StorageManager } from "./storage/index.js";
import { ShortMemoryManager } from "./short-memory/index.js";
import { LongMemoryManager } from "./long-memory/index.js";
import { ExperienceManager } from "./experience/index.js";
import { trimPromptPayloadByCharLimit } from "./utils/payload-trimmer.js";
import { isAbortLikeError, throwIfAborted } from "./experience/abort-control.js";
import {
  MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
  MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
} from "./constants.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

const MEMORY_PROMPT_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhSystemPromptI18n?.memoryPrompt || {}),
  "en-US": Object.freeze(enSystemPromptI18n?.memoryPrompt || {}),
});

function normalizeMemoryModelSelection(userConfig = {}) {
  return String(userConfig?.memoryModel ?? userConfig?.config?.memoryModel ?? "").trim();
}

function resolveMemoryModelSpec({ globalConfig, userConfig } = {}) {
  const selectedMemoryModel = normalizeMemoryModelSelection(userConfig);
  if (selectedMemoryModel) {
    const selectedModelSpec = resolveModelSpecByName({
      modelName: selectedMemoryModel,
      globalConfig,
      userConfig,
    });
    if (!selectedModelSpec) {
      throw new Error(`configured memory model not found: ${selectedMemoryModel}`);
    }
    return selectedModelSpec;
  }
  const defaultModelSpec = resolveDefaultModelSpec({
    globalConfig,
    userConfig,
  });
  if (!defaultModelSpec) {
    throw new Error("memory model is not configured");
  }
  return defaultModelSpec;
}

function resolveMemoryPromptI18n(locale = "zh-CN") {
  const normalizedLocale = normalizeLocale(locale, "zh-CN");
  return normalizedLocale === "en-US" ? MEMORY_PROMPT_I18N["en-US"] : MEMORY_PROMPT_I18N["zh-CN"];
}

export class MemoryManager {
  constructor(globalConfig, { createModelPort = createAgentAuxiliaryModelPort } = {}) {
    this.globalConfig = globalConfig;
    this.createModelPort = createModelPort;
    this.storage = new StorageManager(globalConfig);
    this.shortMemory = new ShortMemoryManager(this.storage);
    this.longMemory = new LongMemoryManager(this.storage);
    this.experience = new ExperienceManager(this.storage);
  }

  async readLongMemory({ userId }) {
    const basePath = this.storage.resolveBasePath(userId);
    return this.longMemory.read(basePath);
  }

  async captureSessionToShortMemory({ userId, sessionId, parentSessionId = "", userConfig = {} }) {
    const basePath = this.storage.resolveBasePath(userId);
    return this.shortMemory.captureSessionToShortMemory({
      basePath,
      sessionId,
      parentSessionId,
      userConfig,
    });
  }

  async maybeSummarize({
    userId,
    sessionId = "",
    userConfig,
    abortSignal = null,
    eventListener = null,
  }) {
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

    const modelSpec = resolveMemoryModelSpec({
      globalConfig: this.globalConfig,
      userConfig,
    });
    const modelPort = this.createModelPort({
      modelSpec,
      modelState: {
        eventListener,
        invocationIdentity: {
          sessionId,
          parentSessionId: "",
          dialogProcessId: `memory:${sessionId}`,
          turnScopeId: `memory-summary:${sessionId}`,
          runId: `memory-summary:${sessionId}`,
        },
        runtime: {
          userId,
          sessionId,
          systemRuntime: { userId, sessionId },
        },
      },
    });
    const invokeModel = async ({ prompt, flow, purpose }) => {
      const response = await modelPort.invoke({
        messages: [{ role: "user", content: prompt }],
        options: { signal: abortSignal },
        invocation: {
          flow,
          purpose,
          domain: "memory",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
      return response.output;
    };

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
        const output = await invokeModel({
          prompt,
          flow: "memory.summary",
          purpose: "memory_consolidation",
        });
        nextLongMemory = output.text;
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
        invokeModel,
        promptI18n,
        promptPayload,
        createdAt: summaryCreatedAt,
        abortSignal,
      });
    }

    await this.experience.runWeeklySummaryIfNeeded({
      basePath,
      invokeModel,
      promptI18n,
      abortSignal,
    });

    await this.experience.runMonthlySummaryIfNeeded({
      basePath,
      invokeModel,
      promptI18n,
      abortSignal,
    });

    await this.experience.runYearlySummaryIfNeeded({
      basePath,
      invokeModel,
      promptI18n,
      abortSignal,
    });

    if (!hasUpdatedLongMemory && !hasAppendedExperienceLessons) return;
    await this.shortMemory.clear(basePath);
  }
}
