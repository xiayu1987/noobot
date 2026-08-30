<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { Box } from "@element-plus/icons-vue";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";

const props = defineProps({
  activeSession: { type: Object, default: () => ({}) },
});
const { translate } = useLocale();
const expanded = ref(true);
const context = computed(() => ({
  sessionId: String(props.activeSession?.sessionId || "").trim(),
  session: props.activeSession || {},
  sessionDocs: Array.isArray(props.activeSession?.sessionDocs)
    ? props.activeSession.sessionDocs
    : [],
}));
const contributions = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.SESSION_ARTIFACT_PANEL, context.value),
);
const visible = computed(() => contributions.value.length > 0);

watch(
  () => [context.value.sessionId, visible.value],
  ([sessionId, hasArtifacts], [previousSessionId, previousHasArtifacts] = []) => {
    if (sessionId !== previousSessionId || (hasArtifacts && !previousHasArtifacts)) {
      expanded.value = hasArtifacts;
    }
  },
);
</script>

<template>
  <aside
    v-if="visible"
    class="session-artifact-panel noobot-panel-card"
    :class="{ 'is-collapsed': !expanded }"
    data-testid="session-artifact-panel"
  >
    <header class="session-artifact-panel__header">
      <button
        type="button"
        class="session-artifact-panel__toggle"
        data-testid="session-artifact-panel-toggle"
        :aria-expanded="expanded"
        :aria-label="translate('common.sessionArtifacts')"
        @click="expanded = !expanded"
      >
        <el-icon><Box /></el-icon>
      </button>
      <strong v-if="expanded">{{ translate("common.sessionArtifacts") }}</strong>
      <button
        v-if="expanded"
        type="button"
        class="session-artifact-panel__collapse"
        @click="expanded = false"
      >
        {{ translate("common.collapse") }}
      </button>
    </header>
    <div v-if="expanded" class="session-artifact-panel__content">
      <ExtensionOutlet
        :point="EXTENSION_POINTS.SESSION_ARTIFACT_PANEL"
        :context="context"
        :extra-props="context"
      />
    </div>
  </aside>
</template>

<style scoped>
.session-artifact-panel {
  position: absolute;
  top: var(--noobot-space-xl);
  right: var(--noobot-space-xl);
  z-index: 7;
  box-sizing: border-box;
  width: min(600px, 58vw);
  max-height: calc(100% - 2 * var(--noobot-space-xl));
  padding: var(--noobot-space-md);
  overflow: auto;
  background: var(--noobot-panel-bg);
}

.session-artifact-panel.is-collapsed {
  width: var(--noobot-side-panel-collapsed-width);
  height: var(--noobot-side-panel-collapsed-width);
  padding: 0;
  overflow: hidden;
}

.session-artifact-panel__header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
}

.session-artifact-panel__header strong {
  flex: 1;
  font-size: var(--noobot-font-size-md);
}

.session-artifact-panel__toggle,
.session-artifact-panel__collapse {
  display: inline-grid;
  min-width: var(--noobot-control-icon-size-sm);
  height: var(--noobot-control-icon-size-sm);
  padding: 0;
  place-items: center;
  border: 0;
  color: var(--noobot-text-accent);
  background: transparent;
  cursor: pointer;
}

.session-artifact-panel.is-collapsed .session-artifact-panel__header,
.session-artifact-panel.is-collapsed .session-artifact-panel__toggle {
  width: 100%;
  height: 100%;
}

.session-artifact-panel__content {
  margin-top: var(--noobot-space-sm);
}

@media (max-width: 960px) {
  .session-artifact-panel {
    --noobot-mobile-artifact-top: calc(
      var(--noobot-space-xl) + var(--noobot-control-height-xl) + var(--noobot-space-xs) +
        var(--noobot-control-height-xl) + var(--noobot-space-xs) + var(--noobot-control-height-xl) +
        var(--noobot-space-md)
    );

    top: var(--noobot-mobile-artifact-top);
    width: min(480px, calc(100% - 2 * var(--noobot-space-sm)));
    max-height: calc(100% - var(--noobot-mobile-artifact-top) - var(--noobot-space-xl));
  }

  .session-artifact-panel.is-collapsed {
    width: var(--noobot-side-panel-collapsed-width);
    min-width: var(--noobot-side-panel-collapsed-width);
    max-width: var(--noobot-side-panel-collapsed-width);
    height: var(--noobot-side-panel-collapsed-width);
    min-height: var(--noobot-side-panel-collapsed-width);
    max-height: var(--noobot-side-panel-collapsed-width);
    padding: 0;
  }
}
</style>
