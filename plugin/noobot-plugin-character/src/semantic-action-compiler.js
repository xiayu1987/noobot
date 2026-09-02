/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { multiplyQuaternion, rotateVector } from "./quaternion.js";

const MOTION_SPEEDS = Object.freeze({
  walk: 1,
  run: 3,
  crawl: 0.5,
  jump: 2.5,
  hop: 2,
  drop: 1.5,
  detour: 1,
  step_over: 1,
  jump_over: 2,
  vault: 1.5,
  climb_over: 0.6,
});

function mergeSegment(map, characterId, segment) {
  const timeline = map.get(characterId);
  if (!timeline)
    throw new TypeError(`animation script references unknown character: ${characterId}`);
  timeline.push(segment);
}

function obstacleById(scene, obstacleId) {
  const collider = scene?.collisionSpace?.colliders?.find((item) => item.colliderId === obstacleId);
  if (!collider || collider.role !== "solid")
    throw new TypeError(`motion obstacle must reference a solid collider: ${obstacleId}`);
  return collider;
}

function obstacleWaypoint(collider, start, target, action, clearance) {
  if (collider.shape.type !== "box")
    throw new TypeError(`motion obstacle action requires a box collider: ${collider.colliderId}`);
  const { center, size } = collider.shape;
  if (action !== "detour") return [center[0], center[1] + size[1] / 2 + clearance, center[2]];
  const bounds = {
    minX: center[0] - size[0] / 2 - clearance,
    maxX: center[0] + size[0] / 2 + clearance,
  };
  const left = Math.abs(start[0] - bounds.minX) + Math.abs(target[0] - bounds.minX);
  const right = Math.abs(start[0] - bounds.maxX) + Math.abs(target[0] - bounds.maxX);
  return [left <= right ? bounds.minX : bounds.maxX, start[1], start[2]];
}

function quaternionInverse(q) {
  const magnitude = q.reduce((sum, value) => sum + value * value, 0);
  return magnitude > 1e-8
    ? [-q[0] / magnitude, -q[1] / magnitude, -q[2] / magnitude, q[3] / magnitude]
    : [0, 0, 0, 1];
}

function yawForTarget(current, target, fallback) {
  const dx = target[0] - current[0];
  const dz = target[2] - current[2];
  if (Math.hypot(dx, dz) <= 1e-8) return fallback;
  const angle = Math.atan2(-dx, -dz);
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

function appendNativeSegment(segmentMap, node, start, duration, keyframes) {
  mergeSegment(segmentMap, node.characterId, {
    type: "native_clip",
    start,
    duration,
    clip: node.clip,
    rootMotion: { space: "character_local", keyframes },
  });
}

function movementPoints(node, current, target, scene) {
  const points = [current];
  const obstacle = node.obstacleId ? obstacleById(scene, node.obstacleId) : null;
  const clearance = node.clearance ?? 0.25;
  if (node.mode === "detour") {
    const waypoint = obstacleWaypoint(obstacle, current, target, node.mode, clearance);
    points.push(waypoint, [waypoint[0], waypoint[1], target[2]]);
  } else if (node.mode === "jump" || node.mode === "hop") {
    const apex = current.map((value, index) => (value + target[index]) / 2);
    apex[1] = Math.max(current[1], target[1]) + (node.mode === "hop" ? 0.35 : 1);
    points.push(apex);
  } else if (["step_over", "jump_over", "vault", "climb_over"].includes(node.mode)) {
    points.push(obstacleWaypoint(obstacle, current, target, node.mode, clearance));
  }
  points.push(target);
  return points;
}

function compileMove(node, start, runtime) {
  const { state, segmentMap, scene } = runtime;
  const character = state.characters.get(node.characterId);
  if (!character)
    throw new TypeError(`animation script references unknown character: ${node.characterId}`);
  const current = state.positions.get(node.characterId) || [...character.rootTransform.position];
  const target = [...node.target];
  if (
    ["walk", "run", "crawl", "detour", "step_over"].includes(node.mode) &&
    Math.abs(target[1] - current[1]) > 0.0001
  )
    throw new TypeError(`${node.mode} target must remain on the ground plane`);
  if (node.mode === "drop" && target[1] >= current[1] - 0.0001)
    throw new TypeError("drop target must be below the current position");
  const points = movementPoints(node, current, target, scene);
  const distance = points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])),
      0,
    );
  const duration = node.duration ?? Math.max(0.2, distance / MOTION_SPEEDS[node.mode]);
  const inverseRotation = character.rootTransform.rotation.map((value, index) =>
    index < 3 ? -value : value,
  );
  const keyframes = points.map((point, index) => ({
    time: duration * (index / (points.length - 1)),
    position: rotateVector(
      inverseRotation,
      point.map((value, axis) => value - current[axis]),
    ),
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  }));
  appendNativeSegment(segmentMap, node, start, duration, keyframes);
  state.positions.set(node.characterId, target);
  if (Math.hypot(target[0] - current[0], target[2] - current[2]) > 1e-8)
    state.rotations.set(
      node.characterId,
      yawForTarget(current, target, state.rotations.get(node.characterId)),
    );
  return duration;
}

