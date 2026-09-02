/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import catalogSource from "../camera-presets/catalog.json" with { type: "json" };
import { CameraPlanSchema, CameraPresetCatalogSchema } from "../camera-presets/schema.js";
import { characterPositionAt } from "./spatial-analysis.js";

const catalog = CameraPresetCatalogSchema.parse(catalogSource);
const catalogById = new Map(catalog.map((preset) => [preset.presetId, preset]));
const EPSILON = 0.0001;

const add = (left, right) => left.map((value, index) => value + right[index]);
const subtract = (left, right) => left.map((value, index) => value - right[index]);
const scale = (value, amount) => value.map((item) => item * amount);
const length = (value) => Math.hypot(...value);
const normalize = (value, fallback = [0, 0, 1]) => {
  const magnitude = length(value);
  return magnitude > EPSILON ? scale(value, 1 / magnitude) : [...fallback];
};
const interpolate = (left, right, amount) =>
  left.map((value, index) => value + (right[index] - value) * amount);

function subjectCenter(character, time, assetById = new Map()) {
  const position = characterPositionAt(character, time);
  const asset = assetById.get(character.assetId);
  const normalizedHeight = asset
    ? asset.bounds.height * asset.normalization.scale * character.rootTransform.scale[1]
    : character.rootTransform.scale[1];
  return add(position, [0, normalizedHeight * 0.5, 0]);
}

function requireSubjects(characters, ids) {
  if (!ids?.length) return characters;
  const byId = new Map(characters.map((character) => [character.characterId, character]));
  return ids.map((id) => {
    const character = byId.get(id);
    if (!character) throw new TypeError(`camera preset references unknown subject: ${id}`);
    return character;
  });
}

function shotTimes(shot, samples) {
  return Array.from({ length: samples }, (_, index) =>
    index === samples - 1
      ? shot.start + shot.duration
      : shot.start + (shot.duration * index) / (samples - 1),
  );
}

function subjectRadius(character, assetById) {
  const asset = assetById.get(character.assetId);
  if (!asset) return Math.max(...character.rootTransform.scale) * 0.5;
  const size = asset.bounds.max.map(
    (value, index) =>
      (value - asset.bounds.min[index]) *
      asset.normalization.scale *
      character.rootTransform.scale[index],
  );
  return Math.max(0.25, Math.hypot(...size) / 2);
}

function frameEnvelope(subjects, shot, fov, margin, groundY, assetById) {
  const points = [];
  for (const time of shotTimes(shot, 9)) {
    for (const character of subjects) points.push(subjectCenter(character, time, assetById));
  }
  const minimum = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const maximum = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  const subjectScale = Math.max(
    0.5,
    ...subjects.map((character) => subjectRadius(character, assetById)),
  );
  const radius = Math.max(
    subjectScale * 0.5,
    ...points.map((point) => length(subtract(point, center)) + subjectScale * 0.5),
  );
  const distance = Math.max(
    radius + 0.35,
    (radius * (1 + margin)) / Math.tan((fov * Math.PI) / 360),
  );
  const target = [center[0], Math.max(groundY + 0.25, center[1]), center[2]];
  // Characters face the protocol canonical -Z axis. Place the default camera
  // on that forward side so previews and generated animations show their face.
  return { target, radius, distance, position: add(target, [0, radius * 0.35, -distance]) };
}

function applyTranslate(frames, operator) {
  return frames.map((frame, index) => {
    const amount = index / Math.max(1, frames.length - 1);
    return {
      ...frame,
      position: operator.position
        ? add(frame.position, scale(operator.position, amount))
        : frame.position,
      target: operator.target ? add(frame.target, scale(operator.target, amount)) : frame.target,
    };
  });
}

function applyDolly(frames, operator) {
  return frames.map((frame, index) => {
    const amount = index / Math.max(1, frames.length - 1);
    const direction = subtract(frame.position, frame.target);
    const ratio = 1 + (operator.endDistanceRatio - 1) * amount;
    return { ...frame, position: add(frame.target, scale(direction, ratio)) };
  });
}

function applyOrbit(frames, operator) {
  return frames.map((frame, index) => {
    const amount = index / Math.max(1, frames.length - 1);
    const offset = subtract(frame.position, frame.target);
    const angle = (operator.degrees * Math.PI * amount) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
      ...frame,
      position: add(frame.target, [
        offset[0] * cosine + offset[2] * sine,
        offset[1],
        -offset[0] * sine + offset[2] * cosine,
      ]),
    };
  });
}

