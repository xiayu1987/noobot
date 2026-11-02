/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { installGlobalErrorBoundary } from "../../../src/app/globalErrorBoundary.js";

vi.mock("../../../src/shared/i18n/messageCatalog.js", () => ({
  translateStoredLocaleMessageKey: (key, { message }) => `${key}:${message}`,
}));

afterEach(() => vi.restoreAllMocks());

describe("global error boundary", () => {
  it("reports Vue render errors through the installed application handler", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notifyError = vi.fn();
    const app = createApp({
      render() {
        throw new Error("render-failed");
      },
    });
    const target = new EventTarget();
    installGlobalErrorBoundary(app, { target, notifyError });
    app.mount(document.createElement("div"));
    expect(notifyError).toHaveBeenCalledWith("infra.unexpectedError:render-failed");
    app.unmount();
  });

  it("reports rejected promises and cancels duplicate browser reporting", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notifyError = vi.fn();
    const target = new EventTarget();
    const app = createApp({ render: () => h("div") });
    installGlobalErrorBoundary(app, { target, notifyError });
    const event = new Event("unhandledrejection", { cancelable: true });
    Object.defineProperty(event, "reason", { value: new Error("apply-failed") });
    expect(target.dispatchEvent(event)).toBe(false);
    expect(notifyError).toHaveBeenCalledExactlyOnceWith("infra.unexpectedError:apply-failed");
  });
});
