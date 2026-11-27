/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { isObjectLike } from "@noobot/shared/value";

const encoder = new TextEncoder();
const nonAscii = /[^\x00-\x7f]/;
export const JOURNAL_JSON_MAX_DEPTH = QUANTITY_THRESHOLDS.partitionStorage.journalJsonMaxDepth;

export function captureJournalJson(value, { budget = Infinity, budgetError } = {}) {
  const { serialized, bytes } = writeJournalJson(value, {
    budget,
    maxDepth: JOURNAL_JSON_MAX_DEPTH,
    budgetError,
  });
  return { value: parseFrozenJournalJson(serialized), bytes };
}

export function parseFrozenJournalJson(serialized) {
  return JSON.parse(serialized, (_, value) => (isObjectLike(value) ? Object.freeze(value) : value));
}

function writeJournalJson(value, options) {
  const chunks = [];
  const writer = new JournalJsonWriter({ ...options, chunks });
  writer.visit(value, 0);
  return { serialized: chunks.join(""), bytes: writer.bytes };
}

export function encodeBoundedJournalJson(value, options) {
  return writeJournalJson(value, options).serialized;
}

export function measureBoundedJournalJson(value, budget, maxDepth, budgetError) {
  const writer = new JournalJsonWriter({ budget, maxDepth, budgetError });
  writer.visit(value, 0);
  return writer.bytes;
}

function requireDataValue(descriptor) {
  if (!descriptor || !Object.hasOwn(descriptor, "value"))
    throw new TypeError("Journal JSON requires own data properties");
  return descriptor.value;
}

class JournalJsonWriter {
  constructor({ budget, maxDepth, budgetError, chunks, encodeKey }) {
    this.budget = budget;
    this.maxDepth = maxDepth;
    this.budgetError = budgetError;
    this.chunks = chunks;
    this.encodeKey = encodeKey;
    this.ancestors = new Set();
    this.bytes = 0;
  }

  push(text) {
    if (text.length > this.budget - this.bytes) throw this.budgetError();
    this.bytes += nonAscii.test(text) ? encoder.encode(text).length : text.length;
    if (this.bytes > this.budget) throw this.budgetError();
    this.chunks?.push(text);
  }

  string(text) {
    if (text.length > this.budget - this.bytes) throw this.budgetError();
    this.push(JSON.stringify(text));
  }

  arrayItems(entry, depth) {
    if (Reflect.ownKeys(entry).length !== entry.length + 1)
      throw new TypeError("Journal JSON arrays cannot carry extra properties or holes");
    for (let index = 0; index < entry.length; index += 1) {
      if (index) this.push(",");
      this.visitProperty(Object.getOwnPropertyDescriptor(entry, index), depth, index);
    }
  }

  objectItems(entry, depth) {
    let first = true;
    for (const key of Reflect.ownKeys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== "string" || !descriptor?.enumerable)
        throw new TypeError("Journal JSON cannot discard symbol or non-enumerable properties");
      if (!first) this.push(",");
      first = false;
      this.string(this.encodeKey ? this.encodeKey(key) : key);
      this.push(":");
      this.visitProperty(descriptor, depth, key);
    }
  }

  visitProperty(descriptor, depth, key) {
    try {
      this.visit(requireDataValue(descriptor), depth + 1);
    } catch (error) {
      if (error instanceof TypeError) {
        error.message += ` at [${JSON.stringify(key)}]`;
      }
      throw error;
    }
  }

  visit(entry, depth) {
    if (depth > this.maxDepth) throw new TypeError("Journal JSON nesting exceeds protocol limit");
    if (entry === null || typeof entry === "boolean") return this.push(String(entry));
    if (typeof entry === "string") return this.string(entry);
    if (typeof entry === "number" && Number.isFinite(entry))
      return this.push(JSON.stringify(entry));
    if (!isObjectLike(entry)) throw new TypeError("Journal requests require finite JSON values");
    if (this.ancestors.has(entry)) throw new TypeError("Journal JSON cannot contain cycles");
    const array = Array.isArray(entry);
    if (Object.getPrototypeOf(entry) !== (array ? Array.prototype : Object.prototype))
      throw new TypeError("Journal JSON requires plain objects or arrays");
    this.ancestors.add(entry);
    this.push(array ? "[" : "{");
    if (array) this.arrayItems(entry, depth);
    else this.objectItems(entry, depth);
    this.push(array ? "]" : "}");
    this.ancestors.delete(entry);
  }
}