function applyFollow(frames, operator, subjects, shot, envelope, assetById) {
  const firstCenter = subjectCenter(subjects[0], shot.start, assetById);
  const lastCenter = subjectCenter(subjects[0], shot.start + shot.duration, assetById);
  const forward = normalize(subtract(lastCenter, firstCenter));
  const horizontalForward = normalize([forward[0], 0, forward[2]]);
  const horizontalOffset =
    operator.side === "behind"
      ? scale(horizontalForward, -envelope.distance)
      : scale(
          operator.side === "right"
            ? [horizontalForward[2], 0, -horizontalForward[0]]
            : [-horizontalForward[2], 0, horizontalForward[0]],
          envelope.distance,
        );
  return frames.map((frame) => {
    const target = subjectCenter(subjects[0], frame.time, assetById);
    return {
      ...frame,
      target,
      position: add(target, add(horizontalOffset, [0, envelope.radius * 0.35, 0])),
    };
  });
}

function enforceSafety(frames, characters, groundY, assetById) {
  return frames.map((frame) => {
    let position = [...frame.position];
    for (const character of characters) {
      const center = subjectCenter(character, frame.time, assetById);
      const minimumDistance = subjectRadius(character, assetById) + 0.35;
      const offset = subtract(position, center);
      if (length(offset) < minimumDistance) {
        position = add(center, scale(normalize(offset), minimumDistance));
      }
    }
    position[1] = Math.max(position[1], groundY + 0.15);
    return { ...frame, position };
  });
}

function compileShot(preset, shot, characters, groundY, assetById) {
  const subjects = requireSubjects(characters, shot.subjectIds);
  const framing = preset.operators[0];
  const envelope = frameEnvelope(subjects, shot, framing.fov, framing.margin, groundY, assetById);
  let frames = shotTimes(shot, preset.samples).map((time) => ({
    time,
    position: [...envelope.position],
    target: [...envelope.target],
    fov: framing.fov,
    transition: "blend",
    easing: "ease_in_out",
  }));
  for (const operator of preset.operators.slice(1)) {
    if (operator.type === "translate") frames = applyTranslate(frames, operator);
    if (operator.type === "dolly") frames = applyDolly(frames, operator);
    if (operator.type === "orbit") frames = applyOrbit(frames, operator);
    if (operator.type === "follow")
      frames = applyFollow(frames, operator, subjects, shot, envelope, assetById);
  }
  return enforceSafety(frames, characters, groundY, assetById);
}

function frameAt(frames, time) {
  const rightIndex = frames.findIndex((frame) => frame.time >= time);
  if (rightIndex <= 0) return { ...frames[0], time };
  const right = frames[rightIndex];
  const left = frames[rightIndex - 1];
  const amount = (time - left.time) / Math.max(EPSILON, right.time - left.time);
  return {
    time,
    position: interpolate(left.position, right.position, amount),
    target: interpolate(left.target, right.target, amount),
    fov: left.fov + (right.fov - left.fov) * amount,
    transition: "blend",
    easing: "ease_in_out",
  };
}

function normalizedShots(plan, duration) {
  if ("presetId" in plan) {
    return [{ ...plan, start: 0, duration, transition: "cut" }];
  }
  let expectedStart = 0;
  for (const shot of plan.shots) {
    if (Math.abs(shot.start - expectedStart) > EPSILON) {
      throw new TypeError(
        `camera shots must continuously cover the animation (expected shot start: ${expectedStart})`,
      );
    }
    expectedStart = shot.start + shot.duration;
  }
  if (Math.abs(expectedStart - duration) > EPSILON) {
    throw new TypeError(
      `camera shots must continuously cover the animation (expected end: ${duration}, received: ${expectedStart})`,
    );
  }
  return plan.shots;
}

export function listCameraPresets() {
  return catalog.map(({ operators: _operators, samples: _samples, ...descriptor }) => descriptor);
}

export function compileCameraPlan({ camera, duration, characters, assets = [], groundY = 0 } = {}) {
  const plan = CameraPlanSchema.parse(camera);
  const shots = normalizedShots(plan, duration);
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const keyframes = [];
  shots.forEach((shot, index) => {
    const preset = catalogById.get(shot.presetId);
    if (!preset) throw new TypeError(`unknown camera preset: ${shot.presetId}`);
    const frames = compileShot(preset, shot, characters, groundY, assetById);
    if (index === 0) {
      keyframes.push(...frames);
      return;
    }
    if (shot.transition === "cut") {
      frames[0].transition = "cut";
      keyframes.push(...frames);
      return;
    }
    const blendEndsAt = shot.start + Math.min(0.35, shot.duration * 0.2);
    keyframes.push(
      frameAt(frames, blendEndsAt),
      ...frames.filter((frame) => frame.time > blendEndsAt),
    );
  });
  return {
    type: "keyframes",
    positionInterpolation: "catmull_rom_centripetal",
    targetInterpolation: "catmull_rom_centripetal",
    fovInterpolation: "cubic",
    keyframes,
  };
}
