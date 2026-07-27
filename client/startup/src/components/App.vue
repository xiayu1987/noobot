<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <main class="startup-shell">
    <section class="startup-card">
      <StartupHero :message="message" />
      <div class="content">
        <SuperAdminSetupForm
          v-if="currentStep === 'super-admin'"
          :form="superAdminForm"
          :model-options="modelOptions"
          :dependencies="dependencies"
          :selected-dependencies="selectedDependencies"
          :error="superAdminError"
          :saving="savingSuperAdmin"
          @update:form="updateSuperAdminForm"
          @update:selected-dependencies="selectedDependencies = $event"
          @submit="submitSuperAdmin"
        />
        <ConfigSetupForm
          v-if="currentStep === 'config'"
          :required-params="requiredParams"
          :values="configValues"
          :error="configError"
          :saving="savingConfig"
          :skipping="skippingConfig"
          @update:values="updateConfigValues"
          @submit="submitConfig"
          @skip="skipConfig"
        />
        <StartupLogPanel :text="logText" />
        <RetryActions :show="showRetry" @retry="retryStartup" />
      </div>
    </section>
  </main>
</template>

<script setup>
import StartupHero from "./StartupHero.vue";
import SuperAdminSetupForm from "./SuperAdminSetupForm.vue";
import ConfigSetupForm from "./ConfigSetupForm.vue";
import StartupLogPanel from "./StartupLogPanel.vue";
import RetryActions from "./RetryActions.vue";
import { useStartupBridge } from "../composables/useStartupBridge.js";

const {
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
} = useStartupBridge();
</script>
