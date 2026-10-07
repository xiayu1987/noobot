<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { BaseMetaLabel, BaseNoteBlock } from "noobot-chat/plugin-api/ui";
import { useHarnessLocale } from "../i18n/index.js";

const props = defineProps({
  latestGuidanceAnalysis: { type: Object, default: null },
});

const { translate } = useHarnessLocale();
const analysisText = computed(() => String(props.latestGuidanceAnalysis?.text || "").trim());
</script>

<template>
  <div
    v-if="analysisText"
    class="harness-guidance-analysis"
    data-thinking-block="guidance-analysis"
  >
    <BaseMetaLabel
      class="harness-guidance-analysis__title"
      :text="translate('thinkingSection.analysisFlow')"
    /><BaseNoteBlock :content="analysisText" />
  </div>
</template>

<style scoped>
.harness-guidance-analysis {
  flex: 0 0 auto;
  margin-top: 0;
  margin-bottom: var(--noobot-space-md);
  padding-bottom: var(--noobot-space-md);
  border-bottom: 1px solid var(--noobot-divider);
}
.harness-guidance-analysis__title {
  margin-bottom: var(--noobot-space-xs);
}
.harness-guidance-analysis :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
  max-height: none;
  overflow: visible;
  white-space: pre-wrap;
}
</style>
