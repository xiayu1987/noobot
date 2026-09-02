/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import * as THREE from "three";

const ROOT_TRANSLATION_NODE_NAMES = new Set(["body", "hips", "pelvis", "root"]);
const bindTranslationsByModel = new WeakMap();

function semanticNodeName(value) {
  return String(value || "")
    .split(/[|:/\\]/)
    .at(-1)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function collectNativeRootTranslations(model) {
  const translations = new Map();
  const add = (node) => {
    if (node?.name && node?.position) translations.set(node.name, node.position.toArray());
  };
  add(model);
  model?.traverse((node) => {
    if (ROOT_TRANSLATION_NODE_NAMES.has(semanticNodeName(node?.name))) add(node);
    if (!node?.isSkinnedMesh || !node.skeleton) return;
    node.skeleton.bones.forEach((bone) => {
      if (!bone.parent?.isBone) add(bone);
    });
  });
  return translations;
}

// Native GLB clips own the skeletal pose only. World translation belongs to
// protocol root motion, so reset motion-carrier position tracks to their bind
// values. Using the bind value (rather than the clip's first sample) also
// prevents Run/Walk/Idle clips with different exported origins from changing
// the foot_center height when the timeline crosses a segment boundary.
export function makeNativeClipInPlace(clip, model) {
  let translations = bindTranslationsByModel.get(model);
  if (!translations) {
    translations = collectNativeRootTranslations(model);
    if (model && typeof model === "object") bindTranslationsByModel.set(model, translations);
  }
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith(".position")) return track;
    const nodeName = track.name.slice(0, -".position".length);
    const bindPosition = translations.get(nodeName);
    if (!bindPosition || track.values.length < 3) return track;
    const clone = track.clone();
    for (let index = 0; index < clone.values.length; index += 3) {
      clone.values[index] = bindPosition[0];
      clone.values[index + 1] = bindPosition[1];
      clone.values[index + 2] = bindPosition[2];
    }
    return clone;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
