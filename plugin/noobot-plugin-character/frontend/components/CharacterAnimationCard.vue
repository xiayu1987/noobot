<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import ImportedCharacterViewer from "./ImportedCharacterViewer.vue";
import { useCharacterLocale } from "../i18n/index.js";

const props = defineProps({ card: { type: Object, required: true } });
const { translate } = useCharacterLocale();
const assetIds = computed(() => [
  ...new Set(
    props.card.protocols.flatMap((protocol) =>
      protocol.characters.map((character) => character.assetId),
    ),
  ),
]);
const assets = computed(() =>
  assetIds.value
    .map((assetId) => props.card.assets.find((asset) => asset.assetId === assetId))
    .filter(Boolean),
);
</script>
<template>
  <article class="character-animation-card" :data-animation-id="card.animationId">
    <header>
      <strong>{{ card.animationId }}</strong>
      <span>
        {{ card.protocols.length }} ·
        {{ translate("character.characterCount", { count: assetIds.length }) }}
      </span>
    </header>
    <ImportedCharacterViewer
      v-if="assets.length === assetIds.length"
      :assets="assets"
      :protocols="card.protocols"
      :revision="card.revision"
      :height="460"
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
}
header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  color: #dbeafe;
  font-size: 12px;
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
