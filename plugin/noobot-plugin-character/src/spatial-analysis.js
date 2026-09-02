/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { rotateVector } from "./quaternion.js";

function normalizeQuaternion(value) {
  const length = Math.hypot(...value);
  return length > 1e-12 ? value.map((item) => item / length) : [0, 0, 0, 1];
}

function slerpQuaternion(left, right, amount) {
  const a = normalizeQuaternion(left);
  let b = normalizeQuaternion(right);
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  if (dot < 0) {
    b = b.map((value) => -value);
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(a.map((value, index) => value + (b[index] - value) * amount));
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const leftWeight = Math.sin((1 - amount) * theta) / sinTheta;
  const rightWeight = Math.sin(amount * theta) / sinTheta;
  return normalizeQuaternion(a.map((value, index) => value * leftWeight + b[index] * rightWeight));
}

function interpolateRootMotion(character, time) {
  const segment = character.segments.find(
    (item) => item.rootMotion && time >= item.start && time <= item.start + item.duration,
  );
  if (!segment) {
    return {
      position: character.rootTransform.position,
      rotation: character.rootTransform.rotation,
      scale: character.rootTransform.scale,
    };
  }
  const frames = segment.rootMotion.keyframes;
  const localTime = Math.min(segment.duration, Math.max(0, time - segment.start));
  let left = frames[0];
  let right = frames.at(-1);
  for (let index = 1; index < frames.length; index += 1) {
    if (localTime <= frames[index].time) {
      left = frames[index - 1];
      right = frames[index];
      break;
    }
  }
  const amount = Math.min(
    1,
    Math.max(0, (localTime - left.time) / Math.max(0.000001, right.time - left.time)),
  );
  return {
    position: left.position.map((value, index) => value + (right.position[index] - value) * amount),
    rotation: slerpQuaternion(left.rotation, right.rotation, amount),
    scale: left.scale.map((value, index) => value + (right.scale[index] - value) * amount),
  };
}

export function characterPositionAt(character, time) {
  return interpolateRootMotion(character, time).position;
}

/**
 * Resolve the canonical asset transform used by the renderer. Callers that
 * have imported GLB scene data can provide a node resolver for exact bone
 * colliders; the fallback remains deterministic for server-side validation.
 */
export function characterTransformAt(character, time) {
  // Root motion is already expressed in canonical world coordinates. Asset
  // offsets belong to node-local geometry and must not move the trajectory.
  return interpolateRootMotion(character, time);
}

function colliderRadius(shape, scale = [1, 1, 1]) {
  const maxScale = Math.max(...scale.map((value) => Math.abs(value)), 0);
  const radius =
    shape.type === "sphere" || shape.type === "capsule"
      ? shape.radius + (shape.type === "capsule" ? shape.halfHeight : 0)
      : Math.hypot(...shape.size) / 2;
  return radius * maxScale;
}

function colliderWorldTransform(collider, character, time, options = {}) {
  const transform = characterTransformAt(character, time);
  const nodeTransform = options.resolveColliderNode?.(collider, character, time);
  if (nodeTransform?.position && nodeTransform?.rotation && nodeTransform?.scale) {
    return nodeTransform;
  }
  const localCenter = transform.scale.map((value, index) => value * collider.shape.center[index]);
  const rotatedCenter = rotateVector(transform.rotation, localCenter);
  return {
    position: transform.position.map((value, index) => value + rotatedCenter[index]),
    rotation: transform.rotation,
    scale: transform.scale,
  };
}

function colliderWorldCenter(collider, character, time, options = {}) {
  return colliderWorldTransform(collider, character, time, options).position;
}

function distanceSquaredToSegment(point, start, end) {
  const direction = end.map((value, index) => value - start[index]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  if (lengthSquared <= 1e-12)
    return point.reduce((sum, value, index) => sum + (value - start[index]) ** 2, 0);
  const amount = Math.min(
    1,
    Math.max(
      0,
      direction.reduce((sum, value, index) => sum + (point[index] - start[index]) * value, 0) /
        lengthSquared,
    ),
  );
  return point.reduce(
    (sum, value, index) => sum + (value - (start[index] + direction[index] * amount)) ** 2,
    0,
  );
}

function sweptClearance(source, target, characters, startTime, endTime, options = {}) {
  const sourceStartTransform = colliderWorldTransform(
    source,
    characters.get(source.characterId),
    startTime,
    options,
  );
  const sourceEndTransform = colliderWorldTransform(
    source,
    characters.get(source.characterId),
    endTime,
    options,
  );
  const targetStartTransform = colliderWorldTransform(
    target,
    characters.get(target.characterId),
    startTime,
    options,
  );
  const targetEndTransform = colliderWorldTransform(
    target,
    characters.get(target.characterId),
    endTime,
    options,
  );
  const sourceStart = sourceStartTransform.position;
  const sourceEnd = sourceEndTransform.position;
  const targetStart = targetStartTransform.position;
  const targetEnd = targetEndTransform.position;
  const relativeStart = sourceStart.map((value, index) => value - targetStart[index]);
  const relativeEnd = sourceEnd.map((value, index) => value - targetEnd[index]);
  return (
    Math.sqrt(distanceSquaredToSegment([0, 0, 0], relativeStart, relativeEnd)) -
    colliderRadius(source.shape, sourceEndTransform.scale) -
    colliderRadius(target.shape, targetEndTransform.scale)
  );
}

function collidersCanContact(source, target, characters, time, options = {}) {
  if (!source || !target) return false;
  const sourceCharacter = characters.get(source.characterId);
  const targetCharacter = characters.get(target.characterId);
  if (!sourceCharacter || !targetCharacter) return false;
  const sourceTransform = colliderWorldTransform(source, sourceCharacter, time, options);
  const targetTransform = colliderWorldTransform(target, targetCharacter, time, options);
  const sourceCenter = sourceTransform.position;
  const targetCenter = targetTransform.position;
  const distance = Math.hypot(...sourceCenter.map((value, index) => value - targetCenter[index]));
  return (
    distance <=
    colliderRadius(source.shape, sourceTransform.scale) +
      colliderRadius(target.shape, targetTransform.scale) +
      (options.reachAllowance || 0) +
      0.05
  );
}

function nodeReachAllowance(collider, character, time, options) {
  if (collider?.node == null) return 0;
  if (options.attackReachAllowance != null) return options.attackReachAllowance;
  // Server-side validation cannot resolve animated bone world transforms. A
  // node-bound hitbox/hurtbox therefore gets a conservative limb allowance,
  // while root colliders and contact events retain strict static geometry.
  const transform = characterTransformAt(character, time);
  return Math.abs(transform.scale[1] || 1) * 0.65;
}

export function hasSpatiallyReachableEvents(value, options = {}) {
  const characters = new Map(
    value.characters.map((character) => [character.characterId, character]),
  );
  const colliders = new Map(
    value.scene.collisionSpace.colliders.map((collider) => [collider.colliderId, collider]),
  );
  return value.events.every((event) => {
    if (event.type === "attack") {
      const source = colliders.get(event.hitboxId);
      const target = colliders.get(event.hurtboxId);
      const sourceCharacter = characters.get(source?.characterId);
      const targetCharacter = characters.get(target?.characterId);
      const reachAllowance =
        options.attackReachAllowance ??
        nodeReachAllowance(source, sourceCharacter, event.time, options) +
          nodeReachAllowance(target, targetCharacter, event.time, options);
      return collidersCanContact(source, target, characters, event.time, {
        ...options,
        reachAllowance,
      });
    }
    if (event.type === "contact")
      return collidersCanContact(
        colliders.get(event.sourceColliderId),
        colliders.get(event.targetColliderId),
        characters,
        event.time,
        options,
      );
    return true;
  });
}

export function analyzeAnimationSpatial(protocol, options = {}) {
  const characters = new Map(
    protocol.characters.map((character) => [character.characterId, character]),
  );
  const colliders = protocol.scene.collisionSpace.colliders;
  const diagnostics = new Map(
    protocol.characters.map((character) => [
      character.characterId,
      {
        distance: 0,
        displacement: 0,
        averageSpeed: 0,
        maxSpeed: 0,
        minClearance: Infinity,
        penetrationIntervals: [],
      },
    ]),
  );
  const samples = Math.max(2, Math.ceil(protocol.duration * 60) + 1);
  const dt = protocol.duration / (samples - 1);
  for (const character of protocol.characters) {
    let previous = characterPositionAt(character, 0);
    let distance = 0;
    let maxSpeed = 0;
    for (let index = 1; index < samples; index += 1) {
      const current = characterPositionAt(character, index * dt);
      const step = Math.hypot(...current.map((value, axis) => value - previous[axis]));
      distance += step;
      maxSpeed = Math.max(maxSpeed, step / dt);
      previous = current;
    }
    const item = diagnostics.get(character.characterId);
    item.distance = distance;
    item.displacement = Math.hypot(
      ...characterPositionAt(character, protocol.duration).map(
        (value, index) => value - characterPositionAt(character, 0)[index],
      ),
    );
    item.averageSpeed = distance / protocol.duration;
    item.maxSpeed = maxSpeed;
  }
  const penetrationIntervals = [];
  for (let index = 0; index < colliders.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < colliders.length; otherIndex += 1) {
      const source = colliders[index];
      const target = colliders[otherIndex];
      if (source.characterId === target.characterId) continue;
      let start = null;
      let minClearance = Infinity;
      for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
        const time = sampleIndex * dt;
        const sourceTransform = colliderWorldTransform(
          source,
          characters.get(source.characterId),
          time,
          options,
        );
        const targetTransform = colliderWorldTransform(
          target,
          characters.get(target.characterId),
          time,
          options,
        );
        const a = sourceTransform.position;
        const b = targetTransform.position;
        const clearance =
          Math.hypot(...a.map((value, axis) => value - b[axis])) -
          colliderRadius(source.shape, sourceTransform.scale) -
          colliderRadius(target.shape, targetTransform.scale);
        minClearance = Math.min(minClearance, clearance);
        if (sampleIndex > 0) {
          const swept = sweptClearance(source, target, characters, time - dt, time, options);
          minClearance = Math.min(minClearance, swept);
          if (swept < 0 && start == null) start = time - dt;
        }
        if (clearance < 0 && start == null) start = time;
        if (clearance >= 0 && start != null) {
          penetrationIntervals.push({
            sourceColliderId: source.colliderId,
            targetColliderId: target.colliderId,
            start,
            end: time,
          });
          start = null;
        }
      }
      if (start != null)
        penetrationIntervals.push({
          sourceColliderId: source.colliderId,
          targetColliderId: target.colliderId,
          start,
          end: protocol.duration,
        });
      diagnostics.get(source.characterId).minClearance = Math.min(
        diagnostics.get(source.characterId).minClearance,
        minClearance,
      );
      diagnostics.get(target.characterId).minClearance = Math.min(
        diagnostics.get(target.characterId).minClearance,
        minClearance,
      );
    }
  }
  return {
    units: protocol.scene.coordinateSystem,
    sampleRate: (samples - 1) / protocol.duration,
    characters: Object.fromEntries(
      [...diagnostics].map(([id, value]) => [
        id,
        {
          ...value,
          minClearance: Number.isFinite(value.minClearance) ? value.minClearance : null,
        },
      ]),
    ),
    penetrationIntervals,
  };
}
