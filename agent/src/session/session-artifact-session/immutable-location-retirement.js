/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, opendir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { fsRm, fsOpen } from "../../shared/storage/fs-adapter.js";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_LOCATION_RETIREMENT as PROOF,
  requireImmutableLocationRetirementState,
  requireImmutableLocationRetirementOwner,
  requireImmutableLocationRetirementTaskPage,
  requireImmutableLocationRetirementQueueOffset,
  requireImmutableLocationRetirementResult,
  immutableRecordStillReachable,
} from "@noobot/session-protocol/immutable-record-location";
import {
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  immutableStorageError,
  IMMUTABLE_CLEANUP_PLAN,
} from "@noobot/session-protocol/immutable-storage";
import { requireSessionOperationId } from "@noobot/session-protocol/session-changes";
import {
  immutablePageReferences,
  immutableCommitReferenceEdges,
  immutableOperationReceiptReferenceEdges,
  immutableCollectionValueReferenceEdges,
  immutableValueIndexLayout,
  isImmutableValueBytePage,
  requireImmutableValueBytePage,
  requireImmutableValueBranchChildren,
  requireImmutableValueParts,
  isImmutableValuePartsPage,
} from "@noobot/session-protocol/immutable-storage-graph";
import { requireImmutableOperationReceipt } from "@noobot/session-protocol/immutable-operation-receipt";
import { writeDurableReplacement, syncStorageDirectory } from "./immutable-object-store.js";
import { ImmutableRecordStore } from "./immutable-record-store.js";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileId,
} from "@noobot/session-protocol/immutable-segment";
import { ImmutableRadixIndex } from "./immutable-radix-index.js";
import { withStorageCleanup } from "./immutable-storage-io.js";
import { readImmutableTitleNode } from "./immutable-title-index.js";

function retirementTaskFromSemanticEdge(edge) {
  const { reference, kind } = edge;
  if (edge.role === "title") return { reference, kind: "title", prefix: "" };
  if (kind === "index") return { reference, kind, collection: edge.role, prefix: "" };
  if (edge.collection === undefined) return { reference, kind };
  return { reference, kind, collection: edge.collection, key: edge.key };
}

export class ImmutableLocationRetirement {
  constructor(store, options) {
    this.store = store;
    this.options = options;
    this.directory = path.join(store.sessionDir, PROOF.directory);
    this.file = path.join(this.directory, PROOF.state);

    this.pages = new ImmutableRecordStore(this.directory);
    this.seen = new ImmutableRadixIndex(this.pages);
    this.candidates = new Set(options.records.map(({ identity }) => identity));
  }

  async load(head, create = true) {
    requireSessionOperationId(this.options.operationId);
    let handle;
    try {
      handle = await fsOpen(this.file, "r");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return null;
      this.store.assertGeneration(head, this.options.expectedGeneration);
      await mkdir(this.directory, { recursive: true });
      await syncStorageDirectory(path.dirname(this.directory));
      await syncStorageDirectory(this.store.sessionDir);
      return {
        format: PROOF.format,
        sessionId: head.sessionId,
        operationId: this.options.operationId,
        expectedGeneration: this.options.expectedGeneration,
        records: structuredClone(this.options.records),
        observedGeneration: 0,
        queue: null,
        queueOffset: 0,
        seen: null,
        processed: 0,
        segmentTail: null,
        publicationGeneration: null,
      };
    }
    const bytes = await readHandlePrefix(handle, IMMUTABLE_CLEANUP_PLAN.recordBytes + 1);
    const state = requireImmutableLocationRetirementOwner(
      decodeImmutableCleanupBytes(bytes),
      head.sessionId,
      this.options,
    );
    return create ? requireImmutableLocationRetirementState(state) : state;
  }

  save(state) {
    return writeDurableReplacement(
      this.file,
      encodeImmutableCleanupRecord(requireImmutableLocationRetirementState(state)),
    );
  }

  async enqueue(state, tasks) {
    requireImmutableLocationRetirementQueueOffset(state.queue, state.queueOffset);
    tasks = tasks.filter(({ reference }) => reference !== null);

    for (let offset = 0; offset < tasks.length; offset += PROOF.tasksPerPage) {
      const previous = state.queue;
      state.queue = await this.pages.putValue(
        requireImmutableLocationRetirementTaskPage({
          previous,
          previousOffset: state.queueOffset,
          tasks: tasks.slice(offset, offset + PROOF.tasksPerPage),
        }),
      );
      this.pages.linkReferences(state.queue, [previous]);
      state.queueOffset = 0;
    }
  }

