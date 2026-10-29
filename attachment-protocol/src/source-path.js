/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "./errors.js";

const BACKSLASH = String.fromCharCode(92);
const FILE_URI_PREFIX = "file://";

function hasDriveRoot(path) {
  return path.length >= 3 && /[A-Za-z]/.test(path[0]) && path[1] === ":" && path[2] === "/";
}

export function normalizeSourcePath(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new AttachmentProtocolError("invalid_attachment_source_path");
  }
  let path = value;
  if (path.toLowerCase().startsWith(FILE_URI_PREFIX)) {
    try {
      path = decodeURIComponent(path.slice(FILE_URI_PREFIX.length));
    } catch {
      throw new AttachmentProtocolError("invalid_attachment_source_path_encoding");
    }
    if (path[0] === "/" && hasDriveRoot(path.slice(1))) path = path.slice(1);
  }
  path = path.split(BACKSLASH).join("/");
  if (path.startsWith("//")) {
    throw new AttachmentProtocolError("unsupported_attachment_source_path_unc");
  }
  let root;
  let rest;
  if (hasDriveRoot(path)) {
    root = `${path[0].toUpperCase()}:/`;
    rest = path.slice(3);
  } else if (path[0] === "/") {
    root = "/";
    rest = path.slice(1);
  } else {
    throw new AttachmentProtocolError("attachment_source_path_not_absolute");
  }
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new AttachmentProtocolError("invalid_attachment_source_path");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new AttachmentProtocolError("invalid_attachment_source_path_segment");
  }
  return `${root}${segments.join("/")}`;
}

export function parseSourcePath(value) {
  if (value === undefined) return undefined;
  const normalized = normalizeSourcePath(value);
  if (normalized !== value) {
    throw new AttachmentProtocolError("non_canonical_attachment_source_path");
  }
  return value;
}

export function resolveLinkedAttachment(href, descriptors) {
  if (!Array.isArray(descriptors)) {
    throw new AttachmentProtocolError("invalid_attachment_descriptors");
  }
  let key;
  try {
    key = normalizeSourcePath(href);
  } catch (error) {
    if (error instanceof AttachmentProtocolError) {
      return Object.freeze({ status: "unregistered", href });
    }
    throw error;
  }
  for (let index = descriptors.length - 1; index >= 0; index -= 1) {
    if (descriptors[index]?.sourcePath === key) {
      return Object.freeze({ status: "bound", identity: descriptors[index].identity });
    }
  }
  return Object.freeze({ status: "unregistered", href });
}
