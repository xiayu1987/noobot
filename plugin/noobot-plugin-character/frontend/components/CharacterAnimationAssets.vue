<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { importGlbAsset } from "../runtime/importGlbAsset.js";
import {
  characterAssetCatalog,
  recordCharacterAsset,
  refreshCharacterAssetCatalog,
  removeCharacterAsset,
} from "../runtime/characterAssetCatalog.js";
import ImportedCharacterViewer from "./ImportedCharacterViewer.vue";
import robotSampleUrl from "../../assets/samples/robot-expressive/RobotExpressive.glb?url";
import soldierSampleUrl from "../../assets/samples/Soldier.glb?url";
import flamingoSampleUrl from "../../assets/samples/Flamingo.glb?url";
import horseSampleUrl from "../../assets/samples/Horse.glb?url";
import parrotSampleUrl from "../../assets/samples/Parrot.glb?url";
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
const samples = Object.freeze([
  { id: "sample.three.robot-expressive", name: "RobotExpressive.glb", url: robotSampleUrl },
  { id: "sample.three.soldier", name: "Soldier.glb", url: soldierSampleUrl },
  { id: "sample.three.flamingo", name: "Flamingo.glb", url: flamingoSampleUrl },
  { id: "sample.three.horse", name: "Horse.glb", url: horseSampleUrl },
  { id: "sample.three.parrot", name: "Parrot.glb", url: parrotSampleUrl },
]);
const importedAssets = computed(() => characterAssetCatalog.assets);
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
  const { characterAssets: _removedCatalog, ...current } = props.pluginModelConfig || {};
  props.updatePluginModelConfig?.({ ...current, ...next });
}
function toggle(asset) {
  const current = new Set(selectedIds.value);
  if (current.has(asset.assetId)) current.delete(asset.assetId);
  else current.add(asset.assetId);
  writeConfig({ selectedCharacterAssetIds: [...current] });
}
function select(asset) {
  const selected = new Set(selectedIds.value);
  selected.add(asset.assetId);
  writeConfig({ selectedCharacterAssetIds: [...selected] });
}
async function remove(asset) {
  const assetId = String(asset?.assetId || "").trim();
  if (!assetId) return;
  error.value = "";
  try {
    await removeCharacterAsset(asset);
    writeConfig({
      selectedCharacterAssetIds: [...selectedIds.value].filter((item) => item !== assetId),
    });
  } catch (cause) {
    error.value = String(cause?.message || cause || "character asset deletion failed");
  }
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
    recordCharacterAsset(metadata);
    select(metadata);
  } catch (cause) {
    error.value = String(cause?.message || cause || "GLB import failed");
  } finally {
    importing.value = false;
  }
}
async function loadOfficialSample(sample = samples[0]) {
  error.value = "";
  importing.value = true;
  try {
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error(`sample load failed: ${response.status}`);
    const metadata = await importGlbAsset({
      blob: await response.blob(),
      name: sample.name,
      assetId: sample.id,
    });
    recordCharacterAsset(metadata);
    select(metadata);
  } catch (cause) {
    error.value = String(cause?.message || cause || "sample load failed");
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  error.value = "";
  try {
    const assets = await refreshCharacterAssetCatalog();
    const available = new Set(assets.map((asset) => asset.assetId));
    const selectedCharacterAssetIds = [...selectedIds.value].filter((id) => available.has(id));
    if (
      selectedCharacterAssetIds.length !== selectedIds.value.size ||
      Object.hasOwn(props.pluginModelConfig || {}, "characterAssets")
    ) {
      writeConfig({ selectedCharacterAssetIds });
    }
  } catch (cause) {
    error.value = String(cause?.message || cause || "character asset catalog load failed");
  }
});
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
        <div class="character-animation-assets__samples">
          <button
            v-for="(sample, index) in samples"
            :key="sample.id"
            type="button"
            class="character-animation-assets__sample"
            :data-testid="index === 0 ? 'character-load-sample' : undefined"
            :disabled="importing"
            @click="loadOfficialSample(sample)"
          >
            {{ translate(importing ? "character.loadingSample" : "character.loadSample") }} ·
            {{ sample.name }}
          </button>
        </div>
        <div v-if="importedAssets.length" class="character-animation-assets__inventory">
          <div
            v-for="asset in importedAssets"
            :key="`inventory-${asset.assetId}`"
            class="character-animation-assets__inventory-item"
          >
            <span>{{ asset.name }}</span>
            <button
              type="button"
              class="character-animation-assets__remove"
              :title="translate('character.removeAsset')"
              @click="remove(asset)"
            >
              {{ translate("character.removeAsset") }}
            </button>
          </div>
        </div>
      </template>
      <p v-if="error" class="character-animation-assets__error">{{ error }}</p>
      <template v-if="mode === 'select'">
        <div
          v-for="asset in importedAssets"
          :key="asset.assetId"
          class="character-animation-assets__item"
          :data-asset-id="asset.assetId"
        >
          <input
            type="checkbox"
            data-testid="character-select-asset"
            :checked="selectedIds.has(asset.assetId)"
            @change="toggle(asset)"
          />
          <span
            >{{ asset.name }} ·
            {{ translate("character.animationCount", { count: asset.animations.length }) }}</span
          >
          <button
            type="button"
            class="character-animation-assets__remove"
            :title="translate('character.removeAsset')"
            @click="remove(asset)"
          >
            {{ translate("character.removeAsset") }}
          </button>
        </div>
      </template>
      <p v-if="!importedAssets.length" class="character-animation-assets__empty">
        {{ translate(mode === "manage" ? "character.noImportedAssets" : "character.selectHint") }}
      </p>
      <div v-if="mode === 'manage'" class="character-animation-assets__previews">
        <article v-for="asset in previewAssets" :key="asset.assetId">
          <div class="character-animation-assets__preview-header">
            <p class="character-animation-assets__preview-title">
              {{ asset.name }} ·
              {{ translate("character.animationCount", { count: asset.animations.length }) }}
            </p>
            <button
              type="button"
              class="character-animation-assets__remove"
              :title="translate('character.removeAsset')"
              @click="remove(asset)"
            >
              {{ translate("character.removeAsset") }}
            </button>
          </div>
          <ImportedCharacterViewer :assets="[asset]" :height="180" />
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
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 0;
  font-size: 12px;
}
.character-animation-assets__item > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.character-animation-assets__remove {
  flex: 0 0 auto;
  color: #fca5a5;
  font-size: 11px;
}
.character-animation-assets__inventory {
  display: grid;
  gap: 4px;
  margin: 2px 0 12px;
}
.character-animation-assets__inventory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 5px 0;
  border-top: 1px solid color-mix(in srgb, #385170 55%, transparent);
  color: #dbeafe;
  font-size: 12px;
}
.character-animation-assets__inventory-item > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding-right: 2px;
}

.is-right-panel .character-animation-assets__previews {
  max-height: none;
  overflow: visible;
}
.character-animation-assets__preview-title {
  margin: 4px 0;
  color: #93a4bb;
  font-size: 12px;
}
.character-animation-assets__preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
</style>
