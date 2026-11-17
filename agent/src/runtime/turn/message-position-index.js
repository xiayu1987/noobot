/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function height(node) {
  return node?.height ?? 0;
}

function resize(node) {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  return node;
}

function rotate(node, side) {
  const other = side === "left" ? "right" : "left";
  const next = node[other];
  node[other] = next[side];
  next[side] = resize(node);
  return resize(next);
}

function balance(node) {
  resize(node);
  const delta = height(node.left) - height(node.right);
  if (delta > 1) {
    if (height(node.left.left) < height(node.left.right)) node.left = rotate(node.left, "left");
    return rotate(node, "right");
  }
  if (delta < -1) {
    if (height(node.right.right) < height(node.right.left))
      node.right = rotate(node.right, "right");
    return rotate(node, "left");
  }
  return node;
}

function change(node, position, present) {
  if (!node) return present ? { position, height: 1, left: null, right: null } : null;
  if (position < node.position) node.left = change(node.left, position, present);
  else if (position > node.position) node.right = change(node.right, position, present);
  else {
    if (present) return node;
    if (!node.left) return node.right;
    if (!node.right) return node.left;
    let successor = node.right;
    while (successor.left) successor = successor.left;
    node.position = successor.position;
    node.right = change(node.right, successor.position, false);
  }
  return balance(node);
}

export function createMessagePositionIndex() {
  let root = null;
  function before(limit) {
    let node = root;
    let result;
    while (node) {
      if (node.position < limit) {
        result = node.position;
        node = node.right;
      } else node = node.left;
    }
    return result;
  }
  return {
    set(position, present) {
      root = change(root, position, present);
    },
    before,
    last: () => before(Infinity),
    clear() {
      root = null;
    },
  };
}
