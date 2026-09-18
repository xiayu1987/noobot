/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import {
  FALLBACK_LOCALE,
  isSupportedLocale,
  readStoredLocale,
  translateMessageKey,
  writeStoredLocale,
} from "./messageCatalog.js";

function resolveInitialLocale() {
  const saved = readStoredLocale();
  if (isSupportedLocale(saved)) return saved;
  const nav = String(globalThis?.navigator?.language || "").toLowerCase();
  if (nav.startsWith("zh")) return "zh-CN";
  return "en-US";
}

const locale = ref(resolveInitialLocale());

function setLocale(nextLocale = "") {
  const resolved = isSupportedLocale(nextLocale) ? nextLocale : FALLBACK_LOCALE;
  locale.value = resolved;
  writeStoredLocale(resolved);
}

export function useLocale() {
  const isZh = computed(() => locale.value === "zh-CN");

  function translate(key = "", params = {}) {
    return translateMessageKey(locale.value, key, params);
  }

  return {
    locale,
    isZh,
    setLocale,
    translate,
  };
}
