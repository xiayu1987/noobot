/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { contentDigest, immutableStorageError } from "./immutable-object-store.js";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  readImmutableIndexPage,
  readImmutableIndexPages,
  validateImmutableIndexPage,
} from "./immutable-radix-index.js";
import {
  splitImmutablePageReferences,
  isImmutableValueBytePage,
  requireImmutableValueBytePage,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  decodeImmutableJsonBytes,
  immutableReplayReference,
  immutableSessionReferenceContract,
} from "@noobot/session-protocol/immutable-storage";

async function valueDigest(reader, reference, rootPage) {
  const hash = createHash("sha256");
  for await (const chunk of reader.readValueChunks(reference, { rootPage })) hash.update(chunk);
  return hash.digest("hex");
}

async function equivalentNextEntry(left, right, equivalent) {
  const a = await left.next();
  const b = await right.next();
  if (a.done || b.done) return a.done === b.done;
  if (a.value[0] !== b.value[0] || !(await equivalent(a.value[1], b.value[1]))) return false;
  return null;
}

async function equivalentEntries(left, right, equivalent) {
  try {
    while (true) {
      const result = await equivalentNextEntry(left, right, equivalent);
      if (result !== null) return result;
    }
  } finally {
    await left.return();
    await right.return();
  }
}

function isIndex(page) {
  return page.kind === "index-leaf" || page.kind === "index-branch";
}

async function equivalentValuePages(source, objects, actual, expected) {
  requireImmutableValueBytePage(actual.page);
  requireImmutableValueBytePage(expected.page);
  if (actual.page.bytes !== expected.page.bytes) return false;
  return (
    (await valueDigest(source, actual.reference, actual.page)) ===
    (await valueDigest(objects, expected.reference, expected.page))
  );
}

async function compareReplayPages(context, actual, expected, pending) {
  const { source, objects, entries, equivalent } = context;
  const actualPage = decodeImmutableJsonBytes(actual.bytes, actual.reference);
  const expectedPage = decodeImmutableJsonBytes(expected.bytes, expected.reference);
  if (isImmutableValueBytePage(actualPage) && isImmutableValueBytePage(expectedPage))
    return equivalentValuePages(
      source,
      objects,
      { reference: actual.reference, page: actualPage },
      { reference: expected.reference, page: expectedPage },
    );
  if (isIndex(actualPage) && isIndex(expectedPage))
    return equivalentEntries(
      entries(actual.reference, source.read.bind(source)),
      entries(expected.reference, objects.read.bind(objects)),
      equivalent,
    );
  const { shape, references } = splitImmutablePageReferences(
    actualPage,
    source.requireReference.bind(source),
  );
  if (!isDeepStrictEqual(shape, expected.shape)) return false;
  for (let index = 0; index < references.length; index += 1)
    pending.push([references[index], expected.children[index]]);
  return true;
}

export function createImmutableReplayObjects(source) {
  const format = source.constructor.format;
  immutableSessionReferenceContract(format);
  const pages = new Map();
  const created = new Set();
  let retained = [];
  const objects = Object.create(source);
  const capture = (bytes, graph) => {
    const digest = contentDigest(bytes);

    const reference = immutableReplayReference(format, digest, bytes.length);
    if (!pages.has(reference)) {
      pages.set(reference, {
        bytes: Buffer.from(bytes),
        count: 0,
        children: [],
        links: [],
        shape: undefined,
      });
      created.add(reference);
    }
    if (graph)
      Object.assign(pages.get(reference), { children: graph.references, shape: graph.shape });
    return reference;
  };
  objects.put = async (bytes) => capture(bytes);
  objects.putPage = async (page) => {
    const bytes = Buffer.from(JSON.stringify(page));
    return capture(bytes, splitImmutablePageReferences(page, source.requireReference.bind(source)));
  };
  objects.linkReferences = (reference, references) => {
    source.requireReference(reference);
    const page = pages.get(reference);
    if (!page) throw immutableStorageError("Replay link is outside its transition graph");
    for (const child of references) source.requireReference(child);
    page.links.push(...references);
  };
  objects.read = async (reference) => {
    const page = pages.get(reference);
    if (!page) throw immutableStorageError("Replay index is outside its transition graph");
    return page.bytes;
  };
  objects.readIndexPage = (reference, prefix) => readImmutableIndexPage(objects, reference, prefix);
  objects.readIndexPages = (nodes) => readImmutableIndexPages(objects, nodes);
  objects.putIndexPage = async (page, prefix) => {
    validateImmutableIndexPage(page, prefix, source.requireReference.bind(source));
    return objects.putPage(page);
  };
  const acquire = (reference) => {
    const page = pages.get(reference);
    if (!page || page.count++ > 0) return;
    for (const child of [...page.children, ...page.links]) acquire(child);
  };
  const release = (reference) => {
    const page = pages.get(reference);
    if (!page || --page.count > 0) return;
    for (const child of [...page.children, ...page.links]) release(child);
    pages.delete(reference);
  };

  async function* entries(reference, read, prefix = "") {
    const page = validateImmutableIndexPage(
      decodeImmutableJsonBytes(await read(reference), reference),
      prefix,
      source.requireReference.bind(source),
    );
    if (page.kind === "index-leaf") {
      const ordered = page.entries.map(([key, value]) => ({
        key,
        value,
        digest: contentDigest(key),
      }));
      ordered.sort((a, b) => a.digest.localeCompare(b.digest) || a.key.localeCompare(b.key));
      for (const { key, value } of ordered) yield [key, value];
      return;
    }
    for (const digit of Object.keys(page.children).sort())
      yield* entries(page.children[digit], read, prefix + digit);
  }
  return {
    objects,
    async equivalent(actual, expected) {
      const pending = [[actual, expected]];
      const compared = new Set();
      while (pending.length) {
        const [actualReference, expectedReference] = pending.pop();
        if (actualReference === expectedReference) continue;
        if (actualReference === null || expectedReference === null) return false;
        const identity = JSON.stringify([actualReference, expectedReference]);
        if (compared.has(identity)) continue;
        compared.add(identity);
        const expectedRecord = pages.get(expectedReference);
        if (!expectedRecord) return false;
        const bytes = await source.read(actualReference);
        if (bytes.equals(expectedRecord.bytes)) continue;
        if (expectedRecord.shape === undefined) return false;
        if (
          !(await compareReplayPages(
            { source, objects, entries, equivalent: this.equivalent.bind(this) },
            { reference: actualReference, bytes },
            { ...expectedRecord, reference: expectedReference },
            pending,
          ))
        )
          return false;
      }
      return true;
    },
    retain(root, operations) {
      const next = [root, operations];
      for (const reference of next) acquire(reference);
      for (const reference of retained) release(reference);
      for (const reference of created) {
        if (pages.get(reference)?.count === 0) pages.delete(reference);
      }
      created.clear();
      retained = next;
    },
  };
}
