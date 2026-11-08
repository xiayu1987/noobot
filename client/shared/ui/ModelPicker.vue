<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { normalizeClientModelOptions } from "@noobot/agent-config-protocol";
import { MODEL_GENERATION_OUTPUT_TYPES, sortModelsByReleaseDate } from "@noobot/model-protocol";

const props = defineProps({
  translate: { type: Function, required: true },
  drawerSize: { type: String, required: true },
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  allowDefault: { type: Boolean, default: true },
  placeholder: { type: String, default: "" },
  title: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);
const visible = defineModel("visible", { type: Boolean, default: false });
const supplier = ref(null);
const capability = ref("");
const query = ref("");
const options = computed(() => sortModelsByReleaseDate(normalizeClientModelOptions(props.options)));
const suppliers = computed(() => [...new Set(options.value.map((item) => item.supplier))].sort());
const capabilities = [
  ...MODEL_GENERATION_OUTPUT_TYPES.map((modality) => `generate:${modality}`),
  "parse:image",
  "parse:video",
  "parse:audio",
  "parse:document",
];
const filteredOptions = computed(() => {
  const search = query.value.trim().toLowerCase();
  return options.value.filter((item) => {
    if (supplier.value !== null && item.supplier !== supplier.value) return false;
    if (capability.value) {
      const [kind, modality] = capability.value.split(":");
      if (!(kind === "generate" ? item.outputModalities : item.inputModalities).includes(modality))
        return false;
    }
    return (
      !search ||
      [item.alias, item.model, item.description, item.supplier].some((value) =>
        value.toLowerCase().includes(search),
      )
    );
  });
});

function open() {
  supplier.value = null;
  capability.value = "";
  query.value = "";
  visible.value = true;
}

function select(alias) {
  emit("update:modelValue", alias);
  visible.value = false;
}
</script>

<template>
  <div class="model-picker">
    <button
      type="button"
      class="noobot-choice-control model-picker-trigger"
      :class="{ 'is-placeholder': !modelValue }"
      :disabled="disabled"
      :aria-label="title || translate('composer.modelSelection')"
      aria-haspopup="dialog"
      :aria-expanded="visible"
      @click="open"
    >
      <span class="model-picker-trigger-label">{{
        modelValue || placeholder || translate("composer.useDefaultModel")
      }}</span>
      <svg
        class="model-picker-icon model-picker-chevron"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path d="m9 5 7 7-7 7" />
      </svg>
    </button>
    <el-drawer
      v-model="visible"
      :title="title || translate('composer.modelSelection')"
      direction="rtl"
      :size="drawerSize"
      append-to-body
      destroy-on-close
      class="noobot-side-drawer model-picker-drawer"
      modal-class="noobot-side-drawer-modal"
    >
      <div class="model-picker-content">
        <el-input
          v-model="query"
          class="model-picker-search"
          clearable
          :placeholder="translate('composer.modelSearch')"
          :aria-label="translate('composer.modelSearch')"
        >
          <template #prefix>
            <svg class="model-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
          </template>
        </el-input>
        <div class="model-picker-filters">
          <div
            class="model-picker-filter"
            role="group"
            :aria-label="translate('composer.modelSupplier')"
          >
            <span class="model-picker-label">{{ translate("composer.modelSupplier") }}</span>
            <el-button :aria-pressed="supplier === null" @click="supplier = null">{{
              translate("composer.modelFilterAll")
            }}</el-button>
            <el-button
              v-for="item in suppliers"
              :key="item"
              :aria-pressed="supplier === item"
              @click="supplier = item"
              >{{ item || translate("composer.modelSupplierUnknown") }}</el-button
            >
          </div>
          <div
            class="model-picker-filter"
            role="group"
            :aria-label="translate('composer.modelCapability')"
          >
            <span class="model-picker-label">{{ translate("composer.modelCapability") }}</span>
            <el-button :aria-pressed="!capability" @click="capability = ''">{{
              translate("composer.modelFilterAll")
            }}</el-button>
            <el-button
              v-for="item in capabilities"
              :key="item"
              :aria-pressed="capability === item"
              @click="capability = capability === item ? '' : item"
              >{{ translate(`composer.modelCapabilityLabels.${item}`) }}</el-button
            >
          </div>
        </div>
        <el-button
          v-if="allowDefault"
          class="model-picker-default"
          :aria-pressed="!modelValue"
          @click="select('')"
          >{{ placeholder || translate("composer.useDefaultModel") }}</el-button
        >
        <div class="model-picker-list">
          <button
            v-for="item in filteredOptions"
            :key="item.alias"
            type="button"
            class="model-picker-option"
            :aria-pressed="modelValue === item.alias"
            @click="select(item.alias)"
          >
            <span class="model-picker-option-heading"
              ><strong>{{ item.alias }}</strong
              ><span class="model-picker-selection" aria-hidden="true">
                <svg
                  v-if="modelValue === item.alias"
                  class="model-picker-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path d="m5 12 4 4L19 6" /></svg></span
            ></span>
            <span class="model-picker-option-meta">
              <span class="model-picker-supplier">{{
                item.supplier || translate("composer.modelSupplierUnknown")
              }}</span>
              <span v-if="item.model" class="model-picker-model">{{ item.model }}</span>
            </span>
            <span v-if="item.description" class="model-picker-description">{{
              item.description
            }}</span>
            <span v-if="item.outputModalities.length" class="model-picker-badges"
              ><el-tag v-for="modality in item.outputModalities" :key="modality" size="small">{{
                translate(`composer.modelCapabilityLabels.generate:${modality}`)
              }}</el-tag></span
            >
          </button>
          <p v-if="!filteredOptions.length" class="model-picker-empty">
            {{ translate("composer.modelNoMatches") }}
          </p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.model-picker {
  width: 100%;
  min-width: 0;
}
.model-picker-content :deep(.el-button) {
  color: var(--noobot-text-main);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-control-bg);
}
.model-picker-content :deep(.el-button:hover:not(:disabled)),
.model-picker-content :deep(.el-button[aria-pressed="true"]) {
  color: var(--noobot-text-accent);
  border-color: var(--noobot-accent);
  background: var(--noobot-surface-primary-soft);
}
.model-picker-content :deep(.el-button:focus-visible),
.model-picker-option:focus-visible {
  outline: var(--noobot-focus-outline);
  outline-offset: var(--noobot-focus-outline-offset);
}
:global(.noobot-side-drawer.model-picker-drawer .el-drawer__body) {
  display: flex;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
.model-picker-search :deep(.el-input__wrapper) {
  min-height: var(--noobot-control-height-xl);
  padding-inline: var(--noobot-space-md);
}
.model-picker-badges :deep(.el-tag) {
  color: var(--noobot-text-secondary);
  border-color: var(--noobot-panel-border);
  background: var(--noobot-panel-muted);
  border-radius: var(--noobot-radius-xs);
  font-size: var(--noobot-font-size-xs);
}
.model-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-sm);
  width: 100%;
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
  font-family: var(--noobot-font-sans);
  font-size: var(--noobot-font-size-md);
  line-height: var(--noobot-line-height-comfortable);
  text-align: left;
  cursor: pointer;
}
.model-picker-trigger:focus-visible {
  outline: none;
}
.model-picker-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-picker-trigger.is-placeholder,
.model-picker-chevron {
  color: var(--noobot-text-secondary);
}
.model-picker-chevron {
  flex-shrink: 0;
}
.model-picker-content,
.model-picker-list {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
}
.model-picker-content {
  width: 100%;
  min-width: 0;
  min-height: 0;
  font-family: var(--noobot-font-sans);
  padding: var(--noobot-space-lg);
  box-sizing: border-box;
  overflow: auto;
}
.model-picker-search,
.model-picker-filters,
.model-picker-default {
  flex-shrink: 0;
}
.model-picker-filters {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
  padding: var(--noobot-space-md);
  background: var(--noobot-panel-muted);
  border: 1px solid var(--noobot-divider);
  border-radius: var(--noobot-radius-md);
}
.model-picker-list {
  min-height: var(--noobot-control-height-xl);
  flex: 1 1 auto;
  overflow: auto;
  scrollbar-gutter: stable;
  padding: var(--noobot-space-xs);
  margin: calc(-1 * var(--noobot-space-xs));
}
.model-picker-filter,
.model-picker-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
}
.model-picker-filter :deep(.el-button) {
  margin: 0;
  height: auto;
  min-height: var(--noobot-control-height-sm);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
  border-radius: var(--noobot-radius-pill);
  font-size: var(--noobot-font-size-sm);
  transition: var(--noobot-transition-colors);
}
.model-picker-filter :deep(.el-button:not([aria-pressed="true"]):not(:hover)) {
  background: transparent;
  border-color: transparent;
}
.model-picker-label {
  width: 100%;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
}
.model-picker-default {
  width: 100%;
  min-height: var(--noobot-control-height-xl);
}
.model-picker-option {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-sm);
  flex-shrink: 0;
  width: 100%;
  padding: var(--noobot-space-md);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-control-bg);
  text-align: left;
  cursor: pointer;
  color: var(--noobot-text-secondary);
  font: inherit;
  overflow-wrap: anywhere;
  transition: var(--noobot-transition-colors);
}
.model-picker-option-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--noobot-space-sm);
  color: var(--noobot-text-main);
}
.model-picker-option-heading strong {
  min-width: 0;
  font-size: var(--noobot-font-size-md);
  font-weight: var(--noobot-font-weight-semibold);
  line-height: var(--noobot-line-height-comfortable);
}
.model-picker-selection {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--noobot-space-lg);
  height: var(--noobot-space-lg);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-circle);
}
.model-picker-option[aria-pressed="true"] .model-picker-selection {
  color: var(--noobot-text-accent);
  background: var(--noobot-surface-primary-soft);
  border-color: var(--noobot-accent);
}
.model-picker-icon {
  width: var(--noobot-space-md);
  height: var(--noobot-space-md);
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.model-picker-option-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs) var(--noobot-space-sm);
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-comfortable);
}
.model-picker-supplier {
  color: var(--noobot-text-accent);
  font-weight: var(--noobot-font-weight-medium);
}
.model-picker-model {
  font-family: var(--noobot-font-mono);
}
.model-picker-description {
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-body);
}
.model-picker-option:hover,
.model-picker-option:focus-visible,
.model-picker-option[aria-pressed="true"] {
  border-color: var(--noobot-accent);
  background: var(--noobot-surface-primary-soft);
}
.model-picker-empty {
  margin: 0;
  padding: var(--noobot-space-xl) var(--noobot-space-md);
  border: 1px dashed var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  color: var(--noobot-text-secondary);
  background: var(--noobot-panel-muted);
  text-align: center;
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-body);
}
@media (max-width: 768px) {
  .model-picker-content {
    padding: var(--noobot-space-md);
    gap: var(--noobot-space-sm);
  }
  .model-picker-filters {
    padding: var(--noobot-space-sm);
    gap: var(--noobot-space-xs);
  }
  .model-picker-filter :deep(.el-button) {
    min-height: var(--noobot-control-height-md);
    flex-shrink: 0;
  }
  .model-picker-filter {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-block: var(--noobot-space-xs);
    scrollbar-width: thin;
  }
  .model-picker-label {
    width: auto;
    flex-shrink: 0;
  }
}
</style>