  async pop(state) {
    requireImmutableLocationRetirementQueueOffset(state.queue, state.queueOffset);
    const chunk = requireImmutableLocationRetirementTaskPage(
      await this.pages.readValue(state.queue),
    );
    if (state.queueOffset >= chunk.tasks.length)
      throw immutableStorageError("Location retirement queue offset exceeds its task page");
    const task = chunk.tasks[chunk.tasks.length - 1 - state.queueOffset];
    state.queueOffset += 1;
    if (state.queueOffset === chunk.tasks.length) {
      state.queue = chunk.previous;
      state.queueOffset = chunk.previousOffset;
    }
    return task;
  }

  async semanticEdges(task) {
    const { reference, kind, collection, key } = task;
    if (
      kind === "collection" &&
      collection !== "commitOrder" &&
      !immutableValueIndexLayout(collection, key).length
    )
      return [];

    const root = await this.store.objects.readPage(reference);
    const template =
      root.kind === "value-parts" ? await this.store.objects.readPage(root.template) : root;
    const metadataBytes =
      root.kind === "value-parts-inline"
        ? Buffer.byteLength(JSON.stringify(root.value))
        : template.bytes;
    if (!Number.isSafeInteger(metadataBytes) || metadataBytes > PROOF.metadataBytes)
      throw Object.assign(
        new Error("Location retirement reference metadata exceeds its byte budget"),
        {
          code: "SESSION_RETIREMENT_METADATA_BUDGET_EXCEEDED",
          reference,
        },
      );
    const { value } = await this.store.objects.readValueMetadata(reference);
    if (kind === "commit") return immutableCommitReferenceEdges(value, this.store.requireReference);
    if (kind === "operation")
      return immutableOperationReceiptReferenceEdges(value, this.store.requireReference);
    if (kind === "collection")
      return immutableCollectionValueReferenceEdges(
        collection,
        key,
        value,
        this.store.requireReference,
      );
    throw immutableStorageError("Invalid location retirement semantic task");
  }

  async children(task) {
    const { reference, kind, collection, prefix } = task;
    this.store.requireReference(reference);
    if (kind === "raw") {
      const bytes = await this.store.objects.read(reference);
      if (bytes.length !== task.bytes) throw immutableStorageError("Immutable value size mismatch");
      return [];
    }
    if (["commit", "operation", "collection"].includes(kind)) {
      const edges = await this.semanticEdges(task);
      return [{ reference, kind: "page" }, ...edges.map(retirementTaskFromSemanticEdge)];
    }
    if (kind === "index") {
      const page = await this.store.index.readPage(reference, prefix);
      if (page.kind === "index-branch")
        return Object.entries(page.children).map(([digit, child]) => ({
          reference: child,
          kind,
          collection,
          prefix: prefix + digit,
        }));
      if (page.kind !== "index-leaf") throw immutableStorageError("Invalid retirement index page");
      return page.entries.map(([key, child]) => {
        if (collection === "collections")
          return { reference: child, kind: "index", collection: key, prefix: "" };
        if (collection === "operations") return { reference: child, kind: "operation" };
        if (collection === "scalar") return { reference: child, kind: "page" };
        return { reference: child, kind: "collection", collection, key };
      });
    }
    if (kind === "title") {
      const page = await readImmutableTitleNode(this.store, reference, prefix);
      return page.kind === "title-candidate"
        ? []
        : [
            { reference: page.zero, kind, prefix: page.prefix + "0" },
            { reference: page.one, kind, prefix: page.prefix + "1" },
          ];
    }
    if (kind !== "page" && kind !== "bytes")
      throw immutableStorageError("Unknown location retirement task kind");
    const page = await this.store.objects.readPage(reference);
    if (kind === "bytes" || isImmutableValueBytePage(page)) {
      requireImmutableValueBytePage(page, kind === "bytes" ? task.bytes : page.bytes);
      const depth = kind === "bytes" ? task.depth : 0;
      if (page.kind === "value-inline") return [];
      if (page.kind === "value") return [{ reference: page.data, kind: "raw", bytes: page.bytes }];
      this.store.requireReference(page.left);
      this.store.requireReference(page.right);
      const left = await this.store.objects.readPage(page.left);
      const right = await this.store.objects.readPage(page.right);
      requireImmutableValueBranchChildren(page, left, right);
      return [
        { reference: page.left, kind: "bytes", bytes: left.bytes, depth: depth + 1 },
        { reference: page.right, kind: "bytes", bytes: right.bytes, depth: depth + 1 },
      ];
    }
    if (isImmutableValuePartsPage(page)) {
      requireImmutableValueParts(page, this.store.requireReference);
      const references = [
        ...(page.kind === "value-parts" ? [page.template] : []),
        ...page.parts.map((part) => part.reference),
      ];
      const children = [];
      for (const child of references) {
        const root = requireImmutableValueBytePage(await this.store.objects.readPage(child));
        children.push({ reference: child, kind: "bytes", bytes: root.bytes, depth: 0 });
      }
      return children;
    }
    return immutablePageReferences(page, this.store.requireReference).map((child) => ({
      reference: child,
      kind: "page",
    }));
  }

