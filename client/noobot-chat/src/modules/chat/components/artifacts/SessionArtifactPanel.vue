<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Box } from "@element-plus/icons-vue";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";

const props = defineProps({
  activeSession: { type: Object, default: () => ({}) },
  connected: { type: Boolean, default: false },
});
const { translate } = useLocale();
const expanded = ref(true);
const panelRef = ref(null);
const committedSize = ref({ width: 0, height: 0 });
const isResizing = ref(false);
const resizeRevision = ref(0);
let resizeSession = null;
const context = computed(() => ({
  connected: props.connected === true,
  sessionId: String(props.activeSession?.sessionId || "").trim(),
  session: props.activeSession || {},
  sessionDocs: Array.isArray(props.activeSession?.sessionDocs)
    ? props.activeSession.sessionDocs
    : [],
  panelResizing: isResizing.value,
  panelResizeRevision: resizeRevision.value,
}));
const contributions = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.SESSION_ARTIFACT_PANEL, context.value),
);
const visible = computed(() => contributions.value.length > 0);

const panelStyle = computed(() => {
  if (!expanded.value) return {};
  const style = {};
  if (committedSize.value.width > 0) style.width = `${committedSize.value.width}px`;
  if (committedSize.value.height > 0) {
    style.height = `${committedSize.value.height}px`;
    style.maxHeight = "none";
  }
  return style;
});

