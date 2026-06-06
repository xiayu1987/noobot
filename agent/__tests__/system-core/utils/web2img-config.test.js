/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  WEB2IMG_RUNTIME_DEFAULTS,
  normalizeWeb2ImgRuntimeDefaults,
  HAS_SHARP,
  HAS_READABILITY,
  getSharp,
  mergeWeb2ImgConfig,
} from "../../../src/system-core/utils/web/web2img/web2img-config.js";

test("web2img config: mergeWeb2ImgConfig deep-merges nested image config", () => {
  const merged = mergeWeb2ImgConfig({
    image: {
      jpeg_quality: 65,
      split_long_image: false,
    },
  });

  assert.equal(merged.image.jpeg_quality, 65);
  assert.equal(merged.image.split_long_image, false);
  assert.equal(merged.image.max_side, DEFAULT_CONFIG.image.max_side);
  assert.deepEqual(merged.expand_patterns, DEFAULT_CONFIG.expand_patterns);
});

test("web2img config: invalid override falls back to defaults", () => {
  const merged = mergeWeb2ImgConfig("bad-config");
  assert.deepEqual(merged, DEFAULT_CONFIG);
});

test("web2img config: runtime defaults are present", () => {
  assert.ok(WEB2IMG_RUNTIME_DEFAULTS.page.gotoTimeoutMs > 0);
  assert.ok(WEB2IMG_RUNTIME_DEFAULTS.scroll.maxSteps >= 0);
  assert.ok(WEB2IMG_RUNTIME_DEFAULTS.textStable.rounds >= 0);
});

test("web2img config: normalizeWeb2ImgRuntimeDefaults clamps invalid runtime values", () => {
  const normalized = normalizeWeb2ImgRuntimeDefaults({
    page: {
      loadTimeoutMs: -1,
      readyStateTimeoutMs: "bad",
      networkIdleTimeoutMs: 0,
      readyPostWaitMs: -10,
      gotoTimeoutMs: 1,
    },
    expand: {
      maxMatchCount: -1,
      visibleTimeoutMs: -1,
      clickTimeoutMs: null,
      postClickWaitMs: undefined,
    },
    scroll: {
      maxSteps: -1,
      stepPx: -1,
      waitMs: -1,
      finalTopWaitMs: -1,
    },
    textStable: {
      rounds: -1,
      intervalMs: -1,
      stableThreshold: 0,
    },
  });
  assert.equal(normalized.page.loadTimeoutMs, 45000);
  assert.equal(normalized.page.readyStateTimeoutMs, 20000);
  assert.equal(normalized.page.networkIdleTimeoutMs, 12000);
  assert.equal(normalized.page.readyPostWaitMs, 0);
  assert.equal(normalized.page.gotoTimeoutMs, 1000);
  assert.equal(normalized.expand.maxMatchCount, 0);
  assert.equal(normalized.scroll.maxSteps, 0);
  assert.equal(normalized.textStable.rounds, 0);
  assert.equal(normalized.textStable.stableThreshold, 1);
});

test("web2img config: sharp/readability probe flags are internally consistent", () => {
  const sharpModule = getSharp();
  if (HAS_SHARP) assert.ok(sharpModule);
  else assert.equal(sharpModule, null);

  assert.equal(typeof HAS_READABILITY, "boolean");
});
