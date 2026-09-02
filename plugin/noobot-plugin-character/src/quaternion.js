/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function multiplyQuaternion(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function rotateVector(q, value) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * value[2] - z * value[1]);
  const ty = 2 * (z * value[0] - x * value[2]);
  const tz = 2 * (x * value[1] - y * value[0]);
  return [
    value[0] + w * tx + y * tz - z * ty,
    value[1] + w * ty + z * tx - x * tz,
    value[2] + w * tz + x * ty - y * tx,
  ];
}
