<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { importGlbAsset } from "../runtime/importGlbAsset.js";
import ImportedCharacterViewer from "./ImportedCharacterViewer.vue";
import sampleUrl from "../../assets/samples/robot-expressive/RobotExpressive.glb?url";
import { useCharacterLocale } from "../i18n/index.js";

const props = defineProps({
  pluginModelConfig: { type: Object, default: () => ({}) },
  updatePluginModelConfig: { type: Function, default: null },
  mode: {
    type: String,
    default: "select",
    validator: (value) => ["manage", "select"].includes(value),
  },
});
const error = ref("");
const { translate } = useCharacterLocale();
const importing = ref(false);
const collapsed = ref(false);
const importedAssets = computed(() =>
  Array.isArray(props.pluginModelConfig?.characterAssets)
    ? props.pluginModelConfig.characterAssets
    : [],
);
const selectedIds = computed(
  () =>
    new Set(
      Array.isArray(props.pluginModelConfig?.selectedCharacterAssetIds)
        ? props.pluginModelConfig.selectedCharacterAssetIds.map((item) => String(item || "").trim())
        : [],
    ),
);
const previewAssets = computed(() => {
  const selected = importedAssets.value.filter((item) => selectedIds.value.has(item.assetId));
  const fallback = importedAssets.value[importedAssets.value.length - 1];
  return selected.length ? selected : fallback ? [fallback] : [];
});
function writeConfig(next) {
  props.updatePluginModelConfig?.({ ...(props.pluginModelConfig || {}), ...next });
}
function toggle(asset) {
  const current = new Set(selectedIds.value);
  if (current.has(asset.assetId)) current.delete(asset.assetId);
  else current.add(asset.assetId);
  writeConfig({ selectedCharacterAssetIds: [...current] });
}
function select(asset) {
  const catalog = new Map(importedAssets.value.map((item) => [item.assetId, item]));
  catalog.set(asset.assetId, asset);
  const selected = new Set(selectedIds.value);
  selected.add(asset.assetId);
  writeConfig({
    characterAssets: [...catalog.values()],
    selectedCharacterAssetIds: [...selected],
  });
}
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  error.value = "";
  importing.value = true;
  try {
    const metadata = await importGlbAsset({
      blob: file,
      name: file.name,
      assetId: `user.glb.${globalThis.crypto.randomUUID()}`,
    });
    select(metadata);
  } catch (cause) {
    error.value = String(cause?.message || cause || "GLB import failed");
  } finally {
    importing.value = false;
  }
}
async function loadOfficialSample() {
  error.value = "";
  importing.value = true;
  try {
    const response = await fetch(sampleUrl);
    if (!response.ok) throw new Error(`sample load failed: ${response.status}`);
    const metadata = await importGlbAsset({
      blob: await response.blob(),
      name: "RobotExpressive.glb",
      assetId: "sample.three.robot-expressive",
    });
    select(metadata);
  } catch (cause) {
    error.value = String(cause?.message || cause || "sample load failed");
  } finally {
    importing.value = false;
  }
}
</script>
<template>
  <section class="character-animation-assets" :class="{ 'is-right-panel': mode === 'manage' }">
    <header v-if="mode === 'select'" class="character-animation-assets__header">
      <strong>{{ translate(mode === "manage" ? "character.feature" : "character.select") }}</strong
      ><button type="button" @click="collapsed = !collapsed">
        {{ translate(collapsed ? "character.expand" : "character.collapse") }}
      </button>
    </header>
    <template v-if="mode === 'manage' || !collapsed">
      <template v-if="mode === 'manage'">
        <label class="character-animation-assets__import"
          >{{ translate("character.importGlb")
          }}<input
            type="file"
            accept=".glb,model/gltf-binary"
            :disabled="importing"
            @change="importFile"
        /></label>
        <button
          type="button"
          class="character-animation-assets__sample"
          data-testid="character-load-sample"
          :disabled="importing"
          @click="loadOfficialSample"
        >
          {{ translate(importing ? "character.loadingSample" : "character.loadSample") }}
        </button>
      </template>
      <p v-if="error" class="character-animation-assets__error">{{ error }}</p>
      <label
        v-if="mode === 'select'"
        v-for="asset in importedAssets"
        :key="asset.assetId"
        class="character-animation-assets__item"
        :data-asset-id="asset.assetId"
        ><input
          type="checkbox"
          data-testid="character-select-asset"
          :checked="selectedIds.has(asset.assetId)"
          @change="toggle(asset)"
        /><span
          >{{ asset.name }} ·
          {{ translate("character.animationCount", { count: asset.animations.length }) }}</span
        ></label
      >
      <p v-if="!importedAssets.length" class="character-animation-assets__empty">
        {{ translate(mode === "manage" ? "character.noImportedAssets" : "character.selectHint") }}
      </p>
      <div v-if="mode === 'manage'" class="character-animation-assets__previews">
        <article v-for="asset in previewAssets" :key="asset.assetId">
          <p class="character-animation-assets__preview-title">
            {{ asset.name }} ·
            {{ translate("character.animationCount", { count: asset.animations.length }) }}
          </p>
          <ImportedCharacterViewer :assets="[asset]" />
        </article>
      </div>
    </template>
  </section>
</template>
<style scoped>
.character-animation-assets {
  padding: 12px;
  color: #dbeafe;
}
.is-right-panel {
  min-width: 0;
  width: 100%;
}
.character-animation-assets__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
button {
  border: 0;
  background: transparent;
  color: #67e8f9;
  cursor: pointer;
}
.character-animation-assets__sample {
  margin-bottom: 10px;
  padding: 0;
  font-size: 12px;
}
button:disabled {
  cursor: wait;
  opacity: 0.55;
}
.character-animation-assets__import {
  display: block;
  margin-bottom: 10px;
  color: #93a4bb;
  font-size: 12px;
  cursor: pointer;
}
input[type="file"] {
  display: block;
  width: 100%;
  margin-top: 6px;
}
.character-animation-assets__item {
  display: flex;
  gap: 7px;
  padding: 6px 0;
  font-size: 12px;
}
.character-animation-assets__error {
  color: #fca5a5;
  font-size: 12px;
}
.character-animation-assets__empty {
  color: #71839d;
  font-size: 12px;
}
.character-animation-assets__previews {
  display: grid;
  gap: 10px;
}
.character-animation-assets__preview-title {
  margin: 4px 0;
  color: #93a4bb;
  font-size: 12px;
}
</style>
