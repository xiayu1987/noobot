import { computed, ref } from "vue";
import { messages } from "./messages";

const STORAGE_KEY = "noobot_locale";
const FALLBACK_LOCALE = "zh-CN";
const SUPPORTED = new Set(["zh-CN", "en-US"]);

function resolveInitialLocale() {
  const saved = String(localStorage.getItem(STORAGE_KEY) || "").trim();
  if (SUPPORTED.has(saved)) return saved;
  const nav = String(globalThis?.navigator?.language || "").toLowerCase();
  if (nav.startsWith("zh")) return "zh-CN";
  return "en-US";
}

const locale = ref(resolveInitialLocale());

function setLocale(nextLocale = "") {
  const resolved = SUPPORTED.has(nextLocale) ? nextLocale : FALLBACK_LOCALE;
  locale.value = resolved;
  localStorage.setItem(STORAGE_KEY, resolved);
}

function translateKey(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), source);
}

function applyParams(text = "", params = {}) {
  let output = String(text || "");
  for (const [key, value] of Object.entries(params || {})) {
    output = output.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
}

export function useLocale() {
  const isZh = computed(() => locale.value === "zh-CN");

  function t(key = "", params = {}) {
    const table = messages[locale.value] || messages[FALLBACK_LOCALE] || {};
    const fallbackTable = messages[FALLBACK_LOCALE] || {};
    const hit = translateKey(table, key);
    const fallbackHit = translateKey(fallbackTable, key);
    const raw = hit ?? fallbackHit ?? key;
    return applyParams(raw, params);
  }

  return {
    locale,
    isZh,
    setLocale,
    t,
  };
}
