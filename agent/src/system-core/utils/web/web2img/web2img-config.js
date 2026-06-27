/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRequire } from "node:module";
import { isReadabilityExtractorReady } from "../text-cleaner.js";
import { deepMerge, isPlainObject } from "../../shared-utils.js";
import { normalizeTimeMs } from "../../../config/core/time-config-normalizer.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const require = createRequire(import.meta.url);

let sharpModule = null;
let HAS_SHARP = false;
try {
  sharpModule = require("sharp");
  HAS_SHARP = true;
} catch {
  sharpModule = null;
  HAS_SHARP = false;
}

const HAS_READABILITY = isReadabilityExtractorReady();

const DEFAULT_CONFIG = {
  expand_patterns: [
    "展开", "更多", "阅读全文", "查看全文", "显示全部",
    "read more", "show more", "more", "expand",
  ],
  ad_patterns: [
    "广告", "赞助", "推广", "商务合作", "品牌合作",
    "相关推荐", "热门推荐", "猜你想看", "为你推荐", "推荐阅读",
    "打开APP", "下载APP", "扫码下载", "客户端", "立即下载",
    "登录", "注册", "关注公众号", "微信扫码", "小程序",
    "cookie", "隐私", "用户协议", "免责声明", "版权", "版权所有",
    "ICP备", "公安备案", "返回顶部",
  ],
  image: {
    dpi: 300,
    max_side: 1600,
    max_pixels: 1500000,
    image_format: "jpg",
    jpeg_quality: 80,
    split_long_image: true,
    split_threshold_ratio: 2.5,
    split_max_height: 2800,
    split_overlap: 0,
    keep_raw_screenshot: true,
  },
};

const WEB2IMG_RUNTIME_DEFAULTS_RAW = {
  page: {
    loadTimeoutMs: TIME_THRESHOLDS.web.web2img.loadTimeoutMs,
    readyStateTimeoutMs: TIME_THRESHOLDS.web.web2img.readyStateTimeoutMs,
    networkIdleTimeoutMs: TIME_THRESHOLDS.web.web2img.networkIdleTimeoutMs,
    readyPostWaitMs: TIME_THRESHOLDS.web.web2img.readyPostWaitMs,
    gotoTimeoutMs: TIME_THRESHOLDS.web.web2img.gotoTimeoutMs,
  },
  expand: {
    maxMatchCount: 20,
    visibleTimeoutMs: TIME_THRESHOLDS.web.web2img.expandVisibleTimeoutMs,
    clickTimeoutMs: TIME_THRESHOLDS.web.web2img.expandClickTimeoutMs,
    postClickWaitMs: TIME_THRESHOLDS.web.web2img.expandPostClickWaitMs,
  },
  scroll: {
    maxSteps: 35,
    stepPx: 1400,
    waitMs: TIME_THRESHOLDS.web.web2img.scrollWaitMs,
    finalTopWaitMs: TIME_THRESHOLDS.web.web2img.scrollFinalTopWaitMs,
  },
  textStable: {
    rounds: TURN_THRESHOLDS.web2img.textStableRounds,
    intervalMs: TIME_THRESHOLDS.web.web2img.textStableIntervalMs,
    stableThreshold: TURN_THRESHOLDS.web2img.textStableThreshold,
  },
};

function normalizeInteger(value, fallback, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Math.floor(Number(fallback || 0)));
  return Math.max(min, Math.floor(parsed));
}

function normalizeWeb2ImgRuntimeDefaults(runtimeDefaults = WEB2IMG_RUNTIME_DEFAULTS_RAW) {
  const source = isPlainObject(runtimeDefaults) ? runtimeDefaults : {};
  const page = isPlainObject(source.page) ? source.page : {};
  const expand = isPlainObject(source.expand) ? source.expand : {};
  const scroll = isPlainObject(source.scroll) ? source.scroll : {};
  const textStable = isPlainObject(source.textStable) ? source.textStable : {};

  return {
    page: {
      loadTimeoutMs: normalizeTimeMs(page.loadTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.loadTimeoutMs, min: 1000 }),
      readyStateTimeoutMs: normalizeTimeMs(page.readyStateTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.readyStateTimeoutMs, min: 1000 }),
      networkIdleTimeoutMs: normalizeTimeMs(page.networkIdleTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.networkIdleTimeoutMs, min: 500 }),
      readyPostWaitMs: normalizeTimeMs(page.readyPostWaitMs, { fallback: TIME_THRESHOLDS.web.web2img.readyPostWaitMs, min: 0, allowZero: true }),
      gotoTimeoutMs: normalizeTimeMs(page.gotoTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.gotoTimeoutMs, min: 1000 }),
    },
    expand: {
      maxMatchCount: normalizeInteger(expand.maxMatchCount, 20, 0),
      visibleTimeoutMs: normalizeTimeMs(expand.visibleTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.expandVisibleTimeoutMs, min: 0, allowZero: true }),
      clickTimeoutMs: normalizeTimeMs(expand.clickTimeoutMs, { fallback: TIME_THRESHOLDS.web.web2img.expandClickTimeoutMs, min: 0, allowZero: true }),
      postClickWaitMs: normalizeTimeMs(expand.postClickWaitMs, { fallback: TIME_THRESHOLDS.web.web2img.expandPostClickWaitMs, min: 0, allowZero: true }),
    },
    scroll: {
      maxSteps: normalizeInteger(scroll.maxSteps, 35, 0),
      stepPx: normalizeInteger(scroll.stepPx, 1400, 0),
      waitMs: normalizeTimeMs(scroll.waitMs, { fallback: TIME_THRESHOLDS.web.web2img.scrollWaitMs, min: 0, allowZero: true }),
      finalTopWaitMs: normalizeTimeMs(scroll.finalTopWaitMs, { fallback: TIME_THRESHOLDS.web.web2img.scrollFinalTopWaitMs, min: 0, allowZero: true }),
    },
    textStable: {
      rounds: normalizeInteger(
        textStable.rounds,
        TURN_THRESHOLDS.web2img.textStableRounds,
        0,
      ),
      intervalMs: normalizeTimeMs(textStable.intervalMs, { fallback: TIME_THRESHOLDS.web.web2img.textStableIntervalMs, min: 0, allowZero: true }),
      stableThreshold: normalizeInteger(
        textStable.stableThreshold,
        TURN_THRESHOLDS.web2img.textStableThreshold,
        1,
      ),
    },
  };
}

const WEB2IMG_RUNTIME_DEFAULTS = normalizeWeb2ImgRuntimeDefaults();

function getSharp() {
  return sharpModule;
}

function mergeWeb2ImgConfig(config) {
  if (!isPlainObject(config)) return deepMerge(DEFAULT_CONFIG, {});
  return deepMerge(DEFAULT_CONFIG, config);
}

export {
  DEFAULT_CONFIG,
  WEB2IMG_RUNTIME_DEFAULTS,
  normalizeWeb2ImgRuntimeDefaults,
  HAS_SHARP,
  HAS_READABILITY,
  getSharp,
  mergeWeb2ImgConfig,
};