function getResizeBounds() {
  const viewportWidth = globalThis?.innerWidth || 1280;
  const viewportHeight = globalThis?.innerHeight || 720;
  const isMobile = viewportWidth <= 960;
  const horizontalInset = isMobile ? 16 : 48;
  const topInset = isMobile ? 160 : 48;
  return {
    minWidth: isMobile ? 280 : 360,
    maxWidth: Math.max(isMobile ? 280 : 360, viewportWidth - horizontalInset),
    minHeight: 240,
    maxHeight: Math.max(240, viewportHeight - topInset - 24),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyPreviewSize(width, height) {
  const panel = panelRef.value;
  if (!panel) return;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  panel.style.maxHeight = "none";
}

function freezeInnerRenderers() {
  for (const element of panelRef.value?.querySelectorAll(".imported-character-viewer__canvas") ||
    []) {
    const rect = element.getBoundingClientRect();
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }
}

function releaseInnerRenderers() {
  for (const element of panelRef.value?.querySelectorAll(".imported-character-viewer__canvas") ||
    []) {
    element.style.removeProperty("width");
    element.style.removeProperty("height");
  }
}

function finishResize() {
  if (!resizeSession) return;
  const panel = panelRef.value;
  const { width, height } = resizeSession;
  resizeSession = null;
  isResizing.value = false;
  panel?.classList.remove("is-resizing");
  if (panel) {
    const rect = panel.getBoundingClientRect();
    committedSize.value = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  } else {
    committedSize.value = { width, height };
  }
  globalThis.removeEventListener("pointermove", handleResizeMove);
  globalThis.removeEventListener("pointerup", finishResize);
  globalThis.removeEventListener("pointercancel", finishResize);
  resizeRevision.value += 1;
  nextTick(releaseInnerRenderers);
}

function handleResizeMove(event) {
  if (!resizeSession) return;
  const bounds = getResizeBounds();
  const width =
    resizeSession.edge === "left" ||
    resizeSession.edge === "corner" ||
    resizeSession.edge === "corner-left"
      ? clamp(
          resizeSession.startWidth + resizeSession.startX - event.clientX,
          bounds.minWidth,
          bounds.maxWidth,
        )
      : resizeSession.startWidth;
  let height =
    resizeSession.edge === "bottom" || resizeSession.edge === "corner"
      ? clamp(
          resizeSession.startHeight + event.clientY - resizeSession.startY,
          bounds.minHeight,
          bounds.maxHeight,
        )
      : resizeSession.startHeight;
  if (resizeSession.edge === "corner-left") {
    const ratio = resizeSession.startWidth / Math.max(1, resizeSession.startHeight);
    height = clamp(width / ratio, bounds.minHeight, bounds.maxHeight);
  }
  resizeSession = { ...resizeSession, width, height };
  applyPreviewSize(width, height);
}

function startResize(edge, event) {
  if (event.button !== undefined && event.button !== 0) return;
  const panel = panelRef.value;
  if (!panel) return;
  event.preventDefault();
  const rect = panel.getBoundingClientRect();
  resizeSession = {
    edge,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    width: rect.width,
    height: rect.height,
  };
  isResizing.value = true;
  freezeInnerRenderers();
  panel.classList.add("is-resizing");
  panel.setPointerCapture?.(event.pointerId);
  globalThis.addEventListener("pointermove", handleResizeMove);
  globalThis.addEventListener("pointerup", finishResize, { once: true });
  globalThis.addEventListener("pointercancel", finishResize, { once: true });
}

function resetPanelSize() {
  if (resizeSession) finishResize();
  const panel = panelRef.value;
  panel?.style.removeProperty("width");
  panel?.style.removeProperty("height");
  panel?.style.removeProperty("max-height");
  committedSize.value = { width: 0, height: 0 };
  resizeRevision.value += 1;
  nextTick(releaseInnerRenderers);
}

watch(
  () => [context.value.sessionId, visible.value],
  ([sessionId, hasArtifacts], [previousSessionId, previousHasArtifacts] = []) => {
    if (sessionId !== previousSessionId || (hasArtifacts && !previousHasArtifacts)) {
      expanded.value = hasArtifacts;
    }
  },
);

onBeforeUnmount(() => {
  finishResize();
});
</script>

<template>
  <aside
    v-if="visible"
    ref="panelRef"
    class="session-artifact-panel noobot-panel-card"
    :class="{ 'is-collapsed': !expanded }"
    :style="panelStyle"
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
        class="session-artifact-panel__reset"
        data-testid="session-artifact-panel-reset"
        :aria-label="translate('common.resetPanelSize')"
        @click="resetPanelSize"
      >
        {{ translate("common.resetPanelSize") }}
      </button>
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
    <span
      v-if="expanded"
      class="session-artifact-panel__resize-handle session-artifact-panel__resize-handle--left"
      role="separator"
      aria-orientation="vertical"
      :aria-label="translate('common.resizePanelWidth')"
      data-testid="session-artifact-panel-resize-left"
      @pointerdown="startResize('left', $event)"
    />
    <span
      v-if="expanded"
      class="session-artifact-panel__resize-handle session-artifact-panel__resize-handle--bottom"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="translate('common.resizePanelHeight')"
      data-testid="session-artifact-panel-resize-bottom"
      @pointerdown="startResize('bottom', $event)"
    />
    <span
      v-if="expanded"
      class="session-artifact-panel__resize-handle session-artifact-panel__resize-handle--corner-left"
      aria-hidden="true"
      data-testid="session-artifact-panel-resize-corner-left"
      @pointerdown="startResize('corner-left', $event)"
    />
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
  min-height: 0;
  padding: var(--noobot-space-md);
  overflow: auto;
  background: var(--noobot-panel-bg);
  display: flex;
  flex-direction: column;
}

.session-artifact-panel.is-resizing {
  user-select: none;
}

.session-artifact-panel__resize-handle {
  position: absolute;
  z-index: 2;
  display: block;
  touch-action: none;
}

.session-artifact-panel__resize-handle--left {
  top: 0;
  bottom: 0;
  left: 0;
  width: 10px;
  cursor: ew-resize;
}

.session-artifact-panel__resize-handle--bottom {
  right: 0;
  bottom: 0;
  left: 0;
  height: 10px;
  cursor: ns-resize;
}

.session-artifact-panel__resize-handle--corner-left {
  left: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nesw-resize;
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
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
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
