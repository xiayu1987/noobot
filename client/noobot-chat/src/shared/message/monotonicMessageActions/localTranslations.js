/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * 本轮消息操作组件的本地兜底文案与翻译器工厂。
 * 组件传入的 translate 命中时优先使用，否则回退到内置中文文案。
 */

export const LOCAL_TRANSLATIONS = {
  "common.cancel": "取消",
  "common.confirm": "确认",
  "message.contentRequired": "请输入消息内容",
  "message.monotonicActionFailed": "操作失败，请稍后重试",
  "message.monotonicDeleteConfirm": "确认删除本轮消息及其后续回复吗？",
  "message.monotonicDeleteTitle": "删除消息",
  "message.monotonicEdit": "编辑重发",
  "message.monotonicDelete": "删除",
  "message.monotonicEditPlaceholder": "编辑消息内容后重发",
  "message.monotonicEditTip": "Ctrl/⌘ + Enter 发送，Esc 取消",
  "message.monotonicSendEdited": "发送",
};

export function createLocalTranslator(translate = (key = "") => key) {
  return function t(key) {
    const fallbackTranslated = LOCAL_TRANSLATIONS[key] || key;
    const translated = translate(key, fallbackTranslated);
    return translated && translated !== key ? translated : fallbackTranslated;
  };
}
