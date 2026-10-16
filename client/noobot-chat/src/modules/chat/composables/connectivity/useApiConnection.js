/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import { connectApi } from "../../../../infrastructure/api/chat/chatApi.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { normalizeClientModelOptions } from "@noobot/agent-config-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { isPlainObject, text } from "@noobot/shared/value";

const CONNECTION_PROFILE_STORAGE_KEY = "noobot_connection_profile";
const ADMISSION_MAX_RETRIES = TURN_THRESHOLDS.client.admissionMaxRetries;
const ADMISSION_MIN_DELAY_MS = TIME_THRESHOLDS.client.admissionRetryMinDelayMs;
const ADMISSION_MAX_DELAY_MS = TIME_THRESHOLDS.client.admissionRetryMaxDelayMs;

function admissionRetryDelayMs(response) {
  const seconds = Number(response?.headers?.get?.("retry-after"));
  const delayMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.min(ADMISSION_MAX_DELAY_MS, Math.max(ADMISSION_MIN_DELAY_MS, delayMs));
}

function waitMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithAdmissionRetry(runFetch, { isStale = () => false } = {}) {
  let res = await runFetch();
  for (let attempt = 0; res.status === 429 && attempt < ADMISSION_MAX_RETRIES; attempt += 1) {
    await waitMs(admissionRetryDelayMs(res));
    if (isStale()) return null;
    res = await runFetch();
  }
  return res;
}

function readConnectionProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONNECTION_PROFILE_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const userId = text(parsed.userId);
    const connectCode = text(parsed.connectCode);
    return userId && connectCode ? { userId, connectCode } : null;
  } catch {
    return null;
  }
}

