<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import ImportedCharacterViewer from "./ImportedCharacterViewer.vue";
import { useCharacterLocale } from "../i18n/index.js";

const props = defineProps({
  card: { type: Object, required: true },
  suspendResize: { type: Boolean, default: false },
  resizeRevision: { type: Number, default: 0 },
});
const { translate } = useCharacterLocale();
const viewer = ref();
const exportError = ref("");
const exporting = ref(false);
const assetIds = computed(() => [
  ...new Set(
    props.card.protocol.characters.map((character) => character.assetId),
  ),
]);
const assets = computed(() =>
  assetIds.value
    .map((assetId) => props.card.assets.find((asset) => asset.assetId === assetId))
    .filter(Boolean),
);
async function runExport(kind) {
  exportError.value = "";
  exporting.value = kind === "video";
  try {
    await viewer.value?.[kind === "video" ? "exportVideo" : "exportImage"]();
  } catch (error) {
    exportError.value = translate("character.exportFailed", {
      error: String(error?.message || error),
    });
  } finally {
    exporting.value = false;
  }
}

function replay() {
  viewer.value?.restartPlayback();
}
</script>
<template>
  <article class="character-animation-card" :data-animation-id="card.animationId">
    <header>
      <div class="character-animation-card__title">
        <strong>{{ card.animationId }}</strong>
        <span>
          rev {{ card.revision }} ·
          {{ translate("character.characterCount", { count: assetIds.length }) }}
        </span>
      </div>
      <div class="character-animation-card__actions">
        <button type="button" :title="translate('character.replayAnimation')" @click="replay">
          {{ translate("character.replayAnimation") }}
        </button>
        <button
          type="button"
          :title="translate('character.exportImage')"
          @click="runExport('image')"
        >
          {{ translate("character.exportImage") }}
        </button>
        <button
          type="button"
          :title="translate('character.exportVideo')"
          :disabled="exporting"
          @click="runExport('video')"
        >
          {{
            exporting ? translate("character.exportingVideo") : translate("character.exportVideo")
          }}
        </button>
      </div>
    </header>
    <p v-if="exportError" class="character-animation-card__error">{{ exportError }}</p>
    <ImportedCharacterViewer
      v-if="assets.length === assetIds.length"
      ref="viewer"
      :assets="assets"
      :protocol="card.protocol"
      :revision="card.revision"
      fill-container
      :suspend-resize="props.suspendResize"
      :resize-revision="props.resizeRevision"
    />
    <p v-else class="character-animation-card__missing">
      {{ translate("character.missingArtifactAssets") }}
    </p>
  </article>
</template>
<style scoped>
.character-animation-card {
  padding: 8px;
  border: 1px solid #24344d;
  border-radius: 8px;
  background: #0a1120;
  min-height: 300px;
  display: flex;
  flex-direction: column;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  color: #dbeafe;
  font-size: 12px;
}
.character-animation-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.character-animation-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
button {
  border: 1px solid #385170;
  border-radius: 4px;
  background: #15243a;
  color: #dbeafe;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 4px 7px;
}
button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.character-animation-card__error {
  margin: 4px 0;
  color: #fca5a5;
  font-size: 11px;
}
header strong {
  overflow: hidden;
  text-overflow: ellipsis;
}
header span,
.character-animation-card__missing {
  color: #93a4bb;
  white-space: nowrap;
}
</style>
