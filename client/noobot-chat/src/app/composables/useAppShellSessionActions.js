/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isApiRequestError } from "@noobot/shared/request-error";
import { requireFunctionDependencies } from "@noobot/shared/value";

export function useAppShellSessionActions({
  activeSessionId,
  confirmDeleteSession,
  deleteSession,
  renameSession,
  fetchSessions,
  refreshSessionConnectorsAsync,
  updateSessionSelectedConnectors,
  notify,
  translate,
}) {
  requireFunctionDependencies("useAppShellSessionActions", {
    confirmDeleteSession,
    deleteSession,
    renameSession,
    fetchSessions,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnectors,
    notify,
    translate,
  });

  async function notifyRequestFailure(operation) {
    try {
      return await operation();
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      notify({ type: "error", message: error.message });
      return false;
    }
  }

  async function handleDeleteSession(sessionId) {
    if (!(await confirmDeleteSession())) return;
    const deleted = await notifyRequestFailure(() => deleteSession(sessionId));
    if (deleted) notify({ type: "success", message: translate("common.deleteSessionSuccess") });
  }

  async function handleRenameSession({ sessionId, title }) {
    const renamed = await notifyRequestFailure(() => renameSession(sessionId, title));
    if (renamed) notify({ type: "success", message: translate("common.renameSessionSuccess") });
  }

  async function handleWorkspaceReset() {
    await fetchSessions();
    if (activeSessionId.value) refreshSessionConnectorsAsync(activeSessionId.value);
  }

  async function onConnectorSelected(selectedConnectorIds) {
    await notifyRequestFailure(() => updateSessionSelectedConnectors(selectedConnectorIds));
  }

  return {
    handleDeleteSession,
    handleRenameSession,
    handleWorkspaceReset,
    onConnectorSelected,
  };
}
