/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { connectApi } from "../api/chatApi";

export function useApiConnection({ userId, onConnected = async () => {} }) {
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
    ElMessage.warning("请先输入用户名和连接码，点击连接");
    return false;
  }

  async function authFetch(url, options = {}) {
    const mergedHeaders = {
      ...(options.headers || {}),
      ...(apiKey.value ? { "x-api-key": apiKey.value } : {}),
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
      if (!silent) ElMessage.warning("请先输入用户名");
      return;
    }
    if (!connectCode.value.trim()) {
      if (!silent) ElMessage.warning("请输入连接码");
      return;
    }
    connecting.value = true;
    try {
      const res = await connectApi({
        userId: userId.value.trim(),
        connectCode: connectCode.value.trim(),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.apiKey) {
        throw new Error(data.error || "连接失败");
      }
      apiKey.value = String(data.apiKey || "");
      apiKeyUserId.value = String(userId.value || "").trim();
      apiRole.value = String(data.role || "user");
      persistApiAuth();
      persistConnectProfile();
      if (!silent) ElMessage.success("连接成功");
      await onConnected();
      return true;
    } catch (error) {
      clearApiAuth();
      if (!silent) ElMessage.error(error.message || "连接失败");
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
