import { ref } from "vue";

const STORAGE_KEY = "noobot_theme";
const SUPPORTED_THEMES = new Set(["dark", "light", "system"]);
const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
const systemThemeMedia = isBrowser && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

function resolveSystemTheme() {
  return systemThemeMedia?.matches ? "dark" : "light";
}

function resolveInitialTheme() {
  if (!isBrowser) return "dark";
  const savedTheme = String(localStorage.getItem(STORAGE_KEY) || "").trim();
  if (SUPPORTED_THEMES.has(savedTheme)) return savedTheme;
  return "dark";
}

const theme = ref(resolveInitialTheme());

function resolveAppliedTheme(nextTheme = "dark") {
  if (nextTheme === "system") return resolveSystemTheme();
  return nextTheme;
}

function applyTheme(nextTheme = "dark") {
  const resolvedTheme = SUPPORTED_THEMES.has(nextTheme) ? nextTheme : "dark";
  theme.value = resolvedTheme;
  if (!isBrowser) return;
  document.documentElement.setAttribute("data-theme", resolveAppliedTheme(resolvedTheme));
  localStorage.setItem(STORAGE_KEY, resolvedTheme);
}

applyTheme(theme.value);

if (systemThemeMedia) {
  systemThemeMedia.addEventListener("change", () => {
    if (theme.value !== "system") return;
    document.documentElement.setAttribute("data-theme", resolveSystemTheme());
  });
}

export function useTheme() {
  return {
    theme,
    applyTheme,
  };
}
