/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeNativeClipInPlace } from "../frontend/runtime/nativeClipNormalization.js";

test("native clips keep skeletal root translation at its bind pose", () => {
  const model = new THREE.Group();
  const body = new THREE.Object3D();
  body.name = "Body";
  body.position.set(0.25, 1.5, -0.75);
  const hand = new THREE.Object3D();
  hand.name = "Hand";
  model.add(body, hand);
  const bodyTrack = new THREE.VectorKeyframeTrack(
    "Body.position",
    [0, 0.5, 1],
    [0, -2, 8, 1, 4, 6, 2, -3, 4],
  );
  const handTrack = new THREE.VectorKeyframeTrack("Hand.position", [0, 1], [0, 0, 0, 1, 2, 3]);
  const source = new THREE.AnimationClip("Run", 1, [bodyTrack, handTrack]);

  const normalized = makeNativeClipInPlace(source, model);

  assert.deepEqual(
    [...normalized.tracks[0].values],
    [0.25, 1.5, -0.75, 0.25, 1.5, -0.75, 0.25, 1.5, -0.75],
  );
  assert.deepEqual([...normalized.tracks[1].values], [0, 0, 0, 1, 2, 3]);
  assert.deepEqual([...source.tracks[0].values], [0, -2, 8, 1, 4, 6, 2, -3, 4]);
});

test("namespace-qualified hips tracks are normalized to the bind pose", () => {
  const model = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = "mixamorig:Hips";
  hips.position.set(-0.1, 1.1, 0.2);
  model.add(hips);
  const source = new THREE.AnimationClip("Walk", 1, [
    new THREE.VectorKeyframeTrack("mixamorig:Hips.position", [0, 1], [2, -1, 7, 4, 5, 9]),
  ]);

  const normalized = makeNativeClipInPlace(source, model);

  assert.deepEqual(
    [...normalized.tracks[0].values].map((value) => Number(value.toFixed(4))),
    [-0.1, 1.1, 0.2, -0.1, 1.1, 0.2],
  );

  hips.position.set(9, 9, 9);
  const normalizedAgain = makeNativeClipInPlace(source, model);
  assert.deepEqual(
    [...normalizedAgain.tracks[0].values].map((value) => Number(value.toFixed(4))),
    [-0.1, 1.1, 0.2, -0.1, 1.1, 0.2],
  );
});
