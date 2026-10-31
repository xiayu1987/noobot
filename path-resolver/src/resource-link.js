/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isAbsolutePathForPlatform } from "./path-syntax.js";
import { isPlainObject } from "@noobot/shared/value";
import {
  LOCATOR_VIEW,
  LocatorError,
  createLocator,
  isCanonicalLocator,
  locatorKey,
} from "@noobot/shared/locator";
import { MUTATION_SNAPSHOT_STATE, isMutationRef } from "@noobot/file-mutation-protocol";

export const LINK_SNAPSHOT_KIND = Object.freeze({
  MUTATION: "mutation",
  ATTACHMENT: "attachment",
});

export const RESOURCE_LINK_STATUS = Object.freeze({
  MUTATION: "mutation",
  ATTACHMENT: "attachment",
  UNAVAILABLE: "unavailable",
});

export const RESOURCE_LINK_UNAVAILABLE_REASON = Object.freeze({
  RESOURCE_NOT_REGISTERED: "resource_not_registered",
  RESOURCE_DELETED: "resource_deleted",
  SNAPSHOT_UNAVAILABLE: "snapshot_unavailable",
  SNAPSHOT_OVERWRITTEN: "snapshot_overwritten",
  INVALID_LINK_PATH: "invalid_link_path",
});

function unavailable(reason) {
  return Object.freeze({ status: RESOURCE_LINK_STATUS.UNAVAILABLE, reason });
}

export function isFileLinkHref(href) {
  if (typeof href !== "string") throw new TypeError("link href must be a string");
  if (!href || href.startsWith("#") || href.startsWith("//")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1];
  return scheme === undefined || scheme.length === 1 || scheme.toLowerCase() === "file";
}

function snapshotLocator(snapshot) {
  if (!isPlainObject(snapshot)) throw new TypeError("link snapshot must be an object");
  if (!Number.isInteger(snapshot.messageIndex) || snapshot.messageIndex < 0) {
    throw new TypeError("link snapshot requires a non-negative integer messageIndex");
  }
  if (snapshot.kind === LINK_SNAPSHOT_KIND.MUTATION) {
    if (!isMutationRef(snapshot.ref))
      throw new TypeError("mutation link snapshot requires a MutationRef");
    return snapshot.ref.locator;
  }
  if (snapshot.kind === LINK_SNAPSHOT_KIND.ATTACHMENT) {
    const { ref } = snapshot;
    if (!isPlainObject(ref) || ref.source !== "attachment" || !isCanonicalLocator(ref.origin)) {
      throw new TypeError("attachment link snapshot requires an attachment resource with origin");
    }
    return ref.origin;
  }
  throw new TypeError(`unknown link snapshot kind: ${String(snapshot.kind)}`);
}

export function mutationLinkRef(mutationRef) {
  if (!isMutationRef(mutationRef)) throw new TypeError("mutationLinkRef requires a MutationRef");
  return `${mutationRef.mutationId}@${mutationRef.revision}`;
}

export function linkKey(snapshot) {
  return locatorKey(snapshotLocator(snapshot));
}

function tryLocator(value) {
  try {
    return createLocator(value);
  } catch (error) {
    if (error instanceof LocatorError) return null;
    throw error;
  }
}

function workspaceRootPath(workspaceRootDirectory) {
  if (workspaceRootDirectory === null) return null;
  if (typeof workspaceRootDirectory !== "string") {
    throw new TypeError("workspaceRootDirectory must be a string or null");
  }
  return createLocator({ view: LOCATOR_VIEW.HOST, path: workspaceRootDirectory }).path;
}

function underRoot(absolutePath, root) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : null;
}

function snapshotMounts(locators) {
  const mounts = new Set();
  for (const locator of locators) {
    if (locator.view === LOCATOR_VIEW.MOUNT) mounts.add(locator.mount);
  }
  return mounts;
}

