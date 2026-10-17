/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { isPlainObject } from "@noobot/shared/value";

export function useWorkflowMeta(props) {
  const workflowMeta = computed(() =>
    isPlainObject(props.messageItem?.pluginMeta) ? props.messageItem.pluginMeta : {},
  );

  const workflowPayload = computed(() =>
    isPlainObject(workflowMeta.value?.payload) ? workflowMeta.value.payload : {},
  );

  const semanticFlowtos = computed(() =>
    Array.isArray(workflowPayload.value?.semantic?.flowtos)
      ? workflowPayload.value.semantic.flowtos
      : [],
  );

  const semanticPreview = computed(() =>
    String(
      workflowMeta.value?.semanticTextPreview ||
        workflowPayload.value?.interaction?.semanticTextPreview ||
        "",
    ).trim(),
  );

  const semanticPreviewLineCount = computed(
    () => String(semanticPreview.value || "").split(/\r?\n/).length,
  );

  return {
    workflowMeta,
    workflowPayload,
    semanticFlowtos,
    semanticPreview,
    semanticPreviewLineCount,
  };
}
