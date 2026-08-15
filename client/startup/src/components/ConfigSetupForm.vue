<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form class="setup-form" label-position="top" @submit.prevent="$emit('submit')">
    <p>
      {{ messages.config.intro }}
    </p>
    <section v-if="modelParams.length" class="config-param-group">
      <h3>{{ messages.config.modelParams }}</h3>
      <div class="form-grid">
        <ConfigParamField
          v-for="item in modelParams"
          :key="item.key"
          :item="item"
          :value="values[item.key]"
          :fallback-description="messages.config.valueHelp"
          @update:value="updateValue(item.key, $event)"
        />
      </div>
    </section>
    <section v-if="generalParams.length" class="config-param-group">
      <h3>{{ messages.config.otherParams }}</h3>
      <div class="form-grid">
        <ConfigParamField
          v-for="item in generalParams"
          :key="item.key"
          :item="item"
          :value="values[item.key]"
          :fallback-description="messages.config.valueHelp"
          @update:value="updateValue(item.key, $event)"
        />
      </div>
    </section>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    />
    <div class="actions">
      <el-button native-type="submit" type="primary" :loading="saving">{{
        messages.config.save
      }}</el-button>
      <el-button :loading="skipping" @click="$emit('skip')">{{ messages.config.skip }}</el-button>
    </div>
  </el-form>
</template>

<script setup>
import { computed } from "vue";
import ConfigParamField from "./ConfigParamField.vue";

const props = defineProps({
  requiredParams: { type: Array, default: () => [] },
  values: { type: Object, required: true },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  skipping: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
const emit = defineEmits(["submit", "skip", "update:values"]);
const modelParams = computed(() => props.requiredParams.filter((item) => item?.group === "model"));
const generalParams = computed(() =>
  props.requiredParams.filter((item) => item?.group !== "model"),
);

function updateValue(key, value) {
  emit("update:values", { ...props.values, [key]: value });
}
</script>
