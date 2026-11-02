/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEVELOPMENT_THRESHOLDS = Object.freeze({
  time: Object.freeze({
    animationCaptureStepTimeoutMs: 30000,
    animationCaptureRunTimeoutMs: 180000,
    animationGenerationTimeoutMs: 180000,
    animationCaptureSettleMs: 500,
    animationCapturePollIntervalMs: 1000,
    animationCaptureFrameIntervalMs: 67,
    animationDemoReadyTimeoutMs: 30000,
    animationDemoFrameIntervalMs: 100,
    releasePollIntervalMs: 5 * 1000,
    releaseTimeoutMs: 30 * 60 * 1000,
    isolatedTmpMinAgeMs: 60 * 60 * 1000,
    modelAccessTimeoutMs: 2 * 60 * 1000,
  }),
  quantity: Object.freeze({
    topFileLimit: 10,
    reportedSampleLimit: 80,
    nestingLimit: 2,
    complexityLimit: 20,
    maxEffectiveLines: 800,
  }),
  length: Object.freeze({
    deadCodeOutputBytes: 16 * 1024 * 1024,
    sourceInventoryOutputBytes: 64 * 1024 * 1024,
    releaseOutputBytes: 1024 * 1024,
    modelAccessBodyMaxBytes: 4 * 1024 * 1024,
  }),
});
