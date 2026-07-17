/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildCancelledInteractionPayload,
  shouldOpenOpenVSCodeInCurrentTab,
  submitInteractionCancel,
  submitInteractionConfirm,
  updateDrawerModelVisibility,
} from "../../../src/app/appShellEventHandlers";

describe("appShellEventHandlers", () => {
  const translate = (key) => key;

  it("updates drawer model visibility and reports close transitions", () => {
    const drawer = { model: { value: true } };
    expect(updateDrawerModelVisibility({ drawer, value: false })).toEqual({ changed: true, closed: true });
    expect(drawer.model.value).toBe(false);
    expect(updateDrawerModelVisibility({ drawer, value: false })).toEqual({ changed: false, closed: false });
    expect(updateDrawerModelVisibility({ drawer: {}, value: true })).toEqual({ changed: false, closed: false });
  });

  it("submits interaction confirmations and notifies on failure", () => {
    const submitInteractionResponse = vi.fn();
    const notify = vi.fn();
    submitInteractionConfirm({ payload: { ok: true }, submitInteractionResponse, notify, translate });
    expect(submitInteractionResponse).toHaveBeenCalledWith({ ok: true });
    submitInteractionResponse.mockImplementationOnce(() => { throw new Error("boom"); });
    submitInteractionConfirm({ payload: {}, submitInteractionResponse, notify, translate });
    expect(notify).toHaveBeenCalledWith({ type: "error", message: "boom" });
  });

  it("submits the existing cancellation payload and notifies on failure", () => {
    expect(buildCancelledInteractionPayload()).toEqual({ confirmed: false, cancelled: true, response: "cancelled" });
    const submitInteractionResponse = vi.fn(() => { throw new Error(""); });
    const notify = vi.fn();
    submitInteractionCancel({ submitInteractionResponse, notify, translate });
    expect(submitInteractionResponse).toHaveBeenCalledWith(buildCancelledInteractionPayload());
    expect(notify).toHaveBeenCalledWith({ type: "error", message: "common.interactionCancelFailed" });
  });

  it("keeps OpenVSCode current-tab detection semantics", () => {
    expect(shouldOpenOpenVSCodeInCurrentTab({ isMobile: true, userAgent: "Desktop" })).toBe(true);
    expect(shouldOpenOpenVSCodeInCurrentTab({ isMobile: false, userAgent: "Android" })).toBe(true);
    expect(shouldOpenOpenVSCodeInCurrentTab({ isMobile: false, userAgent: "Mozilla" })).toBe(false);
  });
});
