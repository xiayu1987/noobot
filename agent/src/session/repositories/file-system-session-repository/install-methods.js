/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function installRepositoryMethods(repositoryClass, ...methodGroups) {
  for (const methods of methodGroups) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
      if (name === "constructor") continue;
      Object.defineProperty(repositoryClass.prototype, name, {
        ...descriptor,
        enumerable: false,
      });
    }
  }
  return repositoryClass;
}
