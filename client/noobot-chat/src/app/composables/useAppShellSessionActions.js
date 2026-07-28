/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function useAppShellSessionActions({
  activeSessionId,
  confirmDeleteSession,
  deleteSession,
  renameSession,
  fetchSessions,
  refreshSessionConnectorsAsync,
  updateSessionSelectedConnector,
  notify,
  translate = (key) => key,
} = {}) {
  async function handleDeleteSession(sessionId) {
    try {
      await confirmDeleteSession?.();
    } catch {
      return;
    }
    try {
      const deleted = await deleteSession?.(sessionId);
      if (deleted) {
        notify?.({ type: "success", message: translate("common.deleteSessionSuccess") });
      }
    } catch (error) {
      notify?.({ type: "error", message: error.message || translate("common.deleteSessionFailed") });
    }
  }

  async function handleRenameSession({ sessionId = "", title = "" } = {}) {
    try {
      const renamed = await renameSession?.(sessionId, title);
      if (renamed) {
        notify?.({ type: "success", message: translate("common.renameSessionSuccess") });
      }
    } catch (error) {
      notify?.({ type: "error", message: error.message || translate("common.renameSessionFailed") });
    }
  }

  async function handleWorkspaceReset() {
    await fetchSessions?.();
    if (activeSessionId?.value) {
      refreshSessionConnectorsAsync?.(activeSessionId.value);
    }
  }

  async function onConnectorSelected({ connectorType = "", connectorName = "" } = {}) {
    try {
      await updateSessionSelectedConnector?.({ connectorType, connectorName });
    } catch (error) {
      notify?.({ type: "error", message: error.message || translate("common.updateConnectorFailed") });
    }
  }

  return {
    handleDeleteSession,
    handleRenameSession,
    handleWorkspaceReset,
    onConnectorSelected,
  };
}
