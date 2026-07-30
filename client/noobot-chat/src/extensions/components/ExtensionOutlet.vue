<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onErrorCaptured } from "vue";
import {
  resolveExtensionListeners,
  resolveExtensionPoint,
  resolveExtensionProps,
} from "../extension-registry.js";

const props = defineProps({
  point: { type: String, required: true },
  context: { type: Object, default: () => ({}) },
  extraProps: { type: Object, default: () => ({}) },
  extraListeners: { type: Object, default: () => ({}) },
  includeContributionIds: { type: Array, default: null },
  excludeContributionIds: { type: Array, default: () => [] },
});

const emit = defineEmits(["resolved", "extension-error"]);
const contributions = computed(() => {
  const includedIds = Array.isArray(props.includeContributionIds)
    ? new Set(props.includeContributionIds.map((id) => String(id || "").trim()).filter(Boolean))
    : null;
  const excludedIds = new Set(
    props.excludeContributionIds.map((id) => String(id || "").trim()).filter(Boolean),
  );
  const resolved = resolveExtensionPoint(props.point, props.context).filter((contribution = {}) => {
    const id = String(contribution.id || "").trim();
    return (!includedIds || includedIds.has(id)) && !excludedIds.has(id);
  });
  emit("resolved", resolved);
  return resolved;
});

// Resolve contribution props inside a computed projection so changes to the
// host context are propagated to an already mounted extension component.
// A template method only ran as a side effect of unrelated outlet renders and
// could therefore leave child props stale after Store-only updates.
const resolvedContributions = computed(() => contributions.value.map((contribution) => {
  const componentProps = { ...props.extraProps, ...resolveExtensionProps(contribution, props.context) };
  if (contribution?.id === "workflow-card") {
    props.context?.logWorkflowDiagnostics?.("frontend.workflowRender.extensionPropsResolved", {
      sessionId: String(props.context?.messageItem?.sessionId || ""),
      dialogProcessId: String(props.context?.messageItem?.dialogProcessId || ""),
      turnScopeId: String(props.context?.messageItem?.turnScopeId || ""),
      contributionId: contribution.id,
      subSessionMessageRegistryVersion: Number(componentProps.subSessionMessageRegistryVersion || 0),
    });
  }
  return {
    contribution,
    componentProps,
    componentListeners: {
      ...resolveExtensionListeners(contribution, props.context),
      ...props.extraListeners,
    },
  };
}));

onErrorCaptured((error, instance, info) => {
  emit("extension-error", { point: props.point, error, instance, info });
  console.warn(`[extension-outlet] render failed at "${props.point}": ${error?.message || error}`);
  return false;
});
</script>

<template>
  <component
    :is="entry.contribution.component"
    v-for="entry in resolvedContributions"
    :key="entry.contribution.id"
    v-bind="entry.componentProps"
    v-on="entry.componentListeners"
  />
</template>
