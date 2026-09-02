/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import * as THREE from "three";
import * as RAPIER from "@dimforge/rapier3d-compat";

const PHYSICS_DT = 1 / 60;
let rapierInitPromise;

function findNode(root, name) {
  let result;
  root?.traverse((node) => {
    if (!result && node.name === name) result = node;
  });
  return result;
}

function colliderWorldTransform(player, collider) {
  const node = collider.node ? findNode(player.model, collider.node) : null;
  if (node) {
    node.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    node.getWorldPosition(position);
    node.getWorldQuaternion(rotation);
    player.anchor.getWorldScale(scale);
    position.add(
      new THREE.Vector3()
        .fromArray(collider.shape.center)
        .multiply(scale)
        .applyQuaternion(rotation),
    );
    return { position, rotation, scale };
  }
  player.anchor.updateMatrixWorld(true);
  const position = new THREE.Vector3().fromArray(collider.shape.center);
  player.anchor.localToWorld(position);
  const scale = new THREE.Vector3();
  player.anchor.getWorldScale(scale);
  return { position, scale, rotation: player.anchor.quaternion.clone() };
}

function rapierDescription(shape, scale = new THREE.Vector3(1, 1, 1)) {
  const sx = Math.max(0.0001, Math.abs(scale.x));
  const sy = Math.max(0.0001, Math.abs(scale.y));
  const sz = Math.max(0.0001, Math.abs(scale.z));
  if (shape.type === "sphere") return RAPIER.ColliderDesc.ball(shape.radius * Math.max(sx, sy, sz));
  if (shape.type === "capsule")
    return RAPIER.ColliderDesc.capsule(shape.halfHeight * sy, shape.radius * Math.max(sx, sz));
  return RAPIER.ColliderDesc.cuboid(
    (shape.size[0] * sx) / 2,
    (shape.size[1] * sy) / 2,
    (shape.size[2] * sz) / 2,
  );
}

const rapierVector = (value) => ({ x: value.x, y: value.y, z: value.z });
const rapierQuaternion = (value) => ({ x: value.x, y: value.y, z: value.z, w: value.w });
const isPhysicalCollider = (collider) => collider?.role === "solid" || collider?.role === "hurtbox";

function syncColliderTransforms(player) {
  if (!player.rapierColliders?.length || !player.rapierBody) return;
  player.anchor.updateMatrixWorld(true);
  const bodyPosition = player.rapierBody.translation();
  const bodyRotationValue = player.rapierBody.rotation();
  const inverseRotation = new THREE.Quaternion(
    bodyRotationValue.x,
    bodyRotationValue.y,
    bodyRotationValue.z,
    bodyRotationValue.w,
  ).invert();
  for (const item of player.rapierColliders) {
    const world = colliderWorldTransform(player, item.collider);
    const local = world.position
      .sub(new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z))
      .applyQuaternion(inverseRotation);
    item.colliderRef.setTranslationWrtParent(rapierVector(local));
    const rotation = inverseRotation.clone().multiply(world.rotation);
    item.colliderRef.setRotationWrtParent(rapierQuaternion(rotation));
    if (!item.lastScale || !item.lastScale.equals(world.scale)) {
      item.colliderRef.setShape(rapierDescription(item.collider.shape, world.scale).shape);
      item.lastScale = world.scale.clone();
    }
  }
}

function createPlayerPhysics(world, player, character, protocol) {
  const colliders = protocol.scene.collisionSpace.colliders.filter(
    (item) => isPhysicalCollider(item) && item.characterId === character?.characterId,
  );
  if (!colliders.length) return;
  const authored = player.authoredPosition || player.anchor.position;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      authored.x,
      authored.y,
      authored.z,
    ),
  );
  body.enableCcd(true);
  const controllers = colliders.map(() => {
    const controller = world.createCharacterController(0.005);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    controller.enableSnapToGround(0.08);
    return controller;
  });
  player.rapierBody = body;
  player.rapierController = controllers[0];
  player.rapierControllers = controllers;
  player.rapierColliders = colliders.map((collider) => ({
    collider,
    colliderRef: world.createCollider(rapierDescription(collider.shape), body),
    lastScale: null,
  }));
  player.physicsPosition = authored.clone();
  player.physicsCorrection = new THREE.Vector3();
  syncColliderTransforms(player);
}

