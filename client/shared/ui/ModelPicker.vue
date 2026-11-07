<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { normalizeClientModelOptions } from "@noobot/agent-config-protocol";
import { MODEL_GENERATION_OUTPUT_TYPES } from "@noobot/model-protocol";

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
const options = computed(() => normalizeClientModelOptions(props.options));
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
    <el-button
      class="model-picker-trigger"
      :disabled="disabled"
      :aria-label="title || translate('composer.modelSelection')"
      aria-haspopup="dialog"
      :aria-expanded="visible"
      @click="open"
    >
      <span>{{ modelValue || placeholder || translate("composer.useDefaultModel") }}</span>
      <span aria-hidden="true">›</span>
    </el-button>
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
          clearable
          :placeholder="translate('composer.modelSearch')"
          :aria-label="translate('composer.modelSearch')"
        />
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
              ><span>{{ item.supplier || translate("composer.modelSupplierUnknown") }}</span></span
            >
            <span v-if="item.model">{{ item.model }}</span>
            <span v-if="item.description">{{ item.description }}</span>
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
.model-picker-trigger,
.model-picker-content :deep(.el-button) {
  color: var(--noobot-text-main);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-control-bg);
}
.model-picker-trigger:hover:not(:disabled),
.model-picker-content :deep(.el-button:hover:not(:disabled)),
.model-picker-content :deep(.el-button[aria-pressed="true"]) {
  color: var(--noobot-text-accent);
  border-color: var(--noobot-accent);
  background: var(--noobot-surface-primary-soft);
}
.model-picker-trigger:focus-visible,
.model-picker-content :deep(.el-button:focus-visible),
.model-picker-option:focus-visible {
  outline: var(--noobot-focus-outline);
  outline-offset: var(--noobot-focus-outline-offset);
}
.model-picker-trigger:disabled {
  color: var(--noobot-text-secondary);
  background: var(--noobot-panel-muted);
}
:global(.model-picker-drawer) {
  background: var(--noobot-panel-bg);
  color: var(--noobot-text-main);
}
:global(.model-picker-drawer .el-drawer__header),
:global(.model-picker-drawer .el-drawer__close-btn) {
  color: var(--noobot-text-main);
}
:global(.model-picker-drawer .el-drawer__close-btn:hover) {
  color: var(--noobot-text-accent);
}
.model-picker-content :deep(.el-input__wrapper) {
  background: var(--noobot-control-bg);
  box-shadow: 0 0 0 1px var(--noobot-panel-border) inset;
}
.model-picker-content :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--noobot-accent) inset;
}
.model-picker-content :deep(.el-input__inner) {
  color: var(--noobot-text-main);
}
.model-picker-content :deep(.el-input__inner::placeholder),
.model-picker-content :deep(.el-input__icon) {
  color: var(--noobot-text-secondary);
}
.model-picker-badges :deep(.el-tag) {
  color: var(--noobot-text-accent);
  border-color: var(--noobot-panel-border);
  background: var(--noobot-surface-primary-soft);
}
.model-picker-trigger {
  width: 100%;
  height: auto;
  min-height: var(--noobot-control-height-sm);
}
.model-picker-trigger :deep(span) {
  display: flex;
  justify-content: space-between;
  gap: var(--noobot-space-sm);
  width: 100%;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.model-picker-content,
.model-picker-list {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
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
  border-radius: var(--noobot-radius-pill);
  font-size: var(--noobot-font-size-sm);
}
.model-picker-label {
  width: 100%;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
}
.model-picker-default {
  align-self: flex-start;
}
.model-picker-option {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
  width: 100%;
  padding: var(--noobot-space-md);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-control-bg);
  text-align: left;
  cursor: pointer;
  color: var(--noobot-text-secondary);
  font: inherit;
  overflow-wrap: anywhere;
}
.model-picker-option-heading {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--noobot-space-sm);
  color: var(--noobot-text-main);
}
.model-picker-option:hover,
.model-picker-option:focus-visible,
.model-picker-option[aria-pressed="true"] {
  border-color: var(--noobot-accent);
  background: var(--noobot-surface-primary-soft);
}
.model-picker-empty {
  color: var(--noobot-text-secondary);
}
</style>
