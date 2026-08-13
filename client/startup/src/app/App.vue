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
          :error="superAdminError"
          :saving="savingSuperAdmin"
          @update:form="updateSuperAdminForm"
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
        <DependencySetupForm
          v-if="currentStep === 'dependencies'"
          :missing-dependencies="missingDependencies"
          :selected-dependencies="selectedDependencies"
          :error="dependencyError"
          :installing="installingDependencies"
          :skipping="skippingDependencies"
          @update:selected-dependencies="selectedDependencies = $event"
          @install="installDependencies"
          @skip="skipDependencies"
        />
        <StartupLogPanel :text="logText" />
        <RetryActions :show="showRetry" @retry="retryStartup" />
      </div>
    </section>
  </main>
</template>

<script setup>
import StartupHero from "../components/StartupHero.vue";
import SuperAdminSetupForm from "../components/SuperAdminSetupForm.vue";
import ConfigSetupForm from "../components/ConfigSetupForm.vue";
import DependencySetupForm from "../components/DependencySetupForm.vue";
import StartupLogPanel from "../components/StartupLogPanel.vue";
import RetryActions from "../components/RetryActions.vue";
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
} = useStartupBridge();
</script>