export function createCharacterPhysicsRuntime({ getPlayers, getScene, getRevision }) {
  let world;
  let groundBody;
  let ready = false;
  let accumulator = 0;
  let generation = 0;

  function release() {
    generation += 1;
    for (const player of getPlayers().values()) {
      new Set([...(player.rapierControllers || []), player.rapierController]).forEach((item) =>
        item?.free?.(),
      );
      player.rapierControllers = [];
      player.rapierController = undefined;
      player.rapierColliders = [];
      player.rapierBody = undefined;
    }
    world?.free?.();
    world = undefined;
    groundBody = undefined;
    ready = false;
    accumulator = 0;
  }

  async function setup(protocol, revision) {
    ready = false;
    const setupGeneration = generation;
    const collisionSpace = protocol?.scene?.collisionSpace;
    if (
      collisionSpace?.detection !== "continuous" ||
      !collisionSpace.colliders?.some(isPhysicalCollider)
    )
      return;
    rapierInitPromise ||= RAPIER.init();
    await rapierInitPromise;
    if (
      revision !== getRevision() ||
      setupGeneration !== generation ||
      !getScene() ||
      !getPlayers().size
    )
      return;
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const groundY = Number(protocol.scene.groundY) || 0;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.05, 100).setTranslation(0, groundY - 0.05, 0),
      groundBody,
    );
    for (const player of getPlayers().values()) {
      const character = protocol.characters.find((item) => item.assetId === player.assetId);
      createPlayerPhysics(world, player, character, protocol);
    }
    world.step();
    if (revision !== getRevision() || setupGeneration !== generation) return release();
    ready = true;
  }

  function reset() {
    for (const player of getPlayers().values()) {
      if (!player.rapierBody || !player.authoredPosition) continue;
      player.physicsPosition.copy(player.authoredPosition);
      player.physicsCorrection.set(0, 0, 0);
      player.rapierBody.setTranslation(rapierVector(player.physicsPosition), true);
      player.rapierBody.setRotation(rapierQuaternion(player.authoredRotation), true);
      player.grounded = false;
    }
  }

  function projectPlayer(player, groundY) {
    if (!player.rapierBody || !player.rapierControllers?.length || !player.rapierColliders?.length)
      return;
    const desired = player.authoredPosition.clone().sub(player.physicsPosition);
    let movement;
    let grounded = false;
    let collisionCount = 0;
    for (let index = 0; index < player.rapierColliders.length; index += 1) {
      const controller = player.rapierControllers[index];
      controller.computeColliderMovement(
        player.rapierColliders[index].colliderRef,
        rapierVector(desired),
      );
      const candidate = controller.computedMovement();
      const length = candidate.x ** 2 + candidate.y ** 2 + candidate.z ** 2;
      if (!movement || length < movement.x ** 2 + movement.y ** 2 + movement.z ** 2)
        movement = candidate;
      grounded ||= controller.computedGrounded();
      collisionCount += controller.numComputedCollisions();
    }
    const projected = new THREE.Vector3(movement.x, movement.y, movement.z);
    if (
      player.authoredPosition.y <= groundY + 0.0001 &&
      player.physicsPosition.y + projected.y < player.authoredPosition.y
    )
      projected.y = player.authoredPosition.y - player.physicsPosition.y;
    player.physicsPosition.add(projected);
    player.rapierBody.setTranslation(rapierVector(player.physicsPosition), true);
    player.grounded = grounded;
    player.anchor.userData.grounded = grounded;
    player.anchor.userData.collisionCount = collisionCount;
    player.physicsCorrection.copy(player.physicsPosition).sub(player.authoredPosition);
    player.anchor.userData.physicsCorrection = player.physicsCorrection;
    player.anchor.position.copy(player.physicsPosition);
    syncColliderTransforms(player);
  }

  function step(protocol, delta) {
    if (!ready || !world) return;
    const players = getPlayers();
    if (protocol.scene.collisionSpace.detection !== "continuous") {
      for (const player of players.values()) player.physicsCorrection?.set(0, 0, 0);
      return;
    }
    accumulator = Math.min(accumulator + delta, 0.1);
    while (accumulator >= PHYSICS_DT) {
      accumulator -= PHYSICS_DT;
      for (const player of players.values()) {
        if (!player.rapierBody || !player.authoredPosition) continue;
        player.rapierBody.setTranslation(rapierVector(player.physicsPosition), true);
        player.anchor.position.copy(player.physicsPosition);
        player.rapierBody.setRotation(rapierQuaternion(player.authoredRotation), true);
        syncColliderTransforms(player);
      }
      world.step();
      const groundY = Number(protocol.scene.groundY) || 0;
      for (const player of players.values()) projectPlayer(player, groundY);
      world.step();
    }
    for (const player of players.values())
      if (player.physicsCorrection)
        player.anchor.position.copy(player.authoredPosition).add(player.physicsCorrection);
  }

  return { setup, reset, step, release, colliderWorldTransform, findNode };
}
