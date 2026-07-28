/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import { connectApi } from "../../../../infrastructure/api/chat/chatApi.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";

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
  const scenarioConfig = ref({
    default: "",
    definitions: {},
    plugins: {},
    enabledModels: [],
    defaultModel: null,
    defaultModelAlias: "",
  });
  const permissions = ref({
    canUseIDE: false,
  });
  const connecting = ref(false);
  let authenticationPromise = null;
  let connectedCallbackPromise = null;
  let activeConnectCallCount = 0;

  const connected = computed(
    () =>
      Boolean(apiKey.value) &&
      String(apiKeyUserId.value || "").trim() ===
        String(userId.value || "").trim(),
  );
  const isSuperAdmin = computed(
    () => connected.value && String(apiRole.value || "") === "super_admin",
  );
  const canUseIDE = computed(
    () => connected.value && (isSuperAdmin.value || permissions.value.canUseIDE === true),
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
    scenarioConfig.value = {
      default: "",
      definitions: {},
      plugins: {},
      enabledModels: [],
      defaultModel: null,
      defaultModelAlias: "",
    };
    permissions.value = {
      canUseIDE: false,
    };
    persistApiAuth();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }


  function normalizeEnabledModels(input = []) {
    const optionMap = new Map();
    const addModel = (rawItem = {}) => {
      const value = String(
        typeof rawItem === "string"
          ? rawItem
          : rawItem?.value || rawItem?.alias || rawItem?.key || rawItem?.model || "",
      ).trim();
      if (!value || optionMap.has(value)) return;
      const label = String(
        typeof rawItem === "string"
          ? rawItem
          : rawItem?.label || rawItem?.name || rawItem?.alias || rawItem?.model || value,
      ).trim() || value;
      optionMap.set(value, {
        value,
        alias: String(typeof rawItem === "string" ? rawItem : rawItem?.alias || value).trim() || value,
        key: String(typeof rawItem === "string" ? rawItem : rawItem?.key || rawItem?.alias || value).trim() || value,
        label,
        name: String(typeof rawItem === "string" ? label : rawItem?.name || label).trim() || label,
        model: String(typeof rawItem === "string" ? "" : rawItem?.model || "").trim(),
        description: String(typeof rawItem === "string" ? "" : rawItem?.description || "").trim(),
      });
    };
    (Array.isArray(input) ? input : []).forEach(addModel);
    return Array.from(optionMap.values());
  }

  function normalizeScenarioConfig(input = {}) {
    const source = isPlainObject(input) ? input : {};
    const definitionsSource = isPlainObject(source?.definitions)
      ? source.definitions
      : {};
    const normalizedDefinitions = {};
    for (const [scenarioKey, definitionItem] of Object.entries(definitionsSource)) {
      const normalizedScenarioKey = String(scenarioKey || "").trim();
      if (!normalizedScenarioKey) continue;
      const sourceDefinition = isPlainObject(definitionItem) ? definitionItem : {};
      normalizedDefinitions[normalizedScenarioKey] = {
        ...sourceDefinition,
        name: String(sourceDefinition?.name || "").trim(),
        description: String(sourceDefinition?.description || "").trim(),
        model: String(sourceDefinition?.model || "").trim(),
        tools: Array.isArray(sourceDefinition?.tools)
          ? sourceDefinition.tools
              .map((toolName) => String(toolName || "").trim())
              .filter(Boolean)
          : [],
        context: Array.isArray(sourceDefinition?.context)
          ? sourceDefinition.context
              .map((contextKey) => String(contextKey || "").trim())
              .filter(Boolean)
          : [],
        services: Array.isArray(sourceDefinition?.services)
          ? sourceDefinition.services
              .map((serviceItem) => String(serviceItem || "").trim())
              .filter(Boolean)
          : [],
        mcpServers: Array.isArray(sourceDefinition?.mcpServers)
          ? sourceDefinition.mcpServers
              .map((serverItem) => String(serverItem || "").trim())
              .filter(Boolean)
          : Array.isArray(sourceDefinition?.mcp_servers)
            ? sourceDefinition.mcp_servers
                .map((serverItem) => String(serverItem || "").trim())
                .filter(Boolean)
            : [],
      };
    }
    const pluginSource = isPlainObject(source?.plugins) ? source.plugins : {};
    const normalizedPlugins = {};
    for (const [pluginKey, pluginValue] of Object.entries(pluginSource)) {
      const normalizedPluginKey = String(pluginKey || "").trim();
      if (!normalizedPluginKey) continue;
      const sourcePlugin = isPlainObject(pluginValue) ? pluginValue : {};
      const normalizedMode = String(sourcePlugin?.mode || "")
        .trim()
        .toLowerCase();
      normalizedPlugins[normalizedPluginKey] = {
        ...sourcePlugin,
        name: String(sourcePlugin?.name || sourcePlugin?.label || normalizedPluginKey).trim(),
        label: String(sourcePlugin?.label || sourcePlugin?.name || normalizedPluginKey).trim(),
        description: String(sourcePlugin?.description || "").trim(),
        enabled: sourcePlugin?.enabled !== false,
        mode: normalizedMode === "on" ? "on" : "off",
      };
    }
    return {
      default: String(source?.default || "").trim(),
      definitions: normalizedDefinitions,
      plugins: normalizedPlugins,
      enabledModels: normalizeEnabledModels(source?.enabledModels || source?.models || []),
      defaultModel: normalizeEnabledModels([source?.defaultModel]).at(0) || null,
      defaultModelAlias: String(source?.defaultModelAlias || source?.defaultModel?.alias || source?.defaultModel?.value || "").trim(),
    };
  }

  function ensureConnected() {
    if (connected.value) return true;
    notify({ type: "warning", message: translate("infra.inputUserAndCodeFirst") });
    return false;
  }

  async function authFetch(url, options = {}) {
    const requestApiKey = String(apiKey.value || "");
    const runFetch = () => fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(apiKey.value ? { "x-api-key": apiKey.value } : {}),
        ...(String(locale.value || "").trim()
          ? { "x-noobot-locale": String(locale.value || "").trim() }
          : {}),
      },
    });
    const res = await runFetch();
    if (res.status !== 401) return res;
    const refreshed = apiKey.value && apiKey.value !== requestApiKey
      ? true
      : await refreshAuthentication();
    if (refreshed && apiKey.value && apiKey.value !== requestApiKey) {
      const retryResponse = await runFetch();
      if (retryResponse.status === 401) clearApiAuth();
      return retryResponse;
    }
    clearApiAuth();
    return res;
  }

  async function authenticate() {
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
    scenarioConfig.value = normalizeScenarioConfig({
      ...(data?.scenarios || {}),
      plugins: data?.plugins || data?.scenarios?.plugins || {},
      enabledModels: data?.enabledModels || data?.models || data?.scenarios?.enabledModels || [],
      defaultModel: data?.defaultModel || data?.scenarios?.defaultModel || null,
      defaultModelAlias: data?.defaultModelAlias || data?.scenarios?.defaultModelAlias || "",
    });
    permissions.value = {
      canUseIDE:
        String(data?.role || "").trim() === "super_admin" ||
        data?.permissions?.canUseIDE === true,
    };
    persistApiAuth();
    persistConnectProfile();
    return true;
  }

  function acquireAuthentication() {
    if (authenticationPromise) return authenticationPromise;
    authenticationPromise = authenticate().finally(() => {
      authenticationPromise = null;
    });
    return authenticationPromise;
  }

  function runConnectedCallback() {
    if (connectedCallbackPromise) return connectedCallbackPromise;
    connectedCallbackPromise = Promise.resolve().then(() => onConnected()).finally(() => {
      connectedCallbackPromise = null;
    });
    return connectedCallbackPromise;
  }

  async function connectBackend({ silent = false, runConnected = true } = {}) {
    if (!userId.value.trim()) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputUserFirst") });
      return false;
    }
    if (!connectCode.value.trim()) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputConnectCodeFirst") });
      return false;
    }
    activeConnectCallCount += 1;
    connecting.value = true;
    try {
      await acquireAuthentication();
      if (!silent) {
        notify({
          type: "success",
          message: `${translate("infra.connectSuccess")} (role=${apiRole.value || "user"})`,
        });
      }
      if (runConnected) await runConnectedCallback();
      return true;
    } catch (error) {
      if (runConnected) clearApiAuth();
      if (!silent) notify({ type: "error", message: error.message || translate("infra.connectFailed") });
      return false;
    } finally {
      activeConnectCallCount = Math.max(0, activeConnectCallCount - 1);
      connecting.value = activeConnectCallCount > 0;
    }
  }

  function refreshAuthentication() {
    return connectBackend({ silent: true, runConnected: false });
  }

  async function tryAutoConnect() {
    if (!String(userId.value || "").trim()) return false;
    if (!String(connectCode.value || "").trim()) return false;
    return Boolean(await connectBackend({ silent: true }));
  }

  watch([userId, connectCode], () => {
    persistConnectProfile();
  });

  return {
    connectCode,
    apiKey,
    apiRole,
    scenarioConfig,
    permissions,
    connecting,
    connected,
    isSuperAdmin,
    canUseIDE,
    ensureConnected,
    authFetch,
    refreshAuthentication,
    connectBackend,
    tryAutoConnect,
  };
}
