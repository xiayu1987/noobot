import { postOpenVSCodeServerApi } from "../services/api/chatApi";
import { shouldOpenOpenVSCodeInCurrentTab as shouldOpenOpenVSCodeInCurrentTabState } from "./appShellEventHandlers";

export function useOpenVSCodeAction({
  userId,
  isMobile,
  canUseIDE,
  isSuperAdmin,
  ensureConnected,
  authFetch,
  notify,
  translate = (key) => key,
} = {}) {
  function shouldOpenOpenVSCodeInCurrentTab() {
    const userAgent = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
    return shouldOpenOpenVSCodeInCurrentTabState({
      isMobile: Boolean(isMobile?.value),
      userAgent,
    });
  }

  async function openOpenVSCode() {
    if (!ensureConnected?.()) return;
    if (!canUseIDE?.value && !isSuperAdmin?.value) {
      notify?.({ type: "warning", message: translate("infra.ideAccessDenied") });
      return;
    }
    const openInCurrentTab = shouldOpenOpenVSCodeInCurrentTab();
    const popupWindow = openInCurrentTab ? null : window.open("about:blank", "_blank");
    try {
      if (popupWindow) popupWindow.opener = null;
      const res = await postOpenVSCodeServerApi(
        { userId: userId?.value },
        { fetcher: authFetch },
      );
      const data = await res.json();
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || translate("infra.openVSCodeFailed"));
      }
      const ideUrl = new URL(String(data.url || ""), window.location.origin).toString();
      if (openInCurrentTab) {
        window.location.assign(ideUrl);
        return;
      }
      if (popupWindow && !popupWindow.closed) {
        popupWindow.location.replace(ideUrl);
      } else {
        window.open(ideUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      if (popupWindow && !popupWindow.closed) popupWindow.close();
      notify?.({ type: "error", message: error.message || translate("infra.openVSCodeFailed") });
    }
  }

  return {
    openOpenVSCode,
    shouldOpenOpenVSCodeInCurrentTab,
  };
}
