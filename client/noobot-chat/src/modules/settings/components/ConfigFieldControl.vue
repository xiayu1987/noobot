<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { CONFIG_FORM_NODE_KIND } from "../state/configStructureContract.js";
import {
  resolveConfigConstraintText,
  resolveConfigFieldDescription,
  resolveConfigFieldLabel,
  resolveConfigNodeHint,
} from "../state/configLabels.js";
import {
  hasConfigReferenceSource,
  resolveConfigFieldOptions,
} from "../state/configReferenceOptions.js";

const props = defineProps({
  node: { type: Object, required: true },
  container: { type: [Object, Array], required: true },
  document: { type: Object, default: null },
  declarationContainer: { type: Object, default: null },
});

const { translate } = useLocale();
const KIND = CONFIG_FORM_NODE_KIND;
const rawDraft = ref("");
const rawError = ref("");

const value = computed(() => props.container?.[props.node.key]);
const isKind = (kind) => props.node.kind === kind;
const label = computed(() => resolveConfigFieldLabel(translate, props.node.key));
const hint = computed(() => resolveConfigNodeHint(translate, props.node.key));
const description = computed(() => resolveConfigFieldDescription(translate, props.node.key));
const constraintText = computed(() => resolveConfigConstraintText(props.node));
const selectOptions = computed(() =>
  resolveConfigFieldOptions(
    props.node,
    props.container,
    props.document,
    props.declarationContainer,
  ),
);
const isReferenceSelect = computed(
  () =>
    props.node.kind === KIND.STRING &&
    (hasConfigReferenceSource(props.node) || Boolean(props.node.optionsField)),
);
const isOpenOptionField = computed(
  () => props.node.kind === KIND.STRING && Boolean(props.node.optionsField),
);

function writeValue(next) {
  props.container[props.node.key] = next;
}

function writeScalar(next) {
  if (next === undefined || next === null || next === "") delete props.container[props.node.key];
  else writeValue(next);
}

watch(
  value,
  (next) => {
    if (!isKind(KIND.RAW)) return;
    rawDraft.value = next === undefined ? "" : JSON.stringify(next, null, 2);
    rawError.value = "";
  },
  { immediate: true },
);

watch(
  selectOptions,
  (options) => {
    if (!isKind(KIND.ENUM_LIST) || !Array.isArray(value.value)) return;
    const allowed = new Set(options);
    const next = value.value.filter((item) => allowed.has(item));
    if (next.length === value.value.length) return;
    if (next.length) writeValue(next);
    else delete props.container[props.node.key];
  },
  { immediate: true },
);

function syncRawDraft(text) {
  rawDraft.value = String(text ?? "");
  if (!rawDraft.value.trim()) {
    delete props.container[props.node.key];
    rawError.value = "";
    return;
  }
  try {
    writeValue(JSON.parse(rawDraft.value));
    rawError.value = "";
  } catch (error) {
    rawError.value = error?.message || translate("settings.fixJsonError");
  }
}
</script>

