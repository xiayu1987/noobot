<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadImportedAsset } from "../runtime/importedAssetStore.js";
import { useCharacterLocale } from "../i18n/index.js";

const props = defineProps({
  assets: { type: Array, default: () => [] },
  protocol: { type: Object, default: null },
  revision: { type: Number, default: 0 },
  // Session artifact cards provide a bounded flex container while the asset
  // management preview is an intrinsic-height panel. Keeping this explicit
  // prevents percentage-height feedback from growing the management panel.
  fillContainer: { type: Boolean, default: false },
  // Standalone asset previews use a bounded viewport so a catalog with many
  // characters remains scannable inside the right panel.
  height: { type: Number, default: 300 },
  suspendResize: { type: Boolean, default: false },
  resizeRevision: { type: Number, default: 0 },
});
const host = ref();
const loadError = ref("");
const isRecording = ref(false);
const { translate } = useCharacterLocale();
const viewer = ref();
let renderer;
let scene;
let camera;
let controls;
let resizeObserver;
let frame;
let mountRevision = 0;
let players = new Map();
let queuedProtocolCount = 0;
let nextPlaybackAt = 0;
let activeProtocol = null;

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportImage() {
  if (!renderer?.domElement) throw new Error(translate("character.loadError"));
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (blob) downloadBlob(blob, "noobot-character-animation.png");
  }, "image/png");
}

function resolveRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported?.(type),
    ) || ""
  );
}

async function exportVideo() {
  if (!renderer?.domElement?.captureStream)
    throw new Error(translate("character.exportUnavailable"));
  const mimeType = resolveRecordingMimeType();
  if (!mimeType) throw new Error(translate("character.exportUnavailable"));
  if (isRecording.value) return;
  restartPlayback();
  const stream = renderer.domElement.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  const durationMs = Math.max(1000, Math.min(60000, (props.protocol?.duration || 0) * 1000 + 500));
  isRecording.value = true;
  const result = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => event.data?.size && chunks.push(event.data);
    recorder.onerror = () => reject(recorder.error || new Error("MediaRecorder error"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.start();
  setTimeout(() => recorder.state !== "inactive" && recorder.stop(), durationMs);
  try {
    const blob = await result;
    downloadBlob(blob, "noobot-character-animation.webm");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    isRecording.value = false;
  }
}

function disposeModel(root) {
  root?.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) value?.isTexture && value.dispose();
      material.dispose?.();
    }
  });
}

function dispose() {
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  controls?.dispose();
  for (const player of players.values()) {
    player.mixer.stopAllAction();
    disposeModel(player.model);
    URL.revokeObjectURL(player.objectUrl);
  }
  renderer?.dispose();
  viewer.value?.replaceChildren();
  controls = undefined;
  renderer = undefined;
  scene = undefined;
  camera = undefined;
  players = new Map();
  activeProtocol = null;
  queuedProtocolCount = 0;
  nextPlaybackAt = 0;
}

