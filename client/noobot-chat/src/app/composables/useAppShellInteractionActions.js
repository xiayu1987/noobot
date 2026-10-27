/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  submitInteractionCancel,
  submitInteractionConfirm,
} from "../runtime/appShellEventHandlers.js";
import { requireFunctionDependencies } from "@noobot/shared/value";

export function useAppShellInteractionActions({ submitInteractionResponse, notify, translate }) {
  requireFunctionDependencies("useAppShellInteractionActions", {
    submitInteractionResponse,
    notify,
    translate,
  });
  function handleInteractionConfirm(payload) {
    submitInteractionConfirm({
      payload,
      submitInteractionResponse,
      notify,
      translate,
    });
  }

  function handleInteractionCancel() {
    submitInteractionCancel({
      submitInteractionResponse,
      notify,
      translate,
    });
  }

  return {
    handleInteractionConfirm,
    handleInteractionCancel,
  };
}
