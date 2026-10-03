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
import {
  LONG_MEMORY_PATCH_GRAMMAR,
  renderLongMemoryBody,
  renderLongMemoryFieldsForPrompt,
} from "@noobot/memory-protocol/long-memory";
import { ExperienceManager } from "./experience/index.js";
import { trimPromptPayloadByCharLimit } from "./utils/payload-trimmer.js";
import { assertNotAborted } from "../shared/utils/error-utils.js";
import { MEMORY_SUMMARY_STAGE, runMemorySummaryStage } from "./stage-runner.js";
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

  async deleteSessionMemoryBySessionIds({ userId, sessionIds = [] } = {}) {
    const basePath = this.storage.resolveBasePath(userId);
    return this.shortMemory.removeBySessionIds(basePath, sessionIds);
  }

  async consolidateLongMemory({ basePath, promptI18n, promptPayload, invokeModel, abortSignal }) {
    const state = await this.longMemory.readState(basePath);
    if (state.modelError) {
      await this.experience.appendParseErrorLog({
        basePath,
        stage: "long_memory_model",
        rawContent: await this.storage.readText(this.storage.longMemoryModelPath(basePath), ""),
        error: state.modelError.message,
      });
    }
    assertNotAborted(abortSignal);
    const prompt = String(
      promptI18n?.prompt?.({
        fieldModel: renderLongMemoryFieldsForPrompt(state.model, state.values),
        existingLongMemory: renderLongMemoryBody(state.model, state.values),
        patchGrammar: LONG_MEMORY_PATCH_GRAMMAR,
        promptPayload,
      }) || "",
    ).trim();
    if (!prompt) throw new Error("long memory prompt is not configured");
    const output = await invokeModel({
      prompt,
      flow: "memory.summary",
      purpose: "memory_consolidation",
    });
    assertNotAborted(abortSignal);
    const { changed } = await this.longMemory.update(basePath, state, output.text);
    return changed;
  }

  async maybeSummarize({
    userId,
    sessionId = "",
    userConfig,
    abortSignal = null,
    eventListener = null,
    onStageError,
  }) {
    assertNotAborted(abortSignal);
    const basePath = this.storage.resolveBasePath(userId);
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const promptI18n = resolveMemoryPromptI18n(
      effectiveConfig?.locale || this.globalConfig?.locale || "zh-CN",
    );

    const unextracted = await this.shortMemory.readItems(basePath);
    assertNotAborted(abortSignal);
    const memoryMaxItems = BUILTIN_THRESHOLDS.memoryMaxItems;
    const shouldUpdateLongMemory = unextracted.length >= memoryMaxItems;
    const promptPayload = unextracted.map((item) => ({ records: item.records }));
    const longMemoryPromptPayload = trimPromptPayloadByCharLimit(promptPayload, {
      maxChars: MEMORY_LONG_PROMPT_PAYLOAD_MAX_CHARS,
      shrinkRatio: MEMORY_LONG_PROMPT_PAYLOAD_SHRINK_RATIO,
    });

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
    const memorySystemPrompt = String(promptI18n?.system || "").trim();
    if (!memorySystemPrompt) {
      throw new Error("memory system prompt is not configured");
    }
    const invokeModel = async ({ prompt, flow, purpose }) => {
      const response = await modelPort.invoke({
        messages: [
          { role: "system", content: memorySystemPrompt },
          { role: "user", content: prompt },
        ],
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

    const summaryCreatedAt = new Date().toISOString();
    const stageOptions = { abortSignal, onStageError };
    if (shouldUpdateLongMemory) {
      await runMemorySummaryStage(
        MEMORY_SUMMARY_STAGE.LONG_MEMORY,
        () =>
          this.consolidateLongMemory({
            basePath,
            promptI18n,
            promptPayload: longMemoryPromptPayload,
            invokeModel,
            abortSignal,
          }),
        stageOptions,
      );
    }

    if (shouldUpdateLongMemory && promptPayload.length) {
      await runMemorySummaryStage(
        MEMORY_SUMMARY_STAGE.EXPERIENCE_DAILY,
        () =>
          this.experience.runDaily({
            basePath,
            invokeModel,
            promptI18n,
            promptPayload,
            createdAt: summaryCreatedAt,
          }),
        stageOptions,
      );
    }

    const periodicOptions = { basePath, invokeModel, promptI18n, abortSignal };
    await runMemorySummaryStage(
      MEMORY_SUMMARY_STAGE.EXPERIENCE_WEEKLY,
      () => this.experience.runWeeklySummaryIfNeeded(periodicOptions),
      stageOptions,
    );
    await runMemorySummaryStage(
      MEMORY_SUMMARY_STAGE.EXPERIENCE_MONTHLY,
      () => this.experience.runMonthlySummaryIfNeeded(periodicOptions),
      stageOptions,
    );
    await runMemorySummaryStage(
      MEMORY_SUMMARY_STAGE.EXPERIENCE_YEARLY,
      () => this.experience.runYearlySummaryIfNeeded(periodicOptions),
      stageOptions,
    );

    if (!shouldUpdateLongMemory) return;
    await this.shortMemory.clear(basePath);
  }
}