<template>
  <div class="config-field">
    <div class="field-label">
      <span class="field-name">{{ label }}</span>
      <span v-if="node.required" class="field-required">*</span>
      <span v-if="hint" class="field-hint">{{ hint }}</span>
    </div>
    <div v-if="description || constraintText" class="field-meta">
      <span v-if="description" class="field-description">{{ description }}</span>
      <span v-if="constraintText" class="field-constraint">{{ constraintText }}</span>
    </div>

    <div class="field-control">
      <el-switch
        v-if="isKind(KIND.BOOLEAN)"
        :model-value="value === true"
        @update:model-value="writeValue($event)"
      />
      <el-input-number
        v-else-if="isKind(KIND.INTEGER) || isKind(KIND.NUMBER)"
        :model-value="typeof value === 'number' ? value : undefined"
        :min="node.minimum ?? undefined"
        :max="node.maximum ?? undefined"
        :step="isKind(KIND.INTEGER) ? 1 : 0.1"
        :precision="isKind(KIND.INTEGER) ? 0 : 2"
        controls-position="right"
        class="field-input"
        @update:model-value="writeScalar($event)"
      />
      <el-select
        v-else-if="isKind(KIND.ENUM)"
        :model-value="value ?? ''"
        clearable
        filterable
        popper-class="noobot-select-popper"
        class="field-input"
        :placeholder="translate('settings.configSelectPlaceholder')"
        @update:model-value="writeScalar($event)"
      >
        <el-option v-for="option in selectOptions" :key="option" :label="option" :value="option" />
      </el-select>
      <el-select
        v-else-if="isReferenceSelect && (!isOpenOptionField || selectOptions.length > 0)"
        :model-value="value ?? ''"
        clearable
        filterable
        :allow-create="hasConfigReferenceSource(node) && !isOpenOptionField"
        :default-first-option="hasConfigReferenceSource(node) && !isOpenOptionField"
        popper-class="noobot-select-popper"
        class="field-input"
        :placeholder="translate('settings.configSelectPlaceholder')"
        @update:model-value="writeScalar($event)"
      >
        <el-option v-for="option in selectOptions" :key="option" :label="option" :value="option" />
      </el-select>
      <el-select
        v-else-if="isKind(KIND.ENUM_LIST)"
        :model-value="Array.isArray(value) ? value : []"
        multiple
        clearable
        popper-class="noobot-select-popper"
        class="field-input"
        :placeholder="translate('settings.configSelectPlaceholder')"
        @update:model-value="writeValue($event)"
      >
        <el-option v-for="option in selectOptions" :key="option" :label="option" :value="option" />
      </el-select>
      <el-select
        v-else-if="isKind(KIND.STRING_LIST)"
        :model-value="Array.isArray(value) ? value : []"
        multiple
        filterable
        allow-create
        default-first-option
        collapse-tags
        collapse-tags-tooltip
        popper-class="noobot-select-popper"
        class="field-input"
        :placeholder="translate('settings.configListPlaceholder')"
        @update:model-value="writeValue($event)"
      />
      <template v-else-if="isKind(KIND.RAW)">
        <el-input
          :model-value="rawDraft"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 12 }"
          spellcheck="false"
          class="field-input field-raw"
          :placeholder="translate('settings.configRawPlaceholder')"
          @update:model-value="syncRawDraft"
        />
        <div v-if="rawError" class="field-error">{{ rawError }}</div>
      </template>
      <el-input
        v-else
        :model-value="typeof value === 'string' ? value : ''"
        clearable
        class="field-input"
        :placeholder="translate('settings.configValuePlaceholder')"
        @update:model-value="writeScalar($event)"
      />
    </div>
  </div>
</template>

<style scoped>
.config-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--noobot-space-xs);
  padding: var(--noobot-space-sm) 0;
  border-bottom: 1px solid color-mix(in srgb, var(--noobot-divider) 42%, transparent);
}

.config-field:last-child {
  border-bottom: none;
}

.field-label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--noobot-space-2xs);
  min-width: 0;
}

.field-name {
  font-size: var(--noobot-font-size-md);
  color: var(--noobot-text-main);
}

.field-required {
  color: var(--noobot-status-error);
}

.field-hint {
  font-family: var(--noobot-font-mono);
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-text-muted);
  word-break: break-all;
}

.field-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
  color: var(--noobot-text-muted);
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-body);
}

.field-description {
  color: var(--noobot-text-secondary);
}

.field-constraint,
.field-scope {
  white-space: nowrap;
}

.field-control {
  min-width: 0;
}

.field-input {
  width: 100%;
  max-width: none;
}

.field-raw {
  max-width: none;
}

.field-error {
  margin-top: var(--noobot-space-2xs);
  color: var(--noobot-status-error);
  font-size: var(--noobot-font-size-xs);
}
</style>