export function useApiConnection({ userId, onConnected = async () => {}, notify = () => {} }) {
  const { translate, locale } = useLocale();
  const restoredConnectionProfile = readConnectionProfile();
  const initialUserId = text(userId.value);
  let restoredConnectCode = restoredConnectionProfile?.userId === initialUserId;
  const connectCode = ref(
    restoredConnectionProfile?.userId === initialUserId
      ? restoredConnectionProfile.connectCode
      : "",
  );
  const apiKey = ref("");
  const apiKeyUserId = ref("");
  const apiRole = ref("");
  const scenarioConfig = ref({
    default: "",
    definitions: {},
    plugins: {},
    enabledModels: [],
    defaultModelAlias: "",
  });
  const permissions = ref({
    canUseIDE: false,
  });
  const connecting = ref(false);
  let activeAuthentication = null;
  let activeConnectedCallback = null;
  let activeConnectCallCount = 0;

  const connected = computed(
    () => Boolean(apiKey.value) && text(apiKeyUserId.value) === text(userId.value),
  );
  const isSuperAdmin = computed(
    () => connected.value && String(apiRole.value || "") === "super_admin",
  );
  const canUseIDE = computed(
    () => connected.value && (isSuperAdmin.value || permissions.value.canUseIDE === true),
  );

  function removeLegacyCredentials() {
    localStorage.removeItem("noobot_api_key");
    localStorage.removeItem("noobot_api_user_id");
    localStorage.removeItem("noobot_api_role");
    localStorage.removeItem("noobot_connect_code");
  }

  function persistConnectProfile() {
    const normalizedUserId = text(userId.value);
    const normalizedConnectCode = text(connectCode.value);
    if (normalizedUserId && normalizedConnectCode) {
      localStorage.setItem("noobot_user_id", normalizedUserId);
      localStorage.setItem(
        CONNECTION_PROFILE_STORAGE_KEY,
        JSON.stringify({ userId: normalizedUserId, connectCode: normalizedConnectCode }),
      );
    } else {
      localStorage.removeItem("noobot_user_id");
      localStorage.removeItem(CONNECTION_PROFILE_STORAGE_KEY);
    }
  }

  function clearConnectionProfile() {
    localStorage.removeItem(CONNECTION_PROFILE_STORAGE_KEY);
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
      defaultModelAlias: "",
    };
    permissions.value = {
      canUseIDE: false,
    };
  }

  function snapshotCredentials() {
    const credentials = {
      userId: text(userId.value),
      connectCode: text(connectCode.value),
    };
    return {
      ...credentials,
      key: JSON.stringify([credentials.userId, credentials.connectCode]),
    };
  }

  removeLegacyCredentials();
  if (restoredConnectionProfile && restoredConnectionProfile.userId !== initialUserId) {
    clearConnectionProfile();
  }

  function normalizeScenarioConfig(input = {}) {
    const source = isPlainObject(input) ? input : {};
    const definitionsSource = isPlainObject(source?.definitions) ? source.definitions : {};
    const normalizedDefinitions = {};
    for (const [scenarioKey, definitionItem] of Object.entries(definitionsSource)) {
      const normalizedScenarioKey = text(scenarioKey);
      if (!normalizedScenarioKey) continue;
      const sourceDefinition = isPlainObject(definitionItem) ? definitionItem : {};
      normalizedDefinitions[normalizedScenarioKey] = {
        ...sourceDefinition,
        name: text(sourceDefinition?.name),
        description: text(sourceDefinition?.description),
        model: text(sourceDefinition?.model),
        tools: Array.isArray(sourceDefinition?.tools)
          ? sourceDefinition.tools.map((toolName) => text(toolName)).filter(Boolean)
          : [],
        context: Array.isArray(sourceDefinition?.context)
          ? sourceDefinition.context.map((contextKey) => text(contextKey)).filter(Boolean)
          : [],
        services: Array.isArray(sourceDefinition?.services)
          ? sourceDefinition.services.map((serviceItem) => text(serviceItem)).filter(Boolean)
          : [],
        mcpServers: Array.isArray(sourceDefinition?.mcpServers)
          ? sourceDefinition.mcpServers.map((serverItem) => text(serverItem)).filter(Boolean)
          : [],
      };
    }
    const pluginSource = isPlainObject(source?.plugins) ? source.plugins : {};
    const normalizedPlugins = {};
    for (const [pluginKey, pluginValue] of Object.entries(pluginSource)) {
      const normalizedPluginKey = text(pluginKey);
      if (!normalizedPluginKey) continue;
      const sourcePlugin = isPlainObject(pluginValue) ? pluginValue : {};
      const normalizedMode = text(sourcePlugin?.mode).toLowerCase();
      normalizedPlugins[normalizedPluginKey] = {
        ...sourcePlugin,
        description: text(sourcePlugin?.description),
        enabled: sourcePlugin?.enabled !== false,
        mode: normalizedMode === "on" ? "on" : "off",
      };
    }
    return {
      default: text(source?.default),
      definitions: normalizedDefinitions,
      plugins: normalizedPlugins,
      enabledModels: normalizeClientModelOptions(source?.enabledModels),
      defaultModelAlias: text(source?.defaultModelAlias),
    };
  }

  function ensureConnected() {
    if (connected.value) return true;
    notify({ type: "warning", message: translate("infra.inputUserAndCodeFirst") });
    return false;
  }

  async function authFetch(url, options = {}) {
    const requestApiKey = String(apiKey.value || "");
    const runFetch = () =>
      fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(apiKey.value ? { "x-api-key": apiKey.value } : {}),
          ...(text(locale.value) ? { "x-noobot-locale": text(locale.value) } : {}),
        },
      });
    const res = await fetchWithAdmissionRetry(runFetch);
    if (res.status !== 401) return res;
    const refreshed =
      apiKey.value && apiKey.value !== requestApiKey ? true : await refreshAuthentication();
    if (refreshed && apiKey.value && apiKey.value !== requestApiKey) {
      const retryResponse = await fetchWithAdmissionRetry(runFetch);
      if (retryResponse.status === 401) clearApiAuth();
      return retryResponse;
    }
    clearApiAuth();
    return res;
  }

  async function authenticate(credentials) {
    const res = await fetchWithAdmissionRetry(
      () =>
        connectApi({
          userId: credentials.userId,
          connectCode: credentials.connectCode,
          locale: text(locale.value),
        }),
      { isStale: () => snapshotCredentials().key !== credentials.key },
    );
    if (!res) return false;
    const data = await res.json();
    if (!res.ok || !data.ok || !data.apiKey) {
      throw new Error(data.error || translate("infra.connectFailed"));
    }
    const authenticatedUserId = text(data.userId);
    if (!authenticatedUserId || authenticatedUserId !== credentials.userId) {
      throw new Error("authentication_identity_mismatch");
    }
    if (snapshotCredentials().key !== credentials.key) return false;
    apiKey.value = String(data.apiKey || "");
    apiKeyUserId.value = authenticatedUserId;
    apiRole.value = String(data.role || "user");
    scenarioConfig.value = normalizeScenarioConfig({
      ...(data?.scenarios || {}),
      plugins: data?.plugins,
      enabledModels: data?.enabledModels,
      defaultModelAlias: data?.defaultModelAlias,
    });
    permissions.value = {
      canUseIDE: text(data?.role) === "super_admin" || data?.permissions?.canUseIDE === true,
    };
    persistConnectProfile();
    return true;
  }

  function acquireAuthentication(credentials) {
    if (activeAuthentication?.key === credentials.key) {
      return activeAuthentication.promise;
    }
    const authentication = { key: credentials.key, promise: null };
    authentication.promise = authenticate(credentials).finally(() => {
      if (activeAuthentication === authentication) activeAuthentication = null;
    });
    activeAuthentication = authentication;
    return authentication.promise;
  }

  function runConnectedCallback(credentials) {
    if (activeConnectedCallback?.key === credentials.key) {
      return activeConnectedCallback.promise;
    }
    const previous = activeConnectedCallback?.promise.catch(() => false) || Promise.resolve();
    const callback = { key: credentials.key, promise: null };
    callback.promise = previous
      .then(async () => {
        if (
          snapshotCredentials().key !== credentials.key ||
          text(apiKeyUserId.value) !== credentials.userId
        ) {
          return false;
        }
        await onConnected();
        return (
          snapshotCredentials().key === credentials.key &&
          text(apiKeyUserId.value) === credentials.userId
        );
      })
      .finally(() => {
        if (activeConnectedCallback === callback) activeConnectedCallback = null;
      });
    activeConnectedCallback = callback;
    return callback.promise;
  }

  async function connectBackend({ silent = false, runConnected = true } = {}) {
    const credentials = snapshotCredentials();
    if (!credentials.userId) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputUserFirst") });
      return false;
    }
    if (!credentials.connectCode) {
      if (!silent) notify({ type: "warning", message: translate("infra.inputConnectCodeFirst") });
      return false;
    }
    activeConnectCallCount += 1;
    connecting.value = true;
    try {
      const authenticated = await acquireAuthentication(credentials);
      if (!authenticated || snapshotCredentials().key !== credentials.key) return false;
      if (!silent) {
        notify({
          type: "success",
          message: `${translate("infra.connectSuccess")} (role=${apiRole.value || "user"})`,
        });
      }
      if (runConnected && !(await runConnectedCallback(credentials))) return false;
      return (
        snapshotCredentials().key === credentials.key &&
        text(apiKeyUserId.value) === credentials.userId
      );
    } catch (error) {
      if (runConnected && snapshotCredentials().key === credentials.key) clearApiAuth();
      if (!silent)
        notify({ type: "error", message: error.message || translate("infra.connectFailed") });
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
    if (!text(userId.value)) return false;
    if (!text(connectCode.value)) return false;
    return Boolean(await connectBackend({ silent: true }));
  }

  watch(
    [userId, connectCode],
    ([nextUserId, nextConnectCode], [previousUserId, previousConnectCode]) => {
      clearApiAuth();
      if (text(nextUserId) !== text(previousUserId)) {
        if (restoredConnectCode) connectCode.value = "";
        restoredConnectCode = false;
        clearConnectionProfile();
        return;
      }
      if (text(nextConnectCode) !== text(previousConnectCode)) {
        if (!restoredConnectCode) clearConnectionProfile();
        restoredConnectCode = false;
      }
    },
  );

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