function hrefKeys(href, mounts, workspaceRoot) {
  let path;
  try {
    path = decodeURIComponent(href);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (!path) return null;
  if (!/^file:/i.test(path) && !isAbsolutePathForPlatform(path)) {
    const workspace = tryLocator({ view: LOCATOR_VIEW.WORKSPACE, path });
    return workspace ? new Set([locatorKey(workspace)]) : null;
  }
  const host = tryLocator({ view: LOCATOR_VIEW.HOST, path });
  if (!host) return null;
  const keys = new Set([locatorKey(host)]);
  const workspacePath = workspaceRoot === null ? null : underRoot(host.path, workspaceRoot);
  if (workspacePath) {
    const workspace = tryLocator({ view: LOCATOR_VIEW.WORKSPACE, path: workspacePath });
    if (workspace) keys.add(locatorKey(workspace));
  }
  for (const mount of mounts) {
    const mountPath = underRoot(host.path, mount);
    if (!mountPath) continue;
    const locator = tryLocator({ view: LOCATOR_VIEW.MOUNT, mount, path: mountPath });
    if (locator) keys.add(locatorKey(locator));
  }
  return keys;
}

function isOverwritten(snapshot, later) {
  if (snapshot.kind !== LINK_SNAPSHOT_KIND.MUTATION) return false;
  const { mutationId, revision } = snapshot.ref;
  return later.some(
    (item) =>
      item.snapshot.kind === LINK_SNAPSHOT_KIND.MUTATION &&
      item.snapshot.ref.mutationId === mutationId &&
      item.snapshot.ref.revision > revision,
  );
}

function bind(snapshot, superseded, latest) {
  const extra = latest ? { latest } : {};
  if (snapshot.kind === LINK_SNAPSHOT_KIND.ATTACHMENT) {
    return Object.freeze({
      status: RESOURCE_LINK_STATUS.ATTACHMENT,
      identity: snapshot.ref.attachment,
      resourceRef: snapshot.ref,
      superseded,
      ...extra,
    });
  }
  const mutationRef = snapshot.ref;
  if (mutationRef.snapshot === MUTATION_SNAPSHOT_STATE.DELETED) {
    return Object.freeze({
      ...unavailable(RESOURCE_LINK_UNAVAILABLE_REASON.RESOURCE_DELETED),
      ...extra,
    });
  }
  if (mutationRef.snapshot !== MUTATION_SNAPSHOT_STATE.AVAILABLE) {
    return Object.freeze({
      ...unavailable(RESOURCE_LINK_UNAVAILABLE_REASON.SNAPSHOT_UNAVAILABLE),
      ...extra,
    });
  }
  return Object.freeze({
    status: RESOURCE_LINK_STATUS.MUTATION,
    mutationRef,
    superseded,
    ...extra,
  });
}

export function resolveLinkedResource(href, snapshots, { messageIndex, workspaceRootDirectory }) {
  if (typeof href !== "string") throw new TypeError("link href must be a string");
  if (!Array.isArray(snapshots)) throw new TypeError("snapshots must be an array");
  if (!Number.isInteger(messageIndex) || messageIndex < 0) {
    throw new TypeError("messageIndex must be a non-negative integer");
  }
  const root = workspaceRootPath(workspaceRootDirectory);
  const keyed = snapshots.map((snapshot) => {
    const locator = snapshotLocator(snapshot);
    return { snapshot, locator, key: locatorKey(locator) };
  });
  for (let index = 1; index < keyed.length; index += 1) {
    if (keyed[index].snapshot.messageIndex < keyed[index - 1].snapshot.messageIndex) {
      throw new TypeError("snapshots must be ordered by messageIndex");
    }
  }
  const keys = hrefKeys(href, snapshotMounts(keyed.map((item) => item.locator)), root);
  if (!keys) return unavailable(RESOURCE_LINK_UNAVAILABLE_REASON.INVALID_LINK_PATH);
  let bound = -1;
  for (let index = 0; index < keyed.length; index += 1) {
    if (keyed[index].snapshot.messageIndex > messageIndex) break;
    if (keys.has(keyed[index].key)) bound = index;
  }
  if (bound < 0) return unavailable(RESOURCE_LINK_UNAVAILABLE_REASON.RESOURCE_NOT_REGISTERED);
  const boundKey = keyed[bound].key;
  const later = keyed.slice(bound + 1).filter((item) => item.key === boundKey);
  const superseded = later.length > 0;
  const latest = superseded ? bind(later.at(-1).snapshot, false, null) : null;
  if (isOverwritten(keyed[bound].snapshot, later)) {
    return Object.freeze({
      ...unavailable(RESOURCE_LINK_UNAVAILABLE_REASON.SNAPSHOT_OVERWRITTEN),
      latest,
    });
  }
  return bind(keyed[bound].snapshot, superseded, latest);
}
