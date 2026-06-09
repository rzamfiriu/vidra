import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CustomSchemeTransport,
  BrowserFallbackTransport,
  NativeMessageTransport,
  hasNativeMessageChannel,
  NATIVE_CHANNEL,
} from "../transport.js";

describe("CustomSchemeTransport", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("appends a hidden iframe with the vidra:// bridge scheme on send", () => {
    const t = new CustomSchemeTransport();

    t.send({ id: "req_1", module: "echo", method: "ping", payload: { n: 1 } });

    const frames = document.body.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);

    const src = frames[0].getAttribute("src") ?? "";
    expect(src.startsWith("vidra://bridge?payload=")).toBe(true);

    const decoded = decodeURIComponent(src.replace("vidra://bridge?payload=", ""));
    expect(JSON.parse(decoded)).toMatchObject({ module: "echo", method: "ping" });
  });

  it("removes the iframe shortly after send", () => {
    vi.useFakeTimers();
    const t = new CustomSchemeTransport();
    t.send({ id: "r", module: "a", method: "b" });

    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("uses the vidra://reverse scheme for reverse responses", () => {
    const t = new CustomSchemeTransport();
    t.sendReverse({ id: "r", success: true, data: true });

    const src = document.body.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src.startsWith("vidra://reverse?payload=")).toBe(true);
  });
});

describe("NativeMessageTransport", () => {
  afterEach(() => {
    delete (window as any).webkit;
    delete (window as any).chrome;
  });

  const installAppleChannel = () => {
    const postMessage = vi.fn();
    (window as any).webkit = {
      messageHandlers: { [NATIVE_CHANNEL]: { postMessage } },
    };
    return postMessage;
  };

  const installWindowsChannel = () => {
    const postMessage = vi.fn();
    (window as any).chrome = { webview: { postMessage } };
    return postMessage;
  };

  it("detects the WKWebView (Apple) channel", () => {
    expect(hasNativeMessageChannel()).toBe(false);
    installAppleChannel();
    expect(hasNativeMessageChannel()).toBe(true);
  });

  it("detects the WebView2 (Windows) channel", () => {
    expect(hasNativeMessageChannel()).toBe(false);
    installWindowsChannel();
    expect(hasNativeMessageChannel()).toBe(true);
  });

  it("posts a framed request to the Apple channel", () => {
    const postMessage = installAppleChannel();
    new NativeMessageTransport().send({
      id: "req_1",
      module: "filesystem",
      method: "writeText",
      payload: { path: "/tmp/f.txt", content: "x".repeat(10_000) },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(postMessage.mock.calls[0][0]);
    expect(frame.kind).toBe("request");
    expect(frame.data).toMatchObject({ module: "filesystem", method: "writeText" });
    // The large payload survives intact (no URL-length truncation).
    expect(frame.data.payload.content).toHaveLength(10_000);
  });

  it("posts a framed reverse response to the Windows channel", () => {
    const postMessage = installWindowsChannel();
    new NativeMessageTransport().sendReverse({ id: "rev_1", success: true, data: 42 });

    const frame = JSON.parse(postMessage.mock.calls[0][0]);
    expect(frame).toEqual({
      kind: "reverse",
      data: { id: "rev_1", success: true, data: 42 },
    });
  });

  it("does not create iframes (unlike the custom-scheme transport)", () => {
    document.body.innerHTML = "";
    installAppleChannel();
    new NativeMessageTransport().send({ id: "r", module: "a", method: "b" });
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("throws when constructed without an available channel", () => {
    expect(() => new NativeMessageTransport()).toThrow(/no native message channel/i);
  });
});

describe("BrowserFallbackTransport", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as any).__vidra_callback;
  });

  it("delivers a BROWSER_ONLY error asynchronously", async () => {
    const t = new BrowserFallbackTransport();
    const received = new Promise<unknown>((resolve) => {
      (window as any).__vidra_callback = resolve;
    });

    t.send({ id: "req_1", module: "fs", method: "readText" });
    const response: any = await received;

    expect(response.success).toBe(false);
    expect(response.error.code).toBe("BROWSER_ONLY");
    expect(response.id).toBe("req_1");
  });

  it("warns when reverse responses are attempted", () => {
    new BrowserFallbackTransport().sendReverse({ id: "r", success: true });
    expect(warnSpy).toHaveBeenCalled();
  });
});
