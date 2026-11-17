/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveSessionAutoTitle } from "@noobot/session-protocol";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { recordStorageWork } from "./storage-transaction.js";

function position(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw immutableStorageError("Invalid title candidate position");
  return ordinal.toString(2).padStart(53, "0");
}

export function seedImmutableTitleIndex(plan) {
  plan.set("metadata", "titleIndex", { version: 1, root: null });
}

export async function requireImmutableTitleIndex(plan, requireReference) {
  const descriptor = await plan.get("metadata", "titleIndex");
  if (descriptor === null)
    throw Object.assign(new Error("Session title index requires an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  if (descriptor.version !== 1) throw immutableStorageError("Unknown session title index version");
  if (descriptor.root !== null) requireReference(descriptor.root);
  return descriptor;
}

export async function readImmutableTitleNode(store, reference, expectedPrefix = "") {
  recordStorageWork("immutableIndexPageReads");
  const node = await store.objects.readPage(reference);
  if (node?.kind === "title-candidate") {
    if (
      typeof node.uid !== "string" ||
      !node.uid ||
      !position(node.ordinal).startsWith(expectedPrefix)
    )
      throw immutableStorageError("Invalid title candidate");
  } else if (
    node?.kind === "title-branch" &&
    typeof node.prefix === "string" &&
    /^[01]{0,52}$/.test(node.prefix) &&
    node.prefix.startsWith(expectedPrefix)
  ) {
    store.requireReference(node.zero);
    store.requireReference(node.one);
  } else throw immutableStorageError("Invalid title index page");
  return node;
}

async function update({ store, reference, bits, candidate, expectedPrefix = "" }) {
  if (reference === null) return candidate === null ? null : store.objects.putPage(candidate);
  const node = await readImmutableTitleNode(store, reference, expectedPrefix);
  const prefix = node.kind === "title-candidate" ? position(node.ordinal) : node.prefix;
  let common = 0;
  while (common < prefix.length && prefix[common] === bits[common]) common += 1;
  if (common < prefix.length) {
    if (candidate === null) return reference;
    const added = await store.objects.putPage(candidate);
    return store.objects.putPage({
      kind: "title-branch",
      prefix: bits.slice(0, common),
      zero: bits[common] === "0" ? added : reference,
      one: bits[common] === "1" ? added : reference,
    });
  }
  if (node.kind === "title-candidate") {
    if (candidate === null) return null;
    if (node.uid !== candidate.uid)
      throw immutableStorageError("Title candidate position has conflicting ownership");
    return reference;
  }
  const side = bits[node.prefix.length] === "0" ? "zero" : "one";
  const child = await update({
    store,
    reference: node[side],
    bits,
    candidate,
    expectedPrefix: node.prefix + bits[node.prefix.length],
  });
  if (child === node[side]) return reference;
  if (child === null) return node[side === "zero" ? "one" : "zero"];
  return store.objects.putPage({ ...node, [side]: child });
}

export async function updateImmutableTitleCandidate(store, plan, previous, record) {
  const after = record && resolveSessionAutoTitle(record.message);
  if (!previous && !after) return;
  const descriptor = await requireImmutableTitleIndex(plan, store.requireReference);
  const selected = record ?? previous;
  const root = await update({
    store,
    reference: descriptor.root,
    bits: position(selected.ordinal),
    candidate: after
      ? { kind: "title-candidate", ordinal: selected.ordinal, uid: selected.message.messageUid }
      : null,
  });
  if (root !== descriptor.root) plan.set("metadata", "titleIndex", { version: 1, root });
}

async function readCandidateTitle(plan, node) {
  const record = await plan.get("messages", node.uid);
  if (!record || record.ordinal !== node.ordinal || record.message.messageUid !== node.uid)
    throw immutableStorageError("Title candidate references a missing or reordered message");
  const title = resolveSessionAutoTitle(record.message);
  if (!title) throw immutableStorageError("Title candidate is no longer eligible");
  return title;
}

export async function readImmutableIndexedTitle(store, plan) {
  const descriptor = await requireImmutableTitleIndex(plan, store.requireReference);
  let reference = descriptor.root;
  let prefix = "";
  while (reference !== null) {
    const node = await readImmutableTitleNode(store, reference, prefix);
    if (node.kind === "title-candidate") return readCandidateTitle(plan, node);
    prefix = node.prefix + "0";
    reference = node.zero;
  }
  return "";
}
