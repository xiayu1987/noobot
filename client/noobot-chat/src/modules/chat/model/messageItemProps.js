/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const sharedMessageRenderProps = {
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  sending: { type: Boolean, default: false },
  currentTurn: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  hideHeader: { type: Boolean, default: false },
  attachmentPreviewDialogClass: {
    type: String,
    default: "attachment-preview-dialog",
  },
  filePreviewDialogClass: {
    type: String,
    default: "generated-file-preview-dialog",
  },
};

export const chatMessageItemProps = {
  messageItem: { type: Object, required: true },
  ...sharedMessageRenderProps,
  currentTurn: { type: Boolean, default: false },
  hideHeader: { type: Boolean, default: false },
};
