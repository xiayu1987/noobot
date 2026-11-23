/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";

const readScopes = new AsyncLocalStorage();

export async function withSessionReadCache(sessionDir, operation) {
  const directory = path.resolve(sessionDir);
  const current = readScopes.getStore();
  if (current?.active && current.directory === directory) return operation();
  const scope = { directory, active: true, reads: new Map(), paths: new Map(), token: {} };
  try {
    return await readScopes.run(scope, operation);
  } finally {
    scope.active = false;
    scope.reads.clear();
    scope.paths.clear();
  }
}

function resolveReadPath(scope, file) {
  const pathKey = path.isAbsolute(file) ? file : `${process.cwd()}\0${file}`;
  let absolute = scope.paths.get(pathKey);
  if (absolute === undefined) {
    absolute = path.resolve(file);
    scope.paths.set(pathKey, absolute);
  }
  return absolute;
}

export function sessionReadToken() {
  const scope = readScopes.getStore();
  if (!scope?.active) return undefined;
  return scope.token;
}

export function memoizeSessionRead(tier, file, read) {
  const scope = readScopes.getStore();
  if (!scope?.active) return read();
  const absolute = resolveReadPath(scope, file);
  if (!absolute.startsWith(`${scope.directory}${path.sep}`)) return read();
  let reads = scope.reads.get(absolute);
  if (!reads) {
    reads = new Map();
    scope.reads.set(absolute, reads);
  }
  if (!reads.has(tier)) reads.set(tier, Promise.resolve().then(read));
  return reads.get(tier);
}

export function invalidateSessionRead(file) {
  const scope = readScopes.getStore();
  if (scope?.active && scope.reads.delete(resolveReadPath(scope, file))) scope.token = {};
}
