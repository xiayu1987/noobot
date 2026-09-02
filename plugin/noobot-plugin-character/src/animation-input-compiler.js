/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createAnimationInputCompiler({
  parseInput,
  parseProtocol,
  compileRootMotion,
  compileCamera,
}) {
  return function compileAnimationInput(value, { assets = [] } = {}) {
    const input = parseInput(value);
    const characters = input.characters.map(compileRootMotion);
    return parseProtocol({
      ...input,
      characters,
      scene: {
        coordinateSystem: input.scene.coordinateSystem,
        unitHeight: input.scene.unitHeight,
        groundY: input.scene.groundY,
        collisionSpace: input.scene.collisionSpace,
        contactConstraints: input.scene.contactConstraints,
        cameraTrack: compileCamera({
          camera: input.scene.camera,
          duration: input.duration,
          characters,
          assets,
          groundY: input.scene.groundY,
        }),
      },
    });
  };
}