function resizeRenderer() {
  if (!renderer || !camera || !viewer.value) return;
  const width = Math.max(1, viewer.value.clientWidth || 320);
  const height = Math.max(1, viewer.value.clientHeight || 300);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function createKeyframeClip(segment, animationId, characterIndex, segmentIndex) {
  const tracks = segment.tracks.map((track) => {
    const times = track.keyframes.map((item) => item.time);
    const values = track.keyframes.flatMap((item) => item[track.property]);
    const Type =
      track.property === "rotation" ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    const binding = track.property === "rotation" ? "quaternion" : track.property;
    return new Type(`${track.node}.${binding}`, times, values);
  });
  return new THREE.AnimationClip(
    `${animationId}.${characterIndex}.${segmentIndex}`,
    segment.duration,
    tracks,
  );
}

function playCharacter(player, protocol, character, characterIndex) {
  player.segmentActions = character.segments.map((segment, segmentIndex) => {
    const clip =
      segment.type === "native_clip"
        ? THREE.AnimationClip.findByName(player.animations, segment.clip)?.clone()
        : createKeyframeClip(segment, protocol.animationId, characterIndex, segmentIndex);
    if (!clip) return null;
    const action = player.mixer.clipAction(clip);
    action.clampWhenFinished = !protocol.loop && segmentIndex === character.segments.length - 1;
    action
      .setLoop(protocol.loop ? THREE.LoopRepeat : THREE.LoopOnce, protocol.loop ? Infinity : 1)
      .reset()
      .setDuration(segment.duration);
    action.enabled = false;
    action.weight = 0;
    // The protocol timeline, not the source clip duration, owns playback.
    // Keep the action paused so a short GLB clip cannot finish early and
    // disable itself before the declared segment ends.
    action.paused = true;
    return action;
  });
  player.activeSegmentIndex = -1;
}

function updateCharacterActions(protocol, time) {
  for (const player of players.values()) {
    const character = protocol?.characters?.find((item) => item.assetId === player.assetId);
    if (!character || !player.segmentActions?.length) continue;
    let segmentIndex = character.segments.findIndex(
      (segment) => time >= segment.start && time < segment.start + segment.duration,
    );
    if (segmentIndex < 0 && time >= protocol.duration) segmentIndex = character.segments.length - 1;
    if (segmentIndex < 0) continue;
    const segment = character.segments[segmentIndex];
    const action = player.segmentActions[segmentIndex];
    if (!action) continue;
    if (segmentIndex !== player.activeSegmentIndex) {
      player.segmentActions.forEach((item, index) => {
        if (item && index !== segmentIndex) {
          item.enabled = false;
          item.weight = 0;
          item.paused = true;
        }
      });
      action.enabled = true;
      action.weight = 1;
      action.paused = true;
      action.reset().play();
      player.activeSegmentIndex = segmentIndex;
    }
    action.enabled = true;
    action.weight = 1;
    action.paused = true;
    const localTime = Math.min(segment.duration, Math.max(0, time - segment.start));
    const clipDuration = Math.max(0, action.getClip().duration);
    action.time =
      segment.duration > 0
        ? Math.min(clipDuration, (localTime / segment.duration) * clipDuration)
        : 0;
    if (
      !protocol.loop &&
      time >= protocol.duration &&
      segmentIndex === character.segments.length - 1
    ) {
      action.enabled = true;
      action.paused = true;
      action.time = clipDuration;
    }

    // AnimationMixer applies action state during update(). At a segment
    // boundary the previous action may already have completed and disabled
    // itself, so waiting for the next frame briefly exposes the model's bind
    // pose. Re-evaluate at the current action time immediately after the
    // timeline selects the active segment; this keeps every rendered frame
    // covered by exactly one action.
    player.mixer.update(0);
  }
}

function applyRootTransforms(protocol) {
  for (const player of players.values()) {
    const character = protocol?.characters?.find((item) => item.assetId === player.assetId);
    const root = character?.rootTransform;
    if (!root) continue;
    player.anchor.position.fromArray(root.position);
    player.anchor.quaternion.fromArray(root.rotation);
    player.anchor.scale.fromArray(root.scale);
  }
}

function updateRootMotion(protocol, time) {
  for (const player of players.values()) {
    const character = protocol?.characters?.find((item) => item.assetId === player.assetId);
    const segment = character?.segments?.find(
      (item) => item.rootMotion && time >= item.start && time <= item.start + item.duration,
    );
    if (!segment) {
      const root = character?.rootTransform;
      if (root) {
        player.anchor.position.fromArray(root.position);
        player.anchor.quaternion.fromArray(root.rotation);
        player.anchor.scale.fromArray(root.scale);
      }
      continue;
    }
    const frames = segment.rootMotion.keyframes;
    const localTime = Math.min(segment.duration, Math.max(0, time - segment.start));
    let left = frames[0];
    let right = frames[frames.length - 1];
    for (let index = 1; index < frames.length; index += 1) {
      if (localTime <= frames[index].time) {
        right = frames[index];
        left = frames[index - 1];
        break;
      }
    }
    const span = Math.max(0.000001, right.time - left.time);
    const amount = Math.min(1, Math.max(0, (localTime - left.time) / span));
    player.anchor.position
      .fromArray(left.position)
      .lerp(new THREE.Vector3().fromArray(right.position), amount);
    player.anchor.quaternion
      .fromArray(left.rotation)
      .slerp(new THREE.Quaternion().fromArray(right.rotation), amount);
    player.anchor.scale
      .fromArray(left.scale)
      .lerp(new THREE.Vector3().fromArray(right.scale), amount);
  }
}

function updateCamera(protocol, time) {
  const frames = protocol?.scene?.cameraTrack?.keyframes || [];
  if (!camera || frames.length < 2) return;
  let left = frames[0];
  let right = frames[frames.length - 1];
  for (let index = 1; index < frames.length; index += 1) {
    if (time <= frames[index].time) {
      right = frames[index];
      left = frames[index - 1];
      break;
    }
  }
  const span = Math.max(0.000001, right.time - left.time);
  const amount = Math.min(1, Math.max(0, (time - left.time) / span));
  camera.position
    .fromArray(left.position)
    .lerp(new THREE.Vector3().fromArray(right.position), amount);
  controls?.target.fromArray(left.target).lerp(new THREE.Vector3().fromArray(right.target), amount);
  camera.fov = left.fov + (right.fov - left.fov) * amount;
  camera.updateProjectionMatrix();
}

function queueProtocol() {
  if (!players.size || !props.protocol || queuedProtocolCount) return;
  {
    const protocol = props.protocol;
    activeProtocol = protocol;
    const startsAt = Math.max(
      nextPlaybackAt,
      ...[...players.values()].map((item) => item.mixer.time),
    );
    protocol.characters.forEach((character, characterIndex) => {
      const player = players.get(character.assetId);
      if (player) playCharacter(player, protocol, character, characterIndex);
    });
    nextPlaybackAt = startsAt + protocol.duration;
  }
  queuedProtocolCount = 1;
}

function restartPlayback() {
  for (const player of players.values()) {
    player.mixer.stopAllAction();
    player.mixer.setTime(0);
  }
  queuedProtocolCount = 0;
  nextPlaybackAt = 0;
  queueProtocol();
}

async function loadPlayer(asset, revision) {
  const blob = await loadImportedAsset(asset);
  if (revision !== mountRevision) return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const gltf = await new GLTFLoader().loadAsync(objectUrl);
    if (revision !== mountRevision) {
      disposeModel(gltf.scene);
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const player = {
      asset,
      assetId: asset.assetId,
      anchor: new THREE.Group(),
      model: gltf.scene,
      mixer,
      animations: gltf.animations || [],
      objectUrl,
      segmentActions: [],
      activeSegmentIndex: -1,
    };
    return player;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function mount() {
  const revision = ++mountRevision;
  dispose();
  loadError.value = "";
  if (!viewer.value || !props.assets.length) return;
  let loaded;
  try {
    loaded = (await Promise.all(props.assets.map((asset) => loadPlayer(asset, revision)))).filter(
      Boolean,
    );
  } catch (error) {
    if (revision === mountRevision) {
      loadError.value = String(error?.message || error || translate("character.loadError"));
    }
    return;
  }
  if (revision !== mountRevision || loaded.length !== props.assets.length) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a1120");
  players = new Map(loaded.map((player) => [player.assetId, player]));
  for (const [index, player] of loaded.entries()) {
    player.anchor.add(player.model);
    const normalization = player.asset.normalization;
    player.model.scale.setScalar(normalization.scale);
    player.model.position.y = normalization.floorOffset + (props.protocol?.scene?.groundY || 0);
    if (props.protocol) applyRootTransforms(props.protocol);
    if (!props.protocol) player.anchor.position.x = index - (loaded.length - 1) / 2;
    scene.add(player.anchor);
  }
  scene.add(new THREE.HemisphereLight("#fff", "#445", 2));
  const box = new THREE.Box3();
  loaded.forEach((player) => box.expandByObject(player.anchor));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  camera.position.set(center.x, center.y, center.z + Math.max(size.x, size.y, size.z, 1) * 2.2);
  camera.lookAt(center);
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: false,
    });
  } catch (error) {
    loaded.forEach((player) => {
      disposeModel(player.model);
      URL.revokeObjectURL(player.objectUrl);
    });
    loadError.value = translate("character.webglError", {
      error: String(error?.message || error),
    });
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "imported-character-viewer__webgl";
  renderer.domElement.setAttribute("aria-label", translate("character.canvasLabel"));
  viewer.value.append(renderer.domElement);
  resizeRenderer();
  resizeObserver = new ResizeObserver(() => {
    if (!props.suspendResize) resizeRenderer();
  });
  resizeObserver.observe(viewer.value);
  requestAnimationFrame(resizeRenderer);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  const clock = new THREE.Clock();
  const animate = () => {
    frame = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    for (const player of players.values()) player.mixer.update(delta);
    if (activeProtocol) {
      const time = Math.max(...[...players.values()].map((item) => item.mixer.time), 0);
      updateCharacterActions(activeProtocol, time);
      updateRootMotion(activeProtocol, time);
      const cameraTime = activeProtocol.loop
        ? time % Math.max(activeProtocol.duration, 0.000001)
        : Math.min(time, activeProtocol.duration);
      updateCamera(activeProtocol, cameraTime);
    }
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
  if (!props.protocol) {
    loaded.forEach((player) => {
      const idle = player.animations[0];
      if (idle) player.mixer.clipAction(idle).play();
    });
  }
  queueProtocol();
}

watch(() => props.assets.map((asset) => asset.assetId).join("|"), mount);
watch(
  () => props.suspendResize,
  (suspended) => {
    if (suspended && viewer.value) {
      const rect = viewer.value.getBoundingClientRect();
      viewer.value.style.width = `${rect.width}px`;
      viewer.value.style.height = `${rect.height}px`;
    } else if (!suspended && viewer.value) {
      viewer.value.style.removeProperty("width");
      viewer.value.style.removeProperty("height");
      requestAnimationFrame(resizeRenderer);
    }
  },
);
watch(
  () => props.resizeRevision,
  () => {
    if (!props.suspendResize) requestAnimationFrame(resizeRenderer);
  },
);
onMounted(() => mount());
watch(
  () => props.revision,
  () => {
    applyRootTransforms(props.protocol);
    restartPlayback();
  },
);
onBeforeUnmount(() => {
  mountRevision += 1;
  dispose();
});

defineExpose({ exportImage, exportVideo, restartPlayback, isRecording });
</script>
<template>
  <div
    ref="host"
    class="imported-character-viewer"
    :class="{ 'is-fill-container': props.fillContainer }"
    :style="!props.fillContainer ? { height: `${Math.max(1, props.height)}px` } : undefined"
  >
    <div ref="viewer" class="imported-character-viewer__canvas" />
    <p v-if="loadError" class="imported-character-viewer__error">{{ loadError }}</p>
  </div>
</template>
<style scoped>
.imported-character-viewer {
  width: 100%;
  min-height: 300px;
  overflow: hidden;
  position: relative;
}
.imported-character-viewer:not(.is-fill-container) {
  min-height: 0;
}
.imported-character-viewer.is-fill-container {
  height: 100%;
  min-height: 460px;
  flex: 1 1 auto;
}
.imported-character-viewer__canvas {
  width: 100%;
  height: 100%;
}
.imported-character-viewer.is-fill-container .imported-character-viewer__canvas {
  height: 100%;
}
:deep(.imported-character-viewer__webgl) {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.imported-character-viewer__error {
  position: absolute;
  inset: 50% 12px auto;
  margin: 0;
  color: #fca5a5;
  text-align: center;
  transform: translateY(-50%);
}
</style>
