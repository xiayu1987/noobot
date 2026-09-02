/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { multiplyQuaternion, rotateVector } from "./quaternion.js";

function normalize(value) {
  const magnitude = Math.hypot(...value);
  return magnitude > 1e-8 ? value.map((item) => item / magnitude) : [0, 0, 0];
}

// Returns the shortest Y-up rotation from the canonical character forward
// axis (-Z) to a world-space travel direction.
function rotationFromForward(direction, fallback) {
  const forward = normalize([direction[0], 0, direction[2]]);
  if (Math.hypot(...forward) <= 1e-8) return fallback;
  const dot = Math.max(-1, Math.min(1, -forward[2]));
  if (dot > 1 - 1e-8) return [0, 0, 0, 1];
  if (dot < -1 + 1e-8) return [0, 1, 0, 0];
  const axis = normalize([0, -forward[0], 0]);
  const angle = Math.acos(dot);
  const half = angle / 2;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

function hasRotation(frames) {
  return frames.some((frame) =>
    frame.rotation.some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-5),
  );
}

function applyAutomaticOrientation(frames, mode, authoredRotation = false) {
  if (mode === "authored" || !frames.length) return frames;
  // `auto` only fills rotations when the author omitted them. Explicit
  // rotations are authoritative and are never overwritten.
  if (mode === "auto" && authoredRotation) return frames;
  let lastRotation = frames[0].rotation;
  return frames.map((frame, index) => {
    const previous = frames[Math.max(0, index - 1)].position;
    const next = frames[Math.min(frames.length - 1, index + 1)].position;
    const direction = next.map((value, axis) => value - previous[axis]);
    const rotation = rotationFromForward(direction, lastRotation);
    lastRotation = rotation;
    return { ...frame, rotation };
  });
}

function transformLocalRoot(root, motion) {
  const rotated = rotateVector(
    root.rotation,
    motion.position.map((value, index) => value * root.scale[index]),
  );
  return {
    position: rotated.map((value, index) => value + root.position[index]),
    rotation: multiplyQuaternion(root.rotation, motion.rotation),
    scale: motion.scale.map((value, index) => value * root.scale[index]),
  };
}

function constantRootMotion(root, duration) {
  const frame = { time: 0, position: root.position, rotation: root.rotation, scale: root.scale };
  return { space: "normalized_world", keyframes: [frame, { ...frame, time: duration }] };
}

export function compileCharacterRootMotion(character) {
  let previous = { ...character.rootTransform };
  return {
    ...character,
    segments: character.segments.map((segment) => {
      if (!segment.rootMotion) {
        const rootMotion = constantRootMotion(previous, segment.duration);
        previous = rootMotion.keyframes[1];
        return { ...segment, rootMotion };
      }
      const localFrames = segment.rootMotion.keyframes;
      const keyframes = applyAutomaticOrientation(
        localFrames.map((frame) => ({
          time: frame.time,
          ...transformLocalRoot(previous, frame),
        })),
        character.orientationMode,
        hasRotation(localFrames),
      );
      previous = keyframes.at(-1);
      return { ...segment, rootMotion: { space: "normalized_world", keyframes } };
    }),
  };
}