function compileOrient(node, start, runtime) {
  const { state, segmentMap } = runtime;
  const current = state.positions.get(node.characterId);
  const rotation = state.rotations.get(node.characterId) || [0, 0, 0, 1];
  if (!current)
    throw new TypeError(`animation script references unknown character: ${node.characterId}`);
  const target =
    node.mode === "face"
      ? yawForTarget(current, node.target, rotation)
      : multiplyQuaternion(rotation, [0, Math.sin(node.angle / 2), 0, Math.cos(node.angle / 2)]);
  const duration = node.duration ?? 0.4;
  appendNativeSegment(segmentMap, node, start, duration, [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    {
      time: duration,
      position: [0, 0, 0],
      rotation: multiplyQuaternion(quaternionInverse(rotation), target),
      scale: [1, 1, 1],
    },
  ]);
  state.rotations.set(node.characterId, target);
  return duration;
}

function compilePosture(node, start, runtime) {
  if (!runtime.state.characters.has(node.characterId))
    throw new TypeError(`animation script references unknown character: ${node.characterId}`);
  appendNativeSegment(runtime.segmentMap, node, start, node.duration, [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    { time: node.duration, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  ]);
  return node.duration;
}

function compileTimelineNode(node, start, runtime) {
  const type = node.type === "clip" ? "native_clip" : "keyframes";
  const tracks =
    node.type === "channel"
      ? node.tracks.map((track) => ({ ...track, channelId: track.channelId || node.channelId }))
      : node.tracks;
  mergeSegment(runtime.segmentMap, node.characterId, {
    type,
    start,
    duration: node.duration,
    ...(node.clip ? { clip: node.clip } : { tracks }),
    ...(node.rootMotion ? { rootMotion: node.rootMotion } : {}),
  });
  return node.duration;
}

function validateParallel(node) {
  const motions = node.steps.filter((step) => ["move", "orient", "posture"].includes(step.type));
  const motionIds = motions.map((step) => step.characterId);
  if (new Set(motionIds).size !== motionIds.length)
    throw new TypeError("parallel motion nodes for one character are ambiguous");
  const motionCharacters = new Set(motionIds);
  const authored = new Set();
  for (const channel of node.steps.filter((step) => step.type === "channel")) {
    if (motionCharacters.has(channel.characterId))
      throw new TypeError("parallel channels cannot share a character with motion nodes");
    for (const track of channel.tracks) {
      const key = `${channel.characterId}:${track.node}:${track.property}`;
      if (authored.has(key))
        throw new TypeError(
          `parallel channels cannot author the same node/property: ${track.node}.${track.property}`,
        );
      authored.add(key);
    }
  }
}

function mergeParallelChannels(node, start, runtime, before) {
  const characterIds = new Set(
    node.steps.filter((step) => step.type === "channel").map((step) => step.characterId),
  );
  for (const characterId of characterIds) {
    const segments = runtime.segmentMap.get(characterId);
    const added = segments.slice(before.get(characterId));
    if (added.length <= 1) continue;
    const duration = added[0].duration;
    if (added.some((segment) => segment.duration !== duration || segment.start !== start))
      throw new TypeError("parallel channels must share one start and duration");
    const rootMotions = added.map((segment) => segment.rootMotion).filter(Boolean);
    if (rootMotions.length > 1)
      throw new TypeError("parallel channels cannot author multiple root motion tracks");
    segments.splice(before.get(characterId), added.length, {
      type: "keyframes",
      start,
      duration,
      tracks: added.flatMap((segment) => segment.tracks),
      ...(rootMotions[0] ? { rootMotion: rootMotions[0] } : {}),
    });
  }
}

function compileNode(node, start, runtime) {
  if (["clip", "keyframes", "channel"].includes(node.type))
    return compileTimelineNode(node, start, runtime);
  if (node.type === "move") return compileMove(node, start, runtime);
  if (node.type === "orient") return compileOrient(node, start, runtime);
  if (node.type === "posture") return compilePosture(node, start, runtime);
  if (node.type === "event") {
    runtime.events.push({ ...node.event, time: start });
    return 0;
  }
  if (node.type === "parallel") {
    validateParallel(node);
    const before = new Map([...runtime.segmentMap].map(([id, segments]) => [id, segments.length]));
    const durations = node.steps.map((step) => compileNode(step, start, runtime));
    mergeParallelChannels(node, start, runtime, before);
    return Math.max(...durations);
  }
  let duration = 0;
  for (const step of node.steps) duration += compileNode(step, start + duration, runtime);
  return duration;
}

export function createSemanticActionCompiler({ parseScript, parseProtocolInput }) {
  return function compileAnimationScript(value) {
    const script = parseScript(value);
    const segmentMap = new Map(script.characters.map((item) => [item.characterId, []]));
    const runtime = {
      segmentMap,
      events: [],
      scene: script.scene,
      state: {
        characters: new Map(script.characters.map((item) => [item.characterId, item])),
        positions: new Map(
          script.characters.map((item) => [item.characterId, [...item.rootTransform.position]]),
        ),
        rotations: new Map(
          script.characters.map((item) => [item.characterId, [...item.rootTransform.rotation]]),
        ),
      },
    };
    const duration = compileNode(script.root, 0, runtime);
    if (!(duration > 0)) throw new TypeError("animation script duration must be positive");
    for (const character of script.characters) {
      const segments = segmentMap.get(character.characterId);
      if (
        !segments.length ||
        Math.abs(segments.at(-1).start + segments.at(-1).duration - duration) > 0.0001
      )
        throw new TypeError(
          `animation script does not span full duration for character: ${character.characterId}`,
        );
    }
    return parseProtocolInput({
      format: "noobot.animation.protocol",
      version: 4,
      duration,
      loop: script.loop,
      scene: script.scene,
      characters: script.characters.map((item) => ({
        ...item,
        segments: segmentMap.get(item.characterId),
      })),
      events: runtime.events,
    });
  };
}
