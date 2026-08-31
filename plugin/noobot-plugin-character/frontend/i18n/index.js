/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { useLocale } from "noobot-chat/plugin-api/locale";

const FALLBACK_LOCALE = "zh-CN";
const CHARACTER_MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    character: Object.freeze({
      feature: "角色功能",
      select: "选择角色",
      animationArtifact: "角色动画",
      collapse: "收起",
      expand: "展开",
      importGlb: "导入 GLB（自动读取动画和节点）",
      loadingSample: "正在读取…",
      loadSample: "加载 Three.js 官方样例",
      animationCount: "{count} 个动画",
      characterCount: "{count} 个角色",
      noImportedAssets: "尚未导入角色。",
      removeAsset: "删除角色",
      selectHint: "请先在右侧角色功能中导入 GLB。",
      missingArtifactAssets: "动画事件缺少角色资产描述。",
      loadError: "角色 GLB 加载失败",
      webglError: "移动设备无法创建 WebGL 上下文：{error}",
      canvasLabel: "角色动画画布",
      replayAnimation: "重新播放",
      exportImage: "导出图片",
      exportVideo: "导出视频",
      exportingVideo: "正在导出视频…",
      exportUnavailable: "当前浏览器不支持导出视频",
      exportFailed: "导出失败：{error}",
    }),
  }),
  "en-US": Object.freeze({
    character: Object.freeze({
      feature: "Character",
      select: "Select characters",
      animationArtifact: "Character animation",
      collapse: "Collapse",
      expand: "Expand",
      importGlb: "Import GLB (read animation clips and nodes)",
      loadingSample: "Loading…",
      loadSample: "Load Three.js official sample",
      animationCount: "{count} animation(s)",
      characterCount: "{count} character(s)",
      noImportedAssets: "No characters imported yet.",
      removeAsset: "Remove character",
      selectHint: "Import a GLB in the Character panel first.",
      missingArtifactAssets: "Animation event is missing character asset metadata.",
      loadError: "Failed to load character GLB",
      webglError: "Unable to create a WebGL context on this device: {error}",
      canvasLabel: "Character animation canvas",
      replayAnimation: "Replay",
      exportImage: "Export image",
      exportVideo: "Export video",
      exportingVideo: "Exporting video…",
      exportUnavailable: "Video export is not supported by this browser",
      exportFailed: "Export failed: {error}",
    }),
  }),
});

function resolvePath(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce(
      (value, part) => (value && typeof value === "object" ? value[part] : undefined),
      source,
    );
}

function applyParams(text = "", params = {}) {
  return Object.entries(params || {}).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement ?? "")),
    String(text || ""),
  );
}

export function useCharacterLocale() {
  const { locale, translate: translateGlobal } = useLocale();

  function translate(key = "", params = {}) {
    const localTable = CHARACTER_MESSAGES[locale.value] || CHARACTER_MESSAGES[FALLBACK_LOCALE];
    const fallbackTable = CHARACTER_MESSAGES[FALLBACK_LOCALE];
    const raw = resolvePath(localTable, key) ?? resolvePath(fallbackTable, key);
    return raw === undefined ? translateGlobal(key, params) : applyParams(raw, params);
  }

  return { locale, translate };
}
