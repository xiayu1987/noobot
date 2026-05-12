/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Semantic re-export entry point for the model module.
 * All public APIs are preserved for backward compatibility.
 */

// ── Provider resolution ──
export {
  isProviderEnabled,
  getProviders,
  getEnabledProviders,
  pickAlias,
  byAliasWithUser,
  firstEnabledAlias,
} from "./provider/resolver.js";

// ── Spec normalization & defaults ──
export {
  normalizeModelSpecInput,
  toFiniteNumber,
  clampNumber,
  normalizeModelParamValue,
  hasOwnValue,
  normalizeModelSpecWithDefaults,
} from "./spec/normalizer.js";

export {
  MODEL_DEFAULT_FIELDS_BY_FORMAT,

  getModelDefaultFields,
} from "./spec/defaults.js";

// ── High-level spec resolution ──
export {
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
  resolveModelSpecByName,
  resolveSkillModelSpec,
} from "./resolver/index.js";

// ── Chat model factory ──
export {
  resolveApiKey,
  buildModelKwargs,
  resolveUseResponsesApi,
  createChatModelFromSpec,
  createChatModel,
  createChatModelByName,
} from "./factory/chat-model.js";

// ── Invocation ──
export { invokeModelWithTextAndAttachments } from "./invoke/invoker.js";

// ── LLM adapter ──
export { resolveInvokeLlm } from "./invoke/llm-adapter.js";

// ── Attachment formatting ──
export {
  buildAttachmentContentBlock,
  normalizeModelOutputContent,
} from "./attachment/formatter.js";

// ── Tool binding & compatibility ──
export { adaptToolsForBinding } from "./tool/binding-adapter.js";
export {
  buildToolCompatibilityLogLine,
  appendToolCompatibilityLog,
} from "./tool/compatibility-log.js";

// ── Utilities ──
export { isSameModelSpec } from "./utils/model-compare.js";
