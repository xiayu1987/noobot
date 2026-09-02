<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import ImportedCharacterViewer from "./ImportedCharacterViewer.vue";
import { useCharacterLocale } from "../i18n/index.js";
import { analyzeAnimationSpatial } from "../../src/spatial-analysis.js";

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
  ...new Set(props.card.protocol.characters.map((character) => character.assetId)),
]);
const assets = computed(() =>
  assetIds.value
    .map((assetId) => props.card.assets.find((asset) => asset.assetId === assetId))
    .filter(Boolean),
);
const diagnostics = computed(() => {
  return analyzeAnimationSpatial(props.card.protocol);
});
const characterDiagnostics = computed(() =>
  props.card.protocol.characters.map((character) => ({
    characterId: character.characterId,
    ...(diagnostics.value.characters[character.characterId] || {}),
  })),
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
    <div class="character-animation-card__diagnostics">
      <div
        v-for="item in characterDiagnostics"
        :key="item.characterId"
        class="character-animation-card__diagnostic-row"
      >
        <strong>{{ item.characterId }}</strong>
        <dl>
          <div>
            <dt>{{ translate("character.pathDistance") }}</dt>
            <dd>{{ item.distance?.toFixed(2) ?? "-" }} {{ diagnostics.units }}</dd>
          </div>
          <div>
            <dt>{{ translate("character.netDisplacement") }}</dt>
            <dd>{{ item.displacement?.toFixed(2) ?? "-" }} {{ diagnostics.units }}</dd>
          </div>
          <div>
            <dt>{{ translate("character.minClearance") }}</dt>
            <dd :class="{ 'is-warning': item.minClearance < 0 }">
              {{ item.minClearance?.toFixed(2) ?? "-" }} {{ diagnostics.units }}
            </dd>
          </div>
          <div>
            <dt>{{ translate("character.penetrations") }}</dt>
            <dd :class="{ 'is-warning': diagnostics.penetrationIntervals.length }">
              {{ diagnostics.penetrationIntervals.length }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
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
.character-animation-card__diagnostics {
  display: grid;
  gap: 6px;
  margin: 0 0 6px;
  color: #93a4bb;
  font-size: 10px;
}
.character-animation-card__diagnostic-row {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #1f3047;
  background: #0d1829;
}
.character-animation-card__diagnostic-row > strong {
  display: block;
  margin-bottom: 4px;
  color: #dbeafe;
}
.character-animation-card__diagnostic-row dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
}
.character-animation-card__diagnostics dt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.character-animation-card__diagnostics dd {
  margin: 2px 0 0;
  color: #dbeafe;
  font-variant-numeric: tabular-nums;
}
.character-animation-card__diagnostics dd.is-warning {
  color: #fca5a5;
}
@media (max-width: 560px) {
  .character-animation-card__diagnostic-row dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
