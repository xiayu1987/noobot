/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onMounted, reactive, ref } from "vue";
import {
  formatStartupMessage,
  normalizeStartupLanguage,
  startupMessages,
} from "../locales/messages.js";

const dependencyPhases = new Set(["dependency", "dependency-missing"]);
const localizedStatusKeys = Object.freeze({
  checking: "checkingService",
  starting: "startingService",
  ready: "serviceReady",
  loading: "loadingApplication",
  "super-admin-required": "setupRequired",
  "config-optional": "configOptional",
  "dependency-optional": "dependenciesOptional",
});

function normalizeModel(model, options) {
  const value = String(model || "").trim();
  const optionKeys = Array.isArray(options)
    ? options.map((item) => String(item?.key || "").trim()).filter(Boolean)
    : [];
  if (value && optionKeys.includes(value)) return value;
  return optionKeys[0] || value;
}

export function useStartupBridge() {
  const desktop = window.noobotDesktop;
  const superAdminForm = reactive({
    language: "zh-CN",
    model: "",
    userId: "",
    connectCode: "",
    dependencyProxyUrl: "",
  });
  const language = computed(() => normalizeStartupLanguage(superAdminForm.language));
  const messages = computed(() => startupMessages[language.value]);
  const messageState = ref({ key: "checkingService", raw: "" });
  const message = computed(
    () => messageState.value.raw || messages.value.status[messageState.value.key] || "",
  );
  const currentStep = ref("starting");
  const requiredParams = ref([]);
  const configValues = reactive({});
  const logEntries = ref([]);
  const lastMessage = ref("");
  const superAdminCompleted = ref(false);
  const lastDependencyRetryable = ref(false);
  const showRetry = ref(false);
  const savingSuperAdmin = ref(false);
  const savingConfig = ref(false);
  const skippingConfig = ref(false);
  const superAdminError = ref("");
  const configError = ref("");
  const dependencyError = ref("");
  const missingDependencies = ref([]);
  const installingDependencies = ref(false);
  const skippingDependencies = ref(false);
  const modelOptions = ref([]);
  const selectedDependencies = ref([]);
  const languageSelectedByUser = ref(false);
  const dependencies = [
    { key: "playwright", name: "Playwright Chromium" },
    { key: "libreoffice", name: "LibreOffice" },
    { key: "ffmpeg", name: "FFmpeg" },
    { key: "nodejs", name: "Node.js" },
  ];
  const logText = computed(() => {
    const lines = logEntries.value.map(
      (entry) => entry.raw || messages.value.status[entry.key] || "",
    );
    return lines.join("\n") + (lines.length ? "\n" : "");
  });

  function setMessage(key, raw = "") {
    messageState.value = { key, raw: String(raw || "").trim() };
  }

  function updateSuperAdminForm(nextForm) {
    if (normalizeStartupLanguage(nextForm?.language) !== language.value) {
      languageSelectedByUser.value = true;
    }
    Object.assign(superAdminForm, nextForm);
  }

  function updateConfigValues(nextValues) {
    for (const key of Object.keys(configValues)) delete configValues[key];
    Object.assign(configValues, nextValues);
  }

  function appendLogLine(line, { key = "" } = {}) {
    const text = String(line || "").trim();
    if (!text || text === lastMessage.value) return;
    lastMessage.value = text;
    logEntries.value.push({ key, raw: key ? "" : text });
    if (logEntries.value.length > 120) logEntries.value.splice(0, logEntries.value.length - 120);
  }

  function clearLog() {
    logEntries.value = [];
    lastMessage.value = "";
  }

  function hideForms() {
    if (["super-admin", "config", "dependencies"].includes(currentStep.value)) {
      currentStep.value = "starting";
    }
  }

  function setStep(step) {
    currentStep.value = step || currentStep.value;
  }

  function renderSuperAdminForm(superAdmin) {
    if (
      superAdminCompleted.value ||
      currentStep.value === "dependency" ||
      currentStep.value === "config"
    ) {
      appendLogLine(messages.value.status.setupAlreadyCompleted, { key: "setupAlreadyCompleted" });
      return;
    }
    setStep("super-admin");
    languageSelectedByUser.value = false;
    superAdminForm.language = normalizeStartupLanguage(superAdmin?.language);
    modelOptions.value = Array.isArray(superAdmin?.modelOptions)
      ? superAdmin.modelOptions.filter((item) => String(item?.key || "").trim())
      : [];
    superAdminForm.model = normalizeModel(superAdmin?.model, modelOptions.value);
    if (!modelOptions.value.length && superAdminForm.model)
      modelOptions.value = [{ key: superAdminForm.model }];
    superAdminForm.userId = superAdmin?.userId || "";
    superAdminForm.connectCode = superAdmin?.connectCode || "";
    superAdminForm.dependencyProxyUrl = superAdmin?.dependencyProxyUrl || "";
    superAdminError.value = "";
    showRetry.value = false;
  }

  function renderConfigForm(params) {
    setStep("config");
    requiredParams.value = Array.isArray(params) ? params : [];
    for (const key of Object.keys(configValues)) delete configValues[key];
    for (const item of requiredParams.value) configValues[String(item?.key || "")] = "";
    configError.value = "";
    showRetry.value = false;
    if (!requiredParams.value.length) hideForms();
  }

  function renderStatus(status) {
    if (!status) return;
    if (status.language && !languageSelectedByUser.value) {
      superAdminForm.language = normalizeStartupLanguage(status.language);
    }
    if (status.message) {
      const localizedKey = localizedStatusKeys[status.phase];
      setMessage(localizedKey || "", localizedKey ? "" : status.message);
      appendLogLine(localizedKey ? messages.value.status[localizedKey] : status.message, {
        key: localizedKey || "",
      });
    }
    if (dependencyPhases.has(status.phase) && currentStep.value !== "dependencies") {
      superAdminCompleted.value = true;
      setStep("dependency");
    }
    if (status.phase === "super-admin-required") return renderSuperAdminForm(status.superAdmin);
    if (status.phase === "config-optional") return renderConfigForm(status.params);
    if (status.phase === "dependency-optional") {
      missingDependencies.value = (Array.isArray(status.dependencies) ? status.dependencies : [])
        .filter((item) => item?.available !== true)
        .map((item) => ({ ...item }));
      selectedDependencies.value = [];
      dependencyError.value = "";
      setStep("dependencies");
      return;
    }
    if (status.phase === "dependency-missing") {
      const text = status.message || messages.value.status.dependencyMissing;
      const canRetry = status.retryable === true;
      const failureKind = status.failureKind
        ? formatStartupMessage(messages.value.status.failureKind, { kind: status.failureKind })
        : "";
      const manualHint = canRetry
        ? messages.value.status.networkRetry
        : formatStartupMessage(messages.value.status.manualDependency, { failureKind });
      setMessage("", text);
      appendLogLine(text);
      appendLogLine(manualHint);
      if (currentStep.value !== "dependencies") setStep("dependency");
      lastDependencyRetryable.value = canRetry;
      showRetry.value = canRetry;
      return;
    }
    hideForms();
    showRetry.value = status.phase === "error" && status.retryable === true;
  }

  async function submitSuperAdmin() {
    const language = normalizeStartupLanguage(superAdminForm.language);
    const model = normalizeModel(superAdminForm.model, modelOptions.value);
    const userId = String(superAdminForm.userId || "").trim();
    const connectCode = String(superAdminForm.connectCode || "").trim();
    const dependencyProxyUrl = String(superAdminForm.dependencyProxyUrl || "").trim();
    if (!userId || !connectCode || !model) {
      superAdminError.value = messages.value.setup.requiredError;
      return;
    }
    savingSuperAdmin.value = true;
    superAdminCompleted.value = true;
    setStep("dependency");
    try {
      const result = await desktop?.saveSuperAdmin({
        language,
        model,
        userId,
        connectCode,
        dependencyProxyUrl,
      });
      if (!result?.ok) {
        superAdminCompleted.value = false;
        currentStep.value = "super-admin";
        renderSuperAdminForm(
          result?.superAdmin || { language, model, userId, connectCode, dependencyProxyUrl },
        );
        superAdminError.value = result?.error || messages.value.status.setupIncomplete;
        return;
      }
      hideForms();
      setMessage("setupSaved");
    } catch (error) {
      const text = error?.message || String(error);
      setMessage("", text);
      appendLogLine(text);
      if (currentStep.value === "dependency") {
        showRetry.value = lastDependencyRetryable.value;
        if (!lastDependencyRetryable.value) {
          appendLogLine(messages.value.status.retryHidden, { key: "retryHidden" });
        }
      } else {
        currentStep.value = "super-admin";
        superAdminCompleted.value = false;
        superAdminError.value = text;
      }
    } finally {
      savingSuperAdmin.value = false;
    }
  }

  async function submitConfig() {
    savingConfig.value = true;
    try {
      const values = {};
      for (const item of requiredParams.value) {
        const key = String(item?.key || "");
        const value = String(configValues[key] || "").trim();
        if (value) values[key] = value;
      }
      await desktop?.saveConfigParams(values);
      hideForms();
      setMessage("configSaved");
    } catch (error) {
      configError.value = error?.message || String(error);
    } finally {
      savingConfig.value = false;
    }
  }

  async function skipConfig() {
    skippingConfig.value = true;
    try {
      await desktop?.skipConfigParams();
      hideForms();
      setMessage("configSkipped");
    } catch (error) {
      configError.value = error?.message || String(error);
    } finally {
      skippingConfig.value = false;
    }
  }

  async function installDependencies() {
    const selected = new Set(selectedDependencies.value);
    if (!selected.size) return;
    installingDependencies.value = true;
    dependencyError.value = "";
    try {
      await desktop?.installDependencies?.(
        Object.fromEntries(
          missingDependencies.value.map((item) => [item.key, selected.has(item.key)]),
        ),
      );
      hideForms();
      setMessage("dependenciesChecked");
    } catch (error) {
      dependencyError.value = error?.message || String(error);
    } finally {
      installingDependencies.value = false;
    }
  }

  async function skipDependencies() {
    skippingDependencies.value = true;
    dependencyError.value = "";
    try {
      await desktop?.skipDependencies?.();
      hideForms();
      setMessage("dependenciesSkipped");
    } catch (error) {
      dependencyError.value = error?.message || String(error);
    } finally {
      skippingDependencies.value = false;
    }
  }

  async function retryStartup() {
    showRetry.value = false;
    clearLog();
    setMessage("retrying");
    await desktop?.retryStartup();
  }

  onMounted(() => {
    desktop
      ?.getStartupStatuses?.()
      .then((statuses) => {
        if (Array.isArray(statuses)) statuses.forEach(renderStatus);
      })
      .catch(() => {});
    desktop?.onStartupStatus?.((status) => renderStatus(status));
  });

  return {
    message,
    messages,
    currentStep,
    requiredParams,
    configValues,
    logText,
    showRetry,
    savingSuperAdmin,
    savingConfig,
    skippingConfig,
    superAdminError,
    configError,
    dependencyError,
    modelOptions,
    selectedDependencies,
    superAdminForm,
    dependencies,
    missingDependencies,
    installingDependencies,
    skippingDependencies,
    updateSuperAdminForm,
    updateConfigValues,
    submitSuperAdmin,
    submitConfig,
    skipConfig,
    installDependencies,
    skipDependencies,
    retryStartup,
  };
}
