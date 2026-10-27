/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage } from "element-plus";
import { isOverlayDismissal, overlayMessageBox } from "./overlayMessageBox.js";
import { useLocale } from "../i18n/useLocale.js";
import { text } from "@noobot/shared/value";

export function useUiFeedback() {
  const { translate } = useLocale();
  function notify({ type = "info", message = "" } = {}) {
    const normalizedText = text(message);
    if (!normalizedText) return;
    if (type === "success") {
      ElMessage.success(normalizedText);
      return;
    }
    if (type === "warning") {
      ElMessage.warning(normalizedText);
      return;
    }
    if (type === "error") {
      ElMessage.error(normalizedText);
      return;
    }
    ElMessage.info(normalizedText);
  }

  async function confirmDeleteSession() {
    try {
      await overlayMessageBox.confirm(
        translate("infra.confirmDelete"),
        translate("infra.deleteSessionTitle"),
        {
          confirmButtonText: translate("infra.confirm"),
          cancelButtonText: translate("infra.cancel"),
          type: "warning",
        },
      );
      return true;
    } catch (error) {
      if (isOverlayDismissal(error)) return false;
      throw error;
    }
  }

  return {
    notify,
    confirmDeleteSession,
  };
}
