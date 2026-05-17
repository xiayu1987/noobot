/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRequire } from "node:module";
import { isReadabilityExtractorReady } from "../text-cleaner.js";
import { deepMerge, isPlainObject } from "../../shared-utils.js";

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

const WEB2IMG_RUNTIME_DEFAULTS = {
  page: {
    loadTimeoutMs: 45000,
    readyStateTimeoutMs: 20000,
    networkIdleTimeoutMs: 12000,
    readyPostWaitMs: 800,
    gotoTimeoutMs: 45000,
  },
  expand: {
    maxMatchCount: 20,
    visibleTimeoutMs: 500,
    clickTimeoutMs: 800,
    postClickWaitMs: 150,
  },
  scroll: {
    maxSteps: 35,
    stepPx: 1400,
    waitMs: 450,
    finalTopWaitMs: 300,
  },
  textStable: {
    rounds: 10,
    intervalMs: 700,
    stableThreshold: 3,
  },
};

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
  HAS_SHARP,
  HAS_READABILITY,
  getSharp,
  mergeWeb2ImgConfig,
};
