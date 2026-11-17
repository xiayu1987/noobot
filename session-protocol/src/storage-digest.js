/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function storageDigest(serialized) {
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

export function createStorageDigest(state = sha256.create()) {
  return {
    update(text) {
      state.update(utf8ToBytes(text));
      return this;
    },
    copy() {
      return createStorageDigest(state.clone());
    },
    digest() {
      return bytesToHex(state.digest());
    },
  };
}
