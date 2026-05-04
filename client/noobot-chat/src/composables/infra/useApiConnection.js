/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import { connectApi } from "../../services/api/chatApi";
import { useLocale } from "../../shared/i18n/useLocale";

export function useApiConnection({
  userId,
  onConnected = async () => {},
  notify = () => {},
}) {
  const { translate, locale } = useLocale();
  const connectCode = ref(localStorage.getItem("noobot_connect_code") || "");
  const apiKey = ref(localStorage.getItem("noobot_api_key") || "");
  const apiKeyUserId = ref(localStorage.getItem("noobot_api_user_id") || "");
  const apiRole = ref(localStorage.getItem("noobot_api_role") || "");
  const connecting = ref(false);

  const connected = computed(
    () =>
      Boolean(apiKey.value) &&
      String(apiKeyUserId.value || "").trim() ===
        String(userId.value || "").trim(),
  );
  const isSuperAdmin = computed(
    () => connected.value && String(apiRole.value || "") === "super_admin",
  );

  function persistApiAuth() {
    if (apiKey.value && apiKeyUserId.value) {
      localStorage.setItem("noobot_api_key", apiKey.value);
      localStorage.setItem("noobot_api_user_id", apiKeyUserId.value);
      localStorage.setItem("noobot_api_role", String(apiRole.value || ""));
      return;
    }
    localStorage.removeItem("noobot_api_key");
    localStorage.removeItem("noobot_api_user_id");
    localStorage.removeItem("noobot_api_role");
  }

  function persistConnectProfile() {
    const normalizedUserId = String(userId.value || "").trim();
    const normalizedCode = String(connectCode.value || "").trim();
    if (normalizedUserId) {
      localStorage.setItem("noobot_user_id", normalizedUserId);
    } else {
      localStorage.removeItem("noobot_user_id");
    }
    if (normalizedCode) {
      localStorage.setItem("noobot_connect_code", normalizedCode);
    } else {
      localStorage.removeItem("noobot_connect_code");
    }
  }

  function clearApiAuth() {
    apiKey.value = "";
    apiKeyUserId.value = "";
    apiRole.value = "";
    persistApiAuth();
  }

  function ensureConnected() {
    if (connected.value) return true;
    notify({ type: "warning", message: translate("infra.inputUserAndCodeFirst") });
    return false;
  }

  async function authFetch(url, options = {}) {
    const mergedHeaders = {
      ...(options.headers || {}),
      ...(apiKey.value ? { "x-api-key": apiKey.value } : {}),
      ...(String(locale.value || "").trim()
        ? { "x-noobot-locale": String(locale.value || "").trim() }
        : {}),
    };
    const res = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });
    if (res.status === 401) {
      clearApiAuth();
    }
    return res;
  }

  async function connectBackend({ silent = false } = {}) {
    if (connecting.value) return;
    if (!userId.value.trim()) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputUserFirst") });
      return;
    }
    if (!connectCode.value.trim()) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputConnectCodeFirst") });
      return;
    }
    connecting.value = true;
    try {
      const res = await connectApi({
        userId: userId.value.trim(),
        connectCode: connectCode.value.trim(),
        locale: String(locale.value || "").trim(),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.apiKey) {
        throw new Error(data.error || translate("infra.connectFailed"));
      }
      apiKey.value = String(data.apiKey || "");
      apiKeyUserId.value = String(userId.value || "").trim();
      apiRole.value = String(data.role || "user");
      persistApiAuth();
      persistConnectProfile();
      if (!silent) notify({ type: "success", message: translate("infra.connectSuccess") });
      await onConnected();
      return true;
    } catch (error) {
      clearApiAuth();
      if (!silent) notify({ type: "error", message: error.message || translate("infra.connectFailed") });
      return false;
    } finally {
      connecting.value = false;
    }
  }

  async function tryAutoConnect() {
    if (!String(userId.value || "").trim()) return false;
    if (!String(connectCode.value || "").trim()) return false;
    // 刷新页面时始终向后端重新申请一次连接，避免服务重启后本地旧 apiKey 失效
    return Boolean(await connectBackend({ silent: true }));
  }

  watch([userId, connectCode], () => {
    persistConnectProfile();
  });

  return {
    connectCode,
    apiKey,
    apiRole,
    connecting,
    connected,
    isSuperAdmin,
    ensureConnected,
    authFetch,
    connectBackend,
    tryAutoConnect,
  };
}
