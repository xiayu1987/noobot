/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { parseWorkflowDslPayload } from "./workflowDsl";

export function useWorkflowMeta(props) {
  const parsedDslPayload = computed(() => parseWorkflowDslPayload(props.messageItem?.content) || {});

  const workflowMeta = computed(() =>
    props.messageItem?.pluginMeta &&
    typeof props.messageItem.pluginMeta === "object" &&
    !Array.isArray(props.messageItem.pluginMeta)
      ? props.messageItem.pluginMeta
      : {},
  );

  const workflowPayload = computed(() => {
    const metaPayload =
      workflowMeta.value?.payload &&
      typeof workflowMeta.value.payload === "object" &&
      !Array.isArray(workflowMeta.value.payload)
        ? workflowMeta.value.payload
        : {};
    const parsedPayload =
      parsedDslPayload.value &&
      typeof parsedDslPayload.value === "object" &&
      !Array.isArray(parsedDslPayload.value)
        ? parsedDslPayload.value
        : {};
    const metaSemantic =
      metaPayload.semantic &&
      typeof metaPayload.semantic === "object" &&
      !Array.isArray(metaPayload.semantic)
        ? metaPayload.semantic
        : {};
    const parsedSemantic =
      parsedPayload.semantic &&
      typeof parsedPayload.semantic === "object" &&
      !Array.isArray(parsedPayload.semantic)
        ? parsedPayload.semantic
        : {};
    const hasMetaNodes = Array.isArray(metaSemantic.nodes) && metaSemantic.nodes.length > 0;
    if (hasMetaNodes || !Object.keys(parsedPayload).length) return metaPayload;
    return {
      ...parsedPayload,
      ...metaPayload,
      semantic: {
        ...parsedSemantic,
        ...metaSemantic,
        nodes: Array.isArray(metaSemantic.nodes) && metaSemantic.nodes.length
          ? metaSemantic.nodes
          : parsedSemantic.nodes,
        flowtos: Array.isArray(metaSemantic.flowtos) && metaSemantic.flowtos.length
          ? metaSemantic.flowtos
          : parsedSemantic.flowtos,
      },
      interaction: {
        ...(parsedPayload.interaction || {}),
        ...(metaPayload.interaction || {}),
      },
    };
  });

  const semanticFlowtos = computed(() =>
    Array.isArray(workflowPayload.value?.semantic?.flowtos)
      ? workflowPayload.value.semantic.flowtos
      : [],
  );

  const semanticPreview = computed(
    () =>
      String(
        workflowMeta.value?.semanticTextPreview ||
          workflowPayload.value?.interaction?.semanticTextPreview ||
          props.messageItem?.content ||
          "",
      ).trim(),
  );

  const semanticPreviewLineCount = computed(() =>
    String(semanticPreview.value || "").split(/\r?\n/).length,
  );

  const semanticPreviewCollapsible = computed(
    () => semanticPreviewLineCount.value > 8 || String(semanticPreview.value || "").length > 900,
  );

  return {
    workflowMeta,
    workflowPayload,
    semanticFlowtos,
    semanticPreview,
    semanticPreviewLineCount,
    semanticPreviewCollapsible,
  };
}
