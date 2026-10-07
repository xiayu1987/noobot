<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onErrorCaptured, watch } from "vue";
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
});

const emit = defineEmits(["resolved", "extension-error"]);
const contributions = computed(() => resolveExtensionPoint(props.point, props.context));
watch(contributions, (resolved) => emit("resolved", resolved), { flush: "post" });

const resolvedContributions = computed(() =>
  contributions.value.map((contribution) => {
    const componentProps = {
      ...props.extraProps,
      ...resolveExtensionProps(contribution, props.context),
    };
    return {
      contribution,
      componentProps,
      componentListeners: {
        ...resolveExtensionListeners(contribution, props.context),
        ...props.extraListeners,
      },
    };
  }),
);
const contributionDiagnosticsSignature = computed(() =>
  resolvedContributions.value
    .map((entry) =>
      [
        entry.contribution?.id || "",
        Number(entry.componentProps?.subSessionMessageRegistryVersion || 0),
      ].join(":"),
    )
    .join("|"),
);
watch(
  contributionDiagnosticsSignature,
  () => {
    for (const entry of resolvedContributions.value) {
      if (entry.contribution?.id !== "workflow-card") continue;
      props.context?.logWorkflowDiagnostics?.(
        "frontend.workflowRender.extensionPropsResolved",
        () => ({
          sessionId: String(props.context?.messageItem?.sessionId || ""),
          dialogProcessId: String(props.context?.messageItem?.dialogProcessId || ""),
          turnScopeId: String(props.context?.messageItem?.turnScopeId || ""),
          contributionId: entry.contribution.id,
          subSessionMessageRegistryVersion: Number(
            entry.componentProps.subSessionMessageRegistryVersion || 0,
          ),
        }),
      );
    }
  },
  { flush: "post" },
);

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
