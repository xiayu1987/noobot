<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  diff: { type: Object, default: null },
  translate: { type: Function, required: true },
  keyPrefix: { type: String, default: "" },
});

const rows = computed(() =>
  (props.diff?.lines || []).map((line) => ({
    old: line.type === "added" ? null : line,
    next: line.type === "removed" ? null : line,
  })),
);
</script>

<template>
  <div class="mutation-diff-split" role="table">
    <div class="mutation-diff-pane">
      <div class="mutation-diff-heading">{{ translate("message.mutationPreviewBefore") }}</div>
      <div
        v-for="(row, index) in rows"
        :key="`${keyPrefix}old-${index}`"
        class="mutation-diff-line"
        :class="row.old ? `is-${row.old.type}` : 'is-empty'"
      >
        <span class="mutation-line-number">{{ row.old?.oldLine || "" }}</span
        ><span class="mutation-line-sign">{{ row.old?.type === "removed" ? "-" : "" }}</span
        ><code>{{ row.old?.text || "" }}</code>
      </div>
    </div>
    <div class="mutation-diff-pane">
      <div class="mutation-diff-heading">{{ translate("message.mutationPreviewAfter") }}</div>
      <div
        v-for="(row, index) in rows"
        :key="`${keyPrefix}new-${index}`"
        class="mutation-diff-line"
        :class="row.next ? `is-${row.next.type}` : 'is-empty'"
      >
        <span class="mutation-line-number">{{ row.next?.newLine || "" }}</span
        ><span class="mutation-line-sign">{{ row.next?.type === "added" ? "+" : "" }}</span
        ><code>{{ row.next?.text || "" }}</code>
      </div>
    </div>
  </div>
</template>
