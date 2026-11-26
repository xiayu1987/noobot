/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  access as nodeAccess,
  readFile as nodeReadFile,
  stat as nodeStat,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  lstat as nodeLstat,
  open as nodeOpen,
} from "@noobot/shared/file-system";
import {
  link as nodeLink,
  mkdir as nodeMkdir,
  writeFile as nodeWriteFile,
  rename as nodeRename,
  rm as nodeRm,
} from "node:fs/promises";
import { syncDirectory } from "@noobot/platform-compatibility/file-system";
import { isFunction } from "@noobot/shared/value";

function createDefaultFsAdapter() {
  return {
    access: (...args) => nodeAccess(...args),
    link: (...args) => nodeLink(...args),
    mkdir: (...args) => nodeMkdir(...args),
    readFile: (...args) => nodeReadFile(...args),
    writeFile: (...args) => nodeWriteFile(...args),
    rename: (...args) => nodeRename(...args),
    rm: (...args) => nodeRm(...args),
    stat: (...args) => nodeStat(...args),
    readdir: (...args) => nodeReaddir(...args),
    realpath: (...args) => nodeRealpath(...args),
    lstat: (...args) => nodeLstat(...args),
    open: (...args) => nodeOpen(...args),
    syncDirectory: (directory) => syncDirectory({ directory, open: fsOpen }),
  };
}

const defaultFsAdapter = createDefaultFsAdapter();
let activeFsAdapter = defaultFsAdapter;

function normalizeFsAdapter(adapter = null) {
  const source = adapter && typeof adapter === "object" ? adapter : {};
  return {
    access: typeof source.access === "function" ? source.access : defaultFsAdapter.access,
    link: typeof source.link === "function" ? source.link : defaultFsAdapter.link,
    mkdir: typeof source.mkdir === "function" ? source.mkdir : defaultFsAdapter.mkdir,
    readFile: typeof source.readFile === "function" ? source.readFile : defaultFsAdapter.readFile,
    writeFile:
      typeof source.writeFile === "function" ? source.writeFile : defaultFsAdapter.writeFile,
    rename: typeof source.rename === "function" ? source.rename : defaultFsAdapter.rename,
    rm: typeof source.rm === "function" ? source.rm : defaultFsAdapter.rm,
    stat: typeof source.stat === "function" ? source.stat : defaultFsAdapter.stat,
    readdir: typeof source.readdir === "function" ? source.readdir : defaultFsAdapter.readdir,
    realpath: typeof source.realpath === "function" ? source.realpath : defaultFsAdapter.realpath,
    lstat: typeof source.lstat === "function" ? source.lstat : defaultFsAdapter.lstat,
    open: typeof source.open === "function" ? source.open : defaultFsAdapter.open,
    syncDirectory: isFunction(source.syncDirectory)
      ? source.syncDirectory
      : defaultFsAdapter.syncDirectory,
  };
}

export function setFsAdapter(adapter = null) {
  activeFsAdapter = normalizeFsAdapter(adapter);
  return activeFsAdapter;
}

export function getFsAdapter() {
  return activeFsAdapter;
}

export function resetFsAdapter() {
  activeFsAdapter = defaultFsAdapter;
  return activeFsAdapter;
}

export async function fsAccess(...args) {
  return activeFsAdapter.access(...args);
}

export async function fsLink(...args) {
  return activeFsAdapter.link(...args);
}

export async function fsMkdir(...args) {
  return activeFsAdapter.mkdir(...args);
}

export async function fsReadFile(...args) {
  return activeFsAdapter.readFile(...args);
}

export async function fsWriteFile(...args) {
  return activeFsAdapter.writeFile(...args);
}

export async function fsRename(...args) {
  return activeFsAdapter.rename(...args);
}

export async function fsRm(...args) {
  return activeFsAdapter.rm(...args);
}

export async function fsStat(...args) {
  return activeFsAdapter.stat(...args);
}

export async function fsReaddir(...args) {
  return activeFsAdapter.readdir(...args);
}

export async function fsRealpath(...args) {
  return activeFsAdapter.realpath(...args);
}

export async function fsLstat(...args) {
  return activeFsAdapter.lstat(...args);
}

export function fsSyncDirectory(directory) {
  return activeFsAdapter.syncDirectory(directory);
}

export async function fsOpen(...args) {
  return activeFsAdapter.open(...args);
}
