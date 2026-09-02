/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createAnimationArtifactValidator({ parseProtocol, parseAssets }) {
  return function validateAnimationArtifactData(data = {}) {
    const protocol = parseProtocol(data?.protocol);
    const assets = parseAssets(data?.assets);
    if (!protocol.success || !assets.success) return false;
    const referenced = new Set(protocol.data.characters.map((character) => character.assetId));
    const described = new Set();
    for (const asset of assets.data) {
      if (described.has(asset.assetId)) return false;
      described.add(asset.assetId);
    }
    if (referenced.size !== described.size || ![...referenced].every((id) => described.has(id)))
      return false;
    const assetNodes = new Map(assets.data.map((asset) => [asset.assetId, new Set(asset.nodes)]));
    const validColliders = protocol.data.scene.collisionSpace.colliders.every(
      (collider) =>
        collider.node === null ||
        assetNodes
          .get(
            protocol.data.characters.find(
              (character) => character.characterId === collider.characterId,
            )?.assetId,
          )
          ?.has(collider.node),
    );
    if (!validColliders) return false;
    const nodesByCharacter = new Map(
      protocol.data.characters.map((character) => [
        character.characterId,
        assetNodes.get(character.assetId) || new Set(),
      ]),
    );
    return protocol.data.scene.contactConstraints.every((constraint) => {
      const nodes = nodesByCharacter.get(constraint.characterId);
      const targetNodes = constraint.targetCharacterId
        ? nodesByCharacter.get(constraint.targetCharacterId)
        : null;
      return Boolean(
        nodes?.has(constraint.node) &&
        constraint.chain.every((node) => nodes.has(node)) &&
        (constraint.targetNode == null || targetNodes?.has(constraint.targetNode)),
      );
    });
  };
}
