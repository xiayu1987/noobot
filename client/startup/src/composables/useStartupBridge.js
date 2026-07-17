/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onMounted, reactive, ref } from "vue";

const dependencyPhases = new Set(["dependency", "dependency-missing"]);

function normalizeLanguage(language) {
  return language === "en-US" ? "en-US" : "zh-CN";
}

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
  const message = ref("Checking local Noobot service...");
  const currentStep = ref("starting");
  const requiredParams = ref([]);
  const configValues = reactive({});
  const logLines = ref([]);
  const lastMessage = ref("");
  const superAdminCompleted = ref(false);
  const lastDependencyRetryable = ref(false);
  const showRetry = ref(false);
  const savingSuperAdmin = ref(false);
  const savingConfig = ref(false);
  const skippingConfig = ref(false);
  const superAdminError = ref("");
  const configError = ref("");
  const modelOptions = ref([]);
  const selectedDependencies = ref([]);
  const superAdminForm = reactive({ language: "zh-CN", model: "", userId: "", connectCode: "", dependencyProxyUrl: "" });
  const dependencies = [
    { key: "libreoffice", name: "LibreOffice", description: "Document conversion for Office files, spreadsheets and presentations." },
    { key: "ffmpeg", name: "FFmpeg", description: "Audio and video processing for media extraction and conversion." },
    { key: "nodejs", name: "Node.js", description: "JavaScript runtime required by local services and tooling." },
  ];
  const logText = computed(() => logLines.value.join("\n") + (logLines.value.length ? "\n" : ""));

  function updateSuperAdminForm(nextForm) {
    Object.assign(superAdminForm, nextForm);
  }

  function updateConfigValues(nextValues) {
    for (const key of Object.keys(configValues)) delete configValues[key];
    Object.assign(configValues, nextValues);
  }

  function appendLogLine(line) {
    const text = String(line || "").trim();
    if (!text || text === lastMessage.value) return;
    lastMessage.value = text;
    logLines.value.push(text);
    if (logLines.value.length > 120) logLines.value.splice(0, logLines.value.length - 120);
  }

  function clearLog() {
    logLines.value = [];
    lastMessage.value = "";
  }

  function hideForms() {
    if (currentStep.value === "super-admin" || currentStep.value === "config") currentStep.value = "starting";
  }

  function setStep(step) {
    currentStep.value = step || currentStep.value;
  }

  function renderSuperAdminForm(superAdmin) {
    if (superAdminCompleted.value || currentStep.value === "dependency" || currentStep.value === "config") {
      appendLogLine("Super admin setup is already completed for this startup session. Continuing...");
      return;
    }
    setStep("super-admin");
    superAdminForm.language = normalizeLanguage(superAdmin?.language);
    modelOptions.value = Array.isArray(superAdmin?.modelOptions)
      ? superAdmin.modelOptions.filter((item) => String(item?.key || "").trim())
      : [];
    superAdminForm.model = normalizeModel(superAdmin?.model, modelOptions.value);
    if (!modelOptions.value.length && superAdminForm.model) modelOptions.value = [{ key: superAdminForm.model }];
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
    if (status.message) {
      message.value = status.message;
      appendLogLine(status.message);
    }
    if (dependencyPhases.has(status.phase)) {
      superAdminCompleted.value = true;
      setStep("dependency");
    }
    if (status.phase === "super-admin-required") return renderSuperAdminForm(status.superAdmin);
    if (status.phase === "config-optional") return renderConfigForm(status.params);
    if (status.phase === "dependency-missing") {
      const text = status.message || "A selected dependency is missing and cannot be installed automatically.";
      const canRetry = status.retryable === true;
      const failureKind = status.failureKind ? `Failure type: ${status.failureKind}. ` : "";
      const manualHint = canRetry
        ? "This looks like a network/download problem. You can retry after checking your network."
        : `${failureKind}Retry is hidden because this does not look like a network/download problem. Please install or fix the dependency manually, adjust permissions or package URL if needed, then restart Noobot. See ~/Noobot-startup-debug.log for details.`;
      message.value = text;
      appendLogLine(text);
      appendLogLine(manualHint);
      setStep("dependency");
      lastDependencyRetryable.value = canRetry;
      showRetry.value = canRetry;
      return;
    }
    hideForms();
    showRetry.value = status.phase === "error" && status.retryable === true;
  }

  async function submitSuperAdmin() {
    const language = normalizeLanguage(superAdminForm.language);
    const model = normalizeModel(superAdminForm.model, modelOptions.value);
    const userId = String(superAdminForm.userId || "").trim();
    const connectCode = String(superAdminForm.connectCode || "").trim();
    const dependencyProxyUrl = String(superAdminForm.dependencyProxyUrl || "").trim();
    if (!userId || !connectCode || !model) {
      superAdminError.value = "Super admin username, connect code and model are required.";
      return;
    }
    savingSuperAdmin.value = true;
    superAdminCompleted.value = true;
    setStep("dependency");
    try {
      const depSet = new Set(selectedDependencies.value);
      const dependenciesPayload = { libreoffice: depSet.has("libreoffice"), ffmpeg: depSet.has("ffmpeg"), nodejs: depSet.has("nodejs") };
      if (Object.values(dependenciesPayload).some(Boolean)) message.value = "Saving setup and checking selected dependencies...";
      const result = await desktop?.saveSuperAdmin({ language, model, userId, connectCode, dependencyProxyUrl, dependencies: dependenciesPayload });
      if (!result?.ok) {
        superAdminCompleted.value = false;
        currentStep.value = "super-admin";
        renderSuperAdminForm(result?.superAdmin || { language, model, userId, connectCode, dependencyProxyUrl });
        superAdminError.value = result?.error || "Please complete super admin setup.";
        return;
      }
      hideForms();
      message.value = "Basic setup saved. Checking optional variables...";
    } catch (error) {
      const text = error?.message || String(error);
      message.value = text;
      appendLogLine(text);
      if (currentStep.value === "dependency") {
        showRetry.value = lastDependencyRetryable.value;
        if (!lastDependencyRetryable.value) appendLogLine("Retry is hidden because the last dependency failure was not marked as a network/download problem. Check ~/Noobot-startup-debug.log and fix the dependency manually before restarting Noobot.");
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
      message.value = "Configuration saved. Starting Noobot service...";
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
      message.value = "Optional configuration skipped. Starting Noobot service...";
    } catch (error) {
      configError.value = error?.message || String(error);
    } finally {
      skippingConfig.value = false;
    }
  }

  async function retryStartup() {
    showRetry.value = false;
    clearLog();
    message.value = "Retrying...";
    await desktop?.retryStartup();
  }

  onMounted(() => {
    desktop?.getStartupStatuses?.().then((statuses) => {
      if (Array.isArray(statuses)) statuses.forEach(renderStatus);
    }).catch(() => {});
    desktop?.onStartupStatus?.((status) => renderStatus(status));
  });

  return {
    message,
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
    modelOptions,
    selectedDependencies,
    superAdminForm,
    dependencies,
    updateSuperAdminForm,
    updateConfigValues,
    submitSuperAdmin,
    submitConfig,
    skipConfig,
    retryStartup,
  };
}
