/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const sharedSidebarProps = {
  sidebarCollapsed: { type: Boolean, required: true },
  isMobile: { type: Boolean, required: true },
  mobileSidebarOpen: { type: Boolean, required: true },
  userId: { type: String, required: true },
  connectCode: { type: String, required: true },
  connecting: { type: Boolean, required: true },
  connected: { type: Boolean, required: true },
  sending: { type: Boolean, required: true },
  loadingSessions: { type: Boolean, required: true },
  sessions: { type: Array, required: true },
  activeSessionId: { type: String, required: true },
  turnRuntimeRegistry: { type: Object, required: true },
};
