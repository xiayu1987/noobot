/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SECURITY_RISK_LEVEL } from "@noobot/security-assessment-protocol";

export const sharedComposerOptionProps = {
  allowUserInteraction: { type: Boolean, default: true },
  safeConfirm: { type: Boolean, default: true },
  safeConfirmLevel: { type: String, default: SECURITY_RISK_LEVEL.LOW },
  sanitizeOutput: { type: Boolean, default: true },
  streamOutput: { type: Boolean, default: false },
  botScenario: { type: String, default: "" },
  selectedModel: { type: String, default: "" },
  memoryModel: { type: String, default: "" },
  modelOptions: { type: Array, default: () => [] },
  pluginModelConfig: { type: Object, default: () => ({}) },
  frontendThresholdsEnabled: { type: Boolean, default: false },
  summaryPolicy: { type: Object, default: () => ({}) },
};