  async segmentInventory() {
    const existing = new Set();
    let entries;
    try {
      entries = await opendir(path.join(this.directory, IMMUTABLE_SEGMENT.directory));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (entries)
      for await (const entry of entries) {
        existing.add(entry.name);
        if (existing.size > PROOF.proofSegments) break;
      }
    return existing;
  }

  requireCapacity(existing) {
    for (const segment of this.pages.batch().records.segments) existing.add(`${segment.id}.seg`);
    if (existing.size > PROOF.proofSegments)
      throw Object.assign(new Error("Location retirement temporary segment capacity exceeded"), {
        code: "SESSION_RETIREMENT_CAPACITY_EXCEEDED",
      });
    for (const file of existing)
      if (immutableSegmentFileId(file) === null)
        throw immutableStorageError("Unexpected location retirement segment file");
  }

  async advance(state, head) {
    let processedTasks = 0;
    await this.pages.withDurabilityBatch(async () => {
      this.pages.beginCommit(state);
      const segments = await this.segmentInventory();
      this.requireCapacity(segments);
      if (head.generation !== state.observedGeneration) {
        await this.enqueue(state, [
          { reference: head.root, kind: "index", collection: "collections", prefix: "" },
          { reference: head.operations, kind: "index", collection: "operations", prefix: "" },
          { reference: head.commit, kind: "commit" },
        ]);
        state.observedGeneration = head.generation;
      }
      const marker = await this.pages.putValue(true);
      const limit = this.options.maxTasks ?? PROOF.tasks;
      while (state.queue !== null && processedTasks < limit) {
        this.options.signal?.throwIfAborted();
        const task = await this.pop(state);
        processedTasks += 1;
        if (this.candidates.has(task.reference))
          throw immutableRecordStillReachable(task.reference);
        const identity = JSON.stringify(task);
        if ((await this.seen.get(state.seen, identity)) !== null) continue;
        const children = await this.children(task);
        state.seen = await this.seen.set(state.seen, identity, marker);
        await this.enqueue(state, children);
      }
      state.processed += processedTasks;
      if (state.queue === null) state.publicationGeneration = head.generation;
      this.requireCapacity(segments);
      await this.pages.publishReachable([state.queue, state.seen]);
      Object.assign(state, this.pages.publicationHeadFields());
      this.options.signal?.throwIfAborted();
      await this.save(state);
    });
    return processedTasks;
  }

  publish(state) {
    return this.store.transact({
      expectedGeneration: state.publicationGeneration,
      operationId: state.operationId,
      input: {
        kind: "retire-record-locations",
        expectedGeneration: state.expectedGeneration,
        records: state.records,
      },
      prepare: async () => {
        for (const source of state.records) {
          this.options.signal?.throwIfAborted();
          await this.store.objects.retireLocation(source);
        }
        this.options.signal?.throwIfAborted();
        return {
          changes: [],
          result: requireImmutableLocationRetirementResult(
            { retiredRecords: state.records.length },
            state.records,
          ),
        };
      },
      projectResult: (outcome) => {
        requireImmutableLocationRetirementResult(outcome.result, state.records);
        return { complete: true, ...outcome };
      },
    });
  }

  async discard() {
    await this.load(await this.store.snapshot(), false);
    await withStorageCleanup(
      () => fsRm(this.directory, { recursive: true, force: true }),
      async () => {
        await mkdir(path.dirname(this.directory), { recursive: true });
        await syncStorageDirectory(path.dirname(this.directory));
      },
    );
    return { discarded: true };
  }

  async run() {
    const head = await this.store.snapshot();
    requireSessionOperationId(this.options.operationId);
    const receipt = await this.store.objects.withSnapshot(head, async () => {
      const reference = await this.store.index.get(head.operations, this.options.operationId);
      return reference === null
        ? null
        : requireImmutableOperationReceipt(
            await this.store.objects.readValue(reference),
            head.generation,
            this.store.requireReference,
          );
    });
    if (receipt !== null)
      return this.publish({ ...this.options, publicationGeneration: receipt.generation - 1 });
    const state = await this.load(head);
    if (state.publicationGeneration !== null) {
      try {
        return await this.publish(state);
      } catch (error) {
        if (error.code !== "SESSION_GENERATION_CONFLICT") throw error;
        state.publicationGeneration = null;
      }
    }
    const processedTasks = await this.store.objects.withSnapshot(head, () =>
      this.advance(state, head),
    );
    if (state.publicationGeneration !== null) return this.publish(state);
    return { complete: false, processedTasks, totalProcessedTasks: state.processed };
  }
}
